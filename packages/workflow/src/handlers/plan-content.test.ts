import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlannerOutputError, type Planner, type PlannerInput, type PlannerResult } from '@saa/agent-core';
import {
  getContentItem,
  getJob,
  insertCampaign,
  insertJob,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { Dispatcher, createPlanContentHandler, type HandlerContext } from '../index';

const T0 = '2026-01-01T00:00:00.000Z';
const now = () => new Date(T0);

const cleanups: (() => void)[] = [];
let seq = 0;

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-plan-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  runMigrations(handle.raw);
  cleanups.push(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function seededCampaign(db: DatabaseHandle) {
  seq += 1;
  return insertCampaign(
    db.raw,
    {
      name: 'Edukasi AI',
      niche: 'edukasi teknologi',
      approvalMode: 'required',
      platforms: ['youtube', 'tiktok']
    },
    T0
  );
}

const planResponse = {
  plan: {
    campaignId: '',
    decision: 'create_video' as const,
    topic: 'Tokenisasi',
    videoPrompt: 'Animasi memecah kalimat menjadi token',
    aspectRatio: '9:16' as const,
    targets: [
      { platform: 'youtube' as const, contentFormat: 'short', caption: 'Apa itu token?' },
      { platform: 'tiktok' as const, contentFormat: 'video', caption: 'Token itu apa?' }
    ],
    approvalRequired: true,
    rationale: 'Cocok untuk niche edukasi.'
  },
  attempts: 1,
  repaired: false,
  model: 'mock'
};

function plannerReturning(result: PlannerResult, seen: PlannerInput[] = []): Planner {
  return {
    async plan(input: unknown) {
      seen.push(input as PlannerInput);
      return result;
    }
  };
}

function plannerFailing(error: Error): Planner {
  return {
    async plan() {
      throw error;
    }
  };
}

function enqueuePlan(db: DatabaseHandle, campaignId: string) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: `plan-${seq}`,
      payload: { campaignId },
      campaignId
    },
    T0
  );
}

function dispatcherWith(db: DatabaseHandle, planner: Planner, extra: Partial<Parameters<typeof createPlanContentHandler>[0]> = {}) {
  const handler = createPlanContentHandler({ db, planner, now, ...extra });
  return new Dispatcher({
    db,
    workerId: 'w1',
    handlers: { PLAN_CONTENT: handler },
    now,
    backoff: { jitterMs: 0, rng: () => 0 }
  });
}

describe('PLAN_CONTENT handler', () => {
  it('menyimpan konten, meng-enqueue GENERATE_VIDEO, dan menutup job ke COMPLETED', async () => {
    const db = tempDb();
    const campaign = seededCampaign(db);
    const job = enqueuePlan(db, campaign.id);

    const seen: PlannerInput[] = [];
    const result = await dispatcherWith(
      db,
      plannerReturning(
        { ...planResponse, plan: { ...planResponse.plan, campaignId: campaign.id } },
        seen
      ),
      { capabilities: () => [{ platform: 'youtube', video: 'supported', directPost: 'unknown' }] }
    ).runOnce();

    expect(result?.status).toBe('COMPLETED');
    expect(result?.leaseOwner).toBeNull();
    expect(seen[0]?.campaign.platforms).toEqual(['youtube', 'tiktok']);
    expect(seen[0]?.capabilities).toEqual([
      { platform: 'youtube', video: 'supported', directPost: 'unknown' }
    ]);

    const contentId = `cnt_${job.id}`;
    expect(result?.contentId).toBe(contentId);

    const content = getContentItem(db.raw, contentId, 1);
    expect(content).toMatchObject({
      campaignId: campaign.id,
      topic: 'Tokenisasi',
      approvalStatus: 'pending'
    });
    expect(content?.caption).toEqual({
      youtube: { contentFormat: 'short', caption: 'Apa itu token?' },
      tiktok: { contentFormat: 'video', caption: 'Token itu apa?' }
    });

    const child = db.raw
      .prepare("SELECT * FROM jobs WHERE job_type = 'GENERATE_VIDEO'")
      .all() as { id: string; status: string; content_id: string; parent_job_id: string }[];
    expect(child).toHaveLength(1);
    expect(child[0]).toMatchObject({
      status: 'QUEUED',
      content_id: contentId,
      parent_job_id: job.id
    });
  });

  it('menghentikan job dengan NEEDS_ATTENTION bila planner meminta manusia', async () => {
    const db = tempDb();
    const campaign = seededCampaign(db);
    const job = enqueuePlan(db, campaign.id);

    const result = await dispatcherWith(
      db,
      plannerReturning({
        ...planResponse,
        plan: {
          ...planResponse.plan,
          campaignId: campaign.id,
          decision: 'needs_human',
          targets: undefined,
          topic: undefined,
          videoPrompt: undefined,
          aspectRatio: undefined
        }
      })
    ).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('PLANNER_NEEDS_HUMAN');
    expect(getContentItem(db.raw, `cnt_${job.id}`)).toBeNull();
  });

  it('menjadwalkan ulang lewat RETRY_WAIT bila planner memutuskan wait', async () => {
    const db = tempDb();
    const campaign = seededCampaign(db);
    enqueuePlan(db, campaign.id);

    const result = await dispatcherWith(
      db,
      plannerReturning({
        ...planResponse,
        plan: { ...planResponse.plan, campaignId: campaign.id, decision: 'wait' }
      })
    ).runOnce();

    expect(result?.status).toBe('RETRY_WAIT');
    expect(result?.runAt).toBe('2026-01-01T06:00:00.000Z');
    expect(result?.lastErrorCode).toBe('PLANNER_WAIT');
  });

  it('output planner invalid berakhir NEEDS_ATTENTION, bukan FAILED', async () => {
    const db = tempDb();
    const campaign = seededCampaign(db);
    enqueuePlan(db, campaign.id);

    const result = await dispatcherWith(
      db,
      plannerFailing(new PlannerOutputError('output tidak valid', ['decision: invalid']))
    ).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('AI_OUTPUT_INVALID');
  });

  it('campaign tidak ditemukan = kegagalan validasi (FAILED)', async () => {
    const db = tempDb();
    seq += 1;
    const job = insertJob(
      db.raw,
      {
        jobType: 'PLAN_CONTENT',
        idempotencyKey: `plan-missing-${seq}`,
        payload: { campaignId: 'cmp_missing' }
      },
      T0
    );

    const result = await dispatcherWith(db, plannerReturning(planResponse)).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
  });

  it('pengulangan handler tidak membuat konten atau job anak ganda', async () => {
    const db = tempDb();
    const campaign = seededCampaign(db);
    const job = enqueuePlan(db, campaign.id);
    const planner = plannerReturning({
      ...planResponse,
      plan: { ...planResponse.plan, campaignId: campaign.id }
    });
    const handler = createPlanContentHandler({ db, planner, now });

    const stubContext: HandlerContext = {
      get job() {
        return getJob(db.raw, job.id) ?? job;
      },
      transition() {
        return getJob(db.raw, job.id) ?? job;
      }
    };

    await handler(stubContext);
    await handler(stubContext);

    const contentRows = db.raw.prepare('SELECT * FROM content_items').all();
    const childRows = db.raw
      .prepare("SELECT * FROM jobs WHERE job_type = 'GENERATE_VIDEO'")
      .all();
    expect(contentRows).toHaveLength(1);
    expect(childRows).toHaveLength(1);
  });
});
