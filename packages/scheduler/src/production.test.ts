import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformId } from '@saa/domain';
import {
  insertCampaign,
  insertJob,
  insertSchedule,
  listJobs,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { enqueueDueContentPlan } from './production';

/** 10:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';
const CONTEXT = { now: new Date(T0), localDate: '2026-01-01' };

const cleanups: (() => void)[] = [];
let dbCounter = 0;

function openMigrated(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-production-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const handle = openDatabase(join(dir, `production-${(dbCounter += 1)}.sqlite`));
  runMigrations(handle.raw);
  cleanups.push(() => handle.close());
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function seed(db: DatabaseHandle, options: { status?: string; platforms?: PlatformId[] } = {}) {
  const campaign = insertCampaign(db.raw, {
    name: 'Edukasi AI',
    niche: 'teknologi',
    approvalMode: 'automatic',
    platforms: options.platforms ?? ['youtube'],
    ...(options.status === undefined ? {} : { status: options.status })
  });
  const schedule = insertSchedule(db.raw, {
    campaignId: campaign.id,
    mode: 'fixed',
    minMinutes: 60,
    timezone: 'Asia/Jakarta',
    dailyLimit: 3,
    nextRunAt: T0
  });
  return { campaign, schedule };
}

function seedContent(db: DatabaseHandle, campaignId: string, version = 1) {
  return upsertContentItem(db.raw, {
    id: `cnt_${campaignId}_${version}`,
    campaignId,
    topic: `topik ${version}`,
    prompt: {},
    caption: { youtube: { caption: 'Halo' } },
    approvalStatus: 'not_required'
  });
}

describe('produksi konten per slot', () => {
  it('membuat job PLAN_CONTENT untuk campaign aktif tanpa konten', () => {
    const db = openMigrated();
    const { campaign, schedule } = seed(db);

    const ids = enqueueDueContentPlan(db, schedule, CONTEXT);

    expect(ids).toHaveLength(1);
    const job = listJobs(db.raw).items[0];
    expect(job).toMatchObject({
      id: ids[0],
      jobType: 'PLAN_CONTENT',
      status: 'QUEUED',
      campaignId: campaign.id,
      idempotencyKey: `plan:${schedule.id}:${T0}`,
      payload: { campaignId: campaign.id }
    });
  });

  it('idempoten pada slot yang sama', () => {
    const db = openMigrated();
    const { schedule } = seed(db);

    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toHaveLength(1);
    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(1);
  });

  it('tidak membuat konten baru ketika konten terbaru belum punya job PUBLISH', () => {
    const db = openMigrated();
    const { campaign, schedule } = seed(db);
    seedContent(db, campaign.id);

    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });

  it('membuat konten berikutnya setelah konten terbaru punya job PUBLISH', () => {
    const db = openMigrated();
    const { campaign, schedule } = seed(db);
    const content = seedContent(db, campaign.id);
    insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: `publish:${content.id}:v1:acc:youtube`,
      payload: {},
      campaignId: campaign.id,
      contentId: content.id
    });

    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toHaveLength(1);
    expect(listJobs(db.raw).items.map((job) => job.jobType).sort()).toEqual([
      'PLAN_CONTENT',
      'PUBLISH'
    ]);
  });

  it('menahan slot sampai seluruh item rencana punya job PUBLISH', () => {
    const db = openMigrated();
    const { campaign, schedule } = seed(db);
    const planJob = insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: `plan:${campaign.id}`,
      payload: { campaignId: campaign.id },
      campaignId: campaign.id,
      status: 'COMPLETED'
    });

    const first = upsertContentItem(db.raw, {
      id: `cnt_${planJob.id}_1`,
      campaignId: campaign.id,
      topic: 'topik 1',
      prompt: { planJobId: planJob.id },
      caption: { youtube: { caption: 'satu' } },
      approvalStatus: 'approved'
    });
    const second = upsertContentItem(db.raw, {
      id: `cnt_${planJob.id}_2`,
      campaignId: campaign.id,
      topic: 'topik 2',
      prompt: { planJobId: planJob.id },
      caption: { youtube: { caption: 'dua' } },
      approvalStatus: 'approved'
    });

    // Hanya item pertama yang sudah punya job publikasi.
    insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: `publish:${first.id}:v1:acc:youtube`,
      payload: {},
      campaignId: campaign.id,
      contentId: first.id
    });
    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toEqual([]);

    insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: `publish:${second.id}:v1:acc:youtube`,
      payload: {},
      campaignId: campaign.id,
      contentId: second.id
    });
    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toHaveLength(1);
  });

  it('menahan slot saat masih ada PLAN_CONTENT yang belum selesai', () => {
    const db = openMigrated();
    const { campaign, schedule } = seed(db);
    const content = seedContent(db, campaign.id);
    insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: `publish:${content.id}:v1:acc:youtube`,
      payload: {},
      campaignId: campaign.id,
      contentId: content.id
    });
    insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'plan:manual',
      payload: { campaignId: campaign.id },
      campaignId: campaign.id,
      status: 'NEEDS_ATTENTION'
    });

    expect(enqueueDueContentPlan(db, schedule, CONTEXT)).toEqual([]);
  });

  it('tidak memproduksi untuk campaign non-aktif atau tanpa platform', () => {
    const db = openMigrated();
    const paused = seed(db, { status: 'paused' });
    expect(enqueueDueContentPlan(db, paused.schedule, CONTEXT)).toEqual([]);

    const empty = seed(db, { platforms: [] });
    expect(enqueueDueContentPlan(db, empty.schedule, CONTEXT)).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });
});
