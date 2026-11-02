import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCaption, hashPlanBinding, type PlatformId } from '@saa/domain';
import {
  insertApproval,
  insertCampaign,
  insertJob,
  insertMediaAsset,
  insertPlanApproval,
  insertSchedule,
  insertSocialAccount,
  listJobs,
  openDatabase,
  runMigrations,
  setContentApprovalStatus,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { enqueueDuePublicationJobs } from './dispatch';

/** 10:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';
const CONTEXT = { now: new Date(T0), localDate: '2026-01-01' };
const SHA = 'a'.repeat(64);

const cleanups: (() => void)[] = [];
let dbCounter = 0;

function openMigrated(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-dispatch-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const handle = openDatabase(join(dir, `dispatch-${(dbCounter += 1)}.sqlite`));
  runMigrations(handle.raw);
  cleanups.push(() => handle.close());
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface SeedOptions {
  approvalMode?: 'automatic' | 'required';
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  caption?: unknown;
  assetStatus?: 'valid' | 'invalid' | null;
  accountStatus?: 'connected' | 'reauth_required' | 'disconnected';
  platforms?: PlatformId[];
}

function seed(db: DatabaseHandle, options: SeedOptions = {}) {
  const approvalMode = options.approvalMode ?? 'automatic';
  const platforms = options.platforms ?? ['youtube'];
  const campaign = insertCampaign(db.raw, {
    name: 'Edukasi AI',
    niche: 'teknologi',
    approvalMode,
    platforms
  });
  const content = upsertContentItem(db.raw, {
    id: `cnt_${campaign.id}`,
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: {},
    caption: options.caption ?? {
      youtube: { caption: 'Dasar AI dalam 30 detik', title: 'Dasar AI' }
    },
    approvalStatus:
      options.approvalStatus ?? (approvalMode === 'automatic' ? 'not_required' : 'pending')
  });

  const assetStatus = options.assetStatus === undefined ? 'valid' : options.assetStatus;
  if (assetStatus !== null) {
    insertMediaAsset(db.raw, {
      id: `med_${content.id}`,
      contentId: content.id,
      path: `content/${content.id}/video.mp4`,
      sha256: SHA,
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      validationStatus: assetStatus
    });
  }

  const account = insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'YouTube utama',
    connectionStatus: options.accountStatus ?? 'connected'
  });

  const schedule = insertSchedule(db.raw, {
    campaignId: campaign.id,
    mode: 'fixed',
    minMinutes: 60,
    timezone: 'Asia/Jakarta',
    dailyLimit: 2,
    nextRunAt: T0
  });

  return { campaign, content, account, schedule };
}

describe('enqueueDuePublicationJobs', () => {
  it('membuat satu job PUBLISH dengan payload dan key idempoten per akun', () => {
    const db = openMigrated();
    const { campaign, content, account, schedule } = seed(db);

    const jobIds = enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube']);

    expect(jobIds).toHaveLength(1);
    const job = listJobs(db.raw).items[0];
    expect(job).toMatchObject({
      id: jobIds[0],
      jobType: 'PUBLISH',
      status: 'QUEUED',
      campaignId: campaign.id,
      contentId: content.id,
      idempotencyKey: `publish:${content.id}:v1:${account.id}:youtube`,
      payload: {
        contentId: content.id,
        campaignId: campaign.id,
        accountId: account.id,
        platform: 'youtube'
      }
    });
  });

  it('dispatch kedua tidak membuat job duplikat', () => {
    const db = openMigrated();
    const { schedule } = seed(db);

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toHaveLength(1);
    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(1);
  });

  it('menolak dispatch bila belum ada approval pada mode required', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { approvalMode: 'required' });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });

  it('membuat job setelah approval terbinding pada caption dan aset yang sama', () => {
    const db = openMigrated();
    const caption = { youtube: { caption: 'Dasar AI dalam 30 detik' } };
    const { content, account, schedule } = seed(db, {
      approvalMode: 'required',
      approvalStatus: 'approved',
      caption
    });
    insertApproval(db.raw, {
      contentId: content.id,
      contentVersion: content.version,
      assetSha256: SHA,
      captionHash: hashCaption(caption),
      accountId: account.id,
      platform: 'youtube',
      decision: 'approved',
      decidedBy: 'owner'
    });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toHaveLength(1);
  });

  it('menolak dispatch bila caption berubah setelah approval', () => {
    const db = openMigrated();
    const approvedCaption = { youtube: { caption: 'Dasar AI dalam 30 detik' } };
    const { content, account, schedule } = seed(db, {
      approvalMode: 'required',
      approvalStatus: 'approved',
      caption: { youtube: { caption: 'Dasar AI diubah setelah review' } }
    });
    insertApproval(db.raw, {
      contentId: content.id,
      contentVersion: content.version,
      assetSha256: SHA,
      captionHash: hashCaption(approvedCaption),
      accountId: account.id,
      platform: 'youtube',
      decision: 'approved',
      decidedBy: 'owner'
    });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati konten yang ditolak reviewer meski mode otomatis', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { approvalStatus: 'rejected' });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati akun yang tidak terhubung dan platform tanpa adapter', () => {
    const db = openMigrated();
    const disconnected = seed(db, { accountStatus: 'disconnected' });
    expect(enqueueDuePublicationJobs(db, disconnected.schedule, CONTEXT, ['youtube'])).toEqual([]);

    const noAdapter = seed(db, {});
    expect(enqueueDuePublicationJobs(db, noAdapter.schedule, CONTEXT, [])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });

  it('melewati konten tanpa aset media valid', () => {
    const db = openMigrated();
    const noAsset = seed(db, { assetStatus: null });
    expect(enqueueDuePublicationJobs(db, noAsset.schedule, CONTEXT, ['youtube'])).toEqual([]);

    const invalid = seed(db, { assetStatus: 'invalid' });
    expect(enqueueDuePublicationJobs(db, invalid.schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati platform yang tidak ada di campaign atau tanpa caption', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { caption: { tiktok: { caption: 'caption tiktok' } } });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });
});

interface PlanSeedOptions {
  approvalMode?: 'automatic' | 'required';
  planApproval?: 'approved' | 'rejected' | null;
  bindingFromChangedCaption?: boolean;
}

/** Rencana dua item: seluruh konten berbagi `planJobId` dan masing-masing punya aset valid. */
function seedPlan(db: DatabaseHandle, options: PlanSeedOptions = {}) {
  const approvalMode = options.approvalMode ?? 'required';
  const campaign = insertCampaign(db.raw, {
    name: 'Edukasi AI',
    niche: 'teknologi',
    approvalMode,
    platforms: ['youtube']
  });
  const planJob = insertJob(db.raw, {
    jobType: 'PLAN_CONTENT',
    idempotencyKey: `plan:${campaign.id}`,
    payload: { campaignId: campaign.id },
    campaignId: campaign.id,
    status: 'COMPLETED'
  });

  const contents = [1, 2].map((index) => {
    const content = upsertContentItem(db.raw, {
      id: `cnt_${planJob.id}_${index}`,
      campaignId: campaign.id,
      topic: `topik ${index}`,
      prompt: { planJobId: planJob.id, videoPrompt: `video ${index}`, aspectRatio: '9:16' },
      caption: { youtube: { caption: `caption ${index}`, title: `judul ${index}` } },
      approvalStatus: approvalMode === 'automatic' ? 'not_required' : 'pending'
    });
    insertMediaAsset(db.raw, {
      id: `med_${content.id}`,
      contentId: content.id,
      path: `content/${content.id}/video.mp4`,
      sha256: SHA,
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      validationStatus: 'valid'
    });
    return content;
  });

  if (options.planApproval !== null && options.planApproval !== undefined) {
    const decision = options.planApproval;
    const binding = contents.map((content, index) => ({
      contentId: content.id,
      contentVersion: content.version,
      captionHash:
        options.bindingFromChangedCaption === true && index === 0
          ? hashCaption({ youtube: { caption: 'caption diubah setelah review' } })
          : hashCaption(content.caption)
    }));
    insertPlanApproval(db.raw, {
      planJobId: planJob.id,
      campaignId: campaign.id,
      bindingHash: hashPlanBinding(binding),
      itemCount: contents.length,
      decision,
      decidedBy: 'owner'
    });
    for (const content of contents) {
      setContentApprovalStatus(db.raw, {
        id: content.id,
        version: content.version,
        status: decision
      });
    }
  }

  insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'YouTube utama',
    connectionStatus: 'connected'
  });

  const schedule = insertSchedule(db.raw, {
    campaignId: campaign.id,
    mode: 'fixed',
    minMinutes: 60,
    timezone: 'Asia/Jakarta',
    dailyLimit: 2,
    nextRunAt: T0
  });

  return { campaign, contents, planJob, schedule };
}

