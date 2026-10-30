import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPublishAttemptByKey,
  getSchedule,
  insertCampaign,
  insertMediaAsset,
  insertSchedule,
  insertSocialAccount,
  listJobs,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { createPublicationEnqueuer, Scheduler } from '@saa/scheduler';
import { Dispatcher } from '@saa/workflow';
import { MockYouTubeAdapter } from '@saa/youtube';
import { buildHandlerRegistry } from './handlers';

/** 10:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';

let workDir: string;
let db: DatabaseHandle;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-dispatch-app-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

function seedReadyCampaign() {
  const campaign = insertCampaign(db.raw, {
    name: 'Kampanye Edukasi AI',
    niche: 'teknologi',
    approvalMode: 'automatic',
    platforms: ['youtube']
  });
  const content = upsertContentItem(db.raw, {
    id: `cnt_${campaign.id}`,
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: { videoPrompt: 'Video pendek tentang dasar AI' },
    caption: { youtube: { caption: 'Dasar AI dalam 30 detik', title: 'Dasar AI' } },
    approvalStatus: 'not_required'
  });
  insertMediaAsset(db.raw, {
    id: `med_${content.id}`,
    contentId: content.id,
    path: `content/${content.id}/video.mp4`,
    sha256: 'b'.repeat(64),
    mimeType: 'video/mp4',
    sizeBytes: 2048,
    validationStatus: 'valid'
  });
  const account = insertSocialAccount(db.raw, {
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
  return { campaign, content, account, schedule };
}

describe('dispatch jadwal → PUBLISH otomatis', () => {
  it('membuat job PUBLISH dari jadwal due lalu selesai PUBLISHED lewat adapter mock', async () => {
    const { campaign, content, account, schedule } = seedReadyCampaign();
    const scheduler = new Scheduler(db, { now: () => new Date(T0), rng: () => 0 });

    const summary = await scheduler.runOnce(
      createPublicationEnqueuer({ db, platforms: ['youtube'] })
    );

    expect(summary).toMatchObject({ due: 1, enqueued: 1, quotaSkipped: 0, failed: [] });
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T04:00:00.000Z');

    const [job] = listJobs(db.raw).items;
    expect(job).toMatchObject({
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

    const dispatcher = new Dispatcher({
      db,
      workerId: 'w1',
      handlers: buildHandlerRegistry({
        db,
        mediaRoot: join(workDir, 'media'),
        publisher: new MockYouTubeAdapter()
      })
    });
    const published = await dispatcher.runOnce();

    expect(published?.id).toBe(job?.id);
    expect(published?.status).toBe('PUBLISHED');

    const attempt = getPublishAttemptByKey(db.raw, `publish:${job?.id}`);
    expect(attempt).toMatchObject({ status: 'published', accountId: account.id, platform: 'youtube' });
    expect(attempt?.externalPostId).toMatch(/^mock_yt_[0-9a-f]{11}$/);
  });

  it('tidak membuat job ketika belum ada adapter publikasi terdaftar', async () => {
    const { schedule } = seedReadyCampaign();
    const scheduler = new Scheduler(db, { now: () => new Date(T0), rng: () => 0 });

    const summary = await scheduler.runOnce(createPublicationEnqueuer({ db, platforms: [] }));

    expect(summary.enqueued).toBe(0);
    expect(listJobs(db.raw).items).toHaveLength(0);
    // Jadwal tetap maju: slot terpakai meski tidak ada target yang bisa dipublikasikan.
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T04:00:00.000Z');
  });
});
