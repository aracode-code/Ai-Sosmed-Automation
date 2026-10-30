import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanDecision, Planner } from '@saa/agent-core';
import {
  getContentItem,
  getJob,
  getMediaAsset,
  insertCampaign,
  insertJob,
  listJobs,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { Dispatcher } from '@saa/workflow';
import { buildHandlerRegistry } from './handlers';

let workDir: string;
let mediaRoot: string;
let db: DatabaseHandle;

function dispatcherWith(handlers: ReturnType<typeof buildHandlerRegistry>): Dispatcher {
  return new Dispatcher({ db, workerId: 'w1', handlers });
}

function fakePlanner(plan: Omit<PlanDecision, 'campaignId'> & { campaignId?: string }): Planner {
  return {
    plan: async () => ({
      plan: { campaignId: 'cmp_worker', ...plan } as PlanDecision,
      attempts: 1,
      repaired: false,
      model: 'fake-planner'
    })
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-worker-'));
  mediaRoot = join(workDir, 'media');
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('buildHandlerRegistry', () => {
  it('mendaftarkan GENERATE_VIDEO tanpa planner dan tidak menyediakan fallback PLAN_CONTENT', () => {
    const registry = buildHandlerRegistry({ db, mediaRoot });

    expect(Object.keys(registry)).toEqual(['GENERATE_VIDEO']);
    expect(registry.PLAN_CONTENT).toBeUndefined();
  });

  it('mendaftarkan PLAN_CONTENT hanya bila planner diberikan', () => {
    const registry = buildHandlerRegistry({
      db,
      mediaRoot,
      planner: fakePlanner({
        decision: 'create_video',
        approvalRequired: false,
        rationale: 'uji'
      })
    });

    expect(Object.keys(registry).sort()).toEqual(['GENERATE_VIDEO', 'PLAN_CONTENT']);
  });
});

describe('worker + registry di composition root', () => {
  it('job PLAN_CONTENT tanpa planner menjadi NEEDS_ATTENTION dengan kode NO_HANDLER', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'plan:tanpa-planner',
      payload: { campaignId: 'cmp_worker' }
    });

    const dispatcher = dispatcherWith(buildHandlerRegistry({ db, mediaRoot }));
    await dispatcher.runOnce();

    const stored = getJob(db.raw, job.id);
    expect(stored?.status).toBe('NEEDS_ATTENTION');
    expect(stored?.lastErrorCode).toBe('NO_HANDLER');
  });

  it('PLAN_CONTENT lalu GENERATE_VIDEO selesai dan menghasilkan media asset', async () => {
    const campaign = insertCampaign(db.raw, {
      id: 'cmp_worker',
      name: 'Kampanye Edukasi AI',
      niche: 'teknologi',
      approvalMode: 'automatic',
      platforms: ['youtube']
    });

    const planner = fakePlanner({
      campaignId: campaign.id,
      decision: 'create_video',
      topic: 'Dasar AI',
      videoPrompt: 'Video pendek tentang dasar AI',
      aspectRatio: '9:16',
      targets: [{ platform: 'youtube', caption: 'Dasar AI dalam 30 detik', contentFormat: 'short' }],
      approvalRequired: false,
      rationale: 'konten edukasi singkat'
    });

    const dispatcher = dispatcherWith(buildHandlerRegistry({ db, mediaRoot, planner }));
    const planJob = insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'plan:rantai-penuh',
      campaignId: campaign.id,
      payload: { campaignId: campaign.id }
    });

    const planned = await dispatcher.runOnce();
    expect(planned?.id).toBe(planJob.id);
    expect(planned?.status).toBe('COMPLETED');

    const contentId = planned?.contentId;
    expect(contentId).toBe(`cnt_${planJob.id}`);
    expect(getContentItem(db.raw, contentId as string)?.approvalStatus).toBe('not_required');

    const queued = listJobs(db.raw).items.filter((job) => job.jobType === 'GENERATE_VIDEO');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('QUEUED');
    expect(queued[0]?.parentJobId).toBe(planJob.id);

    const generated = await dispatcher.runOnce();
    expect(generated?.jobType).toBe('GENERATE_VIDEO');
    expect(generated?.status).toBe('COMPLETED');

    const asset = getMediaAsset(db.raw, `med_${contentId}`);
    expect(asset?.contentId).toBe(contentId);
    expect(asset?.validationStatus).toBe('valid');
    expect(asset?.mimeType).toBe('video/mp4');
    expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