describe('enqueueDuePublicationJobs — satu gerbang rencana', () => {
  it('rencana disetujui menerbitkan seluruh item tanpa approval per item', () => {
    const db = openMigrated();
    const { contents, schedule } = seedPlan(db, { planApproval: 'approved' });

    const jobIds = enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube']);

    expect(jobIds).toHaveLength(2);
    const jobs = listJobs(db.raw).items.filter((job) => job.jobType === 'PUBLISH');
    expect(jobs.map((job) => job.contentId).sort()).toEqual(contents.map((c) => c.id).sort());
    expect(jobs).toHaveLength(2);
  });

  it('rencana pending tidak menerbitkan apa pun walau media sudah siap', () => {
    const db = openMigrated();
    const { schedule } = seedPlan(db, { planApproval: null });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('rencana yang berubah setelah disetujui tidak menerbitkan item', () => {
    const db = openMigrated();
    const { schedule } = seedPlan(db, {
      planApproval: 'approved',
      bindingFromChangedCaption: true
    });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('rencana ditolak tidak menerbitkan item', () => {
    const db = openMigrated();
    const { schedule } = seedPlan(db, { planApproval: 'rejected' });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('mode automatic menerbitkan seluruh item rencana tanpa keputusan manusia', () => {
    const db = openMigrated();
    const { schedule } = seedPlan(db, { approvalMode: 'automatic', planApproval: null });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toHaveLength(2);
  });
});
