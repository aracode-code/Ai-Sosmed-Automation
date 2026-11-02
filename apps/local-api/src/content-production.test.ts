import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanDecision, Planner } from '@saa/agent-core';
import {
  getMediaAsset,
  getSchedule,
  insertCampaign,
  insertSchedule,
  insertSocialAccount,
  listContentByCampaign,
  listJobs,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import {
  createContentProductionEnqueuer,
  createPublicationEnqueuer,
  Scheduler,
  type EnqueueFn
} from '@saa/scheduler';
import { Dispatcher } from '@saa/workflow';
import { MockYouTubeAdapter } from '@saa/youtube';
import { buildHandlerRegistry } from './handlers';

/** Slot pertama 10:00 WIB, slot kedua 11:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';
const T1 = '2026-01-01T04:00:00.000Z';

let workDir: string;
let mediaRoot: string;
let db: DatabaseHandle;

function fakePlanner(campaignId: string): Planner {
  const plan: PlanDecision = {
    campaignId,
    decision: 'create_video',
    topic: 'Dasar AI',
    videoPrompt: 'Video pendek tentang dasar AI',
    aspectRatio: '9:16',
    targets: [
      { platform: 'youtube', caption: 'Dasar AI dalam 30 detik', contentFormat: 'short' }
    ],
    approvalRequired: false,
    rationale: 'naskah singkat untuk kanal edukasi'
  };
  return {
    plan: async () => ({ plan, attempts: 1, repaired: false, model: 'fake-planner' })
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-production-app-'));
  mediaRoot = join(workDir, 'media');
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('produksi konten otomatis antar slot', () => {
  it('slot kosong membuat konten, slot berikutnya menerbitkan lalu menyiapkan konten baru', async () => {
    const campaign = insertCampaign(db.raw, {
      name: 'Edukasi AI',
      niche: 'teknologi',
      approvalMode: 'automatic',
      platforms: ['youtube']
    });
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
      dailyLimit: 3,
      nextRunAt: T0
    });

    const publication = createPublicationEnqueuer({ db, platforms: ['youtube'] });
    const production = createContentProductionEnqueuer({ db });
    const enqueue: EnqueueFn = async (dueSchedule, context) => [
      ...(await publication(dueSchedule, context)),
      ...(await production(dueSchedule, context))
    ];

    const firstSlot = new Scheduler(db, { now: () => new Date(T0), rng: () => 0 });
    const summary1 = await firstSlot.runOnce(enqueue);
    expect(summary1).toMatchObject({ due: 1, enqueued: 1, failed: [] });
    expect(listJobs(db.raw).items.map((job) => job.jobType)).toEqual(['PLAN_CONTENT']);

    const dispatcher = new Dispatcher({
      db,
      workerId: 'w1',
      handlers: buildHandlerRegistry({
        db,
        mediaRoot,
        planner: fakePlanner(campaign.id),
        publisher: new MockYouTubeAdapter()
      })
    });
    await dispatcher.runOnce(); // PLAN_CONTENT
    await dispatcher.runOnce(); // GENERATE_VIDEO

    const [firstContent] = listContentByCampaign(db.raw, campaign.id);
    expect(firstContent).toBeDefined();
    expect(getMediaAsset(db.raw, `med_${firstContent?.id}`)?.validationStatus).toBe('valid');

    const secondSlot = new Scheduler(db, { now: () => new Date(T1), rng: () => 0 });
    const summary2 = await secondSlot.runOnce(enqueue);
    expect(summary2.enqueued).toBe(2);

    const types = listJobs(db.raw).items.map((job) => job.jobType);
    expect(types.filter((type) => type === 'PUBLISH')).toHaveLength(1);
    expect(types.filter((type) => type === 'PLAN_CONTENT')).toHaveLength(2);

    for (let i = 0; i < 3; i += 1) {
      if ((await dispatcher.runOnce()) === null) break;
    }

    const published = listJobs(db.raw).items.find((job) => job.jobType === 'PUBLISH');
    expect(published?.status).toBe('PUBLISHED');
    expect(published?.contentId).toBe(firstContent?.id);

    const contents = listContentByCampaign(db.raw, campaign.id);
    expect(contents).toHaveLength(2);
    expect(new Set(contents.map((item) => item.id)).size).toBe(2);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T05:00:00.000Z');
  });

  it('campaign image: konten diproduksi sebagai PNG dan tidak pernah diterbitkan', async () => {
    const campaign = insertCampaign(db.raw, {
      name: 'Ilustrasi AI',
      niche: 'teknologi',
      approvalMode: 'automatic',
      generationMode: 'image',
      platforms: ['youtube']
    });
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
      dailyLimit: 3,
      nextRunAt: T0
    });

    const publication = createPublicationEnqueuer({ db, platforms: ['youtube'] });
    const production = createContentProductionEnqueuer({ db });
    const enqueue: EnqueueFn = async (dueSchedule, context) => [
      ...(await publication(dueSchedule, context)),
      ...(await production(dueSchedule, context))
    ];

    const firstSlot = new Scheduler(db, { now: () => new Date(T0), rng: () => 0 });
    const summary1 = await firstSlot.runOnce(enqueue);
    expect(summary1).toMatchObject({ due: 1, enqueued: 1, failed: [] });
    expect(listJobs(db.raw).items.map((job) => job.jobType)).toEqual(['PLAN_CONTENT']);

    const dispatcher = new Dispatcher({
      db,
      workerId: 'w1',
      handlers: buildHandlerRegistry({
        db,
        mediaRoot,
        planner: fakePlanner(campaign.id),
        publisher: new MockYouTubeAdapter()
      })
    });
    await dispatcher.runOnce(); // PLAN_CONTENT
    await dispatcher.runOnce(); // GENERATE_IMAGE

    const [content] = listContentByCampaign(db.raw, campaign.id);
    expect(content?.prompt).toMatchObject({ mediaKind: 'image' });
    const asset = getMediaAsset(db.raw, `med_${content?.id}`);
    expect(asset).toMatchObject({ mimeType: 'image/png', validationStatus: 'valid' });
    expect(asset?.durationMs).toBeNull();

    const secondSlot = new Scheduler(db, { now: () => new Date(T1), rng: () => 0 });
    const summary2 = await secondSlot.runOnce(enqueue);
    expect(summary2.enqueued).toBe(1);

    const types = listJobs(db.raw).items.map((job) => job.jobType);
    expect(types.filter((type) => type === 'PUBLISH')).toHaveLength(0);
    expect(types.filter((type) => type === 'PLAN_CONTENT')).toHaveLength(2);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T05:00:00.000Z');
  });
});
