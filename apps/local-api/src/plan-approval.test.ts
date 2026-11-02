import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashCaption, hashPlanBinding, type JobStatus } from '@saa/domain';
import {
  getJobByIdempotencyKey,
  insertCampaign,
  insertJob,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

const T0 = '2026-01-01T03:00:00.000Z';
const CAPTION_A = { youtube: { caption: 'Dasar AI', contentFormat: 'short' } };
const CAPTION_B = { youtube: { caption: 'Tips prompt', contentFormat: 'short' } };

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;
let seq = 0;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-plan-api-'));
  db = openDatabase(join(workDir, 'plan.sqlite'));
  runMigrations(db.raw);
  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'plan.sqlite') }),
    now: () => new Date(T0)
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

interface SeededPlan {
  campaignId: string;
  jobId: string;
  contentIds: string[];
}

function seedPlan(
  options: { jobStatus?: JobStatus; itemCount?: number; jobType?: 'PLAN_CONTENT' | 'PUBLISH' } = {}
): SeededPlan {
  seq += 1;
  const campaign = insertCampaign(
    db.raw,
    {
      name: 'Edukasi AI',
      niche: 'teknologi',
      approvalMode: 'required',
      platforms: ['youtube']
    },
    T0
  );
  const job = insertJob(
    db.raw,
    {
      jobType: options.jobType ?? 'PLAN_CONTENT',
      idempotencyKey: `plan:test:${seq}`,
      payload: { campaignId: campaign.id },
      campaignId: campaign.id,
      status: options.jobStatus ?? 'COMPLETED'
    },
    T0
  );

  const captions = [CAPTION_A, CAPTION_B];
  const itemCount = options.itemCount ?? 2;
  const contentIds: string[] = [];
  for (let index = 1; index <= itemCount; index += 1) {
    const id = itemCount === 1 ? `cnt_${job.id}` : `cnt_${job.id}_${index}`;
    const caption = captions[index - 1] ?? CAPTION_A;
    upsertContentItem(db.raw, {
      id,
      campaignId: campaign.id,
      topic: `topik ${index}`,
      prompt: {
        decision: 'create_video',
        videoPrompt: `video ${index}`,
        aspectRatio: '9:16',
        rationale: 'alasan',
        planJobId: job.id,
        itemIndex: index,
        itemCount
      },
      caption,
      approvalStatus: 'pending'
    });
    contentIds.push(id);
  }

  return { campaignId: campaign.id, jobId: job.id, contentIds };
}

function bindingHashOf(contentIds: string[]): string {
  const captions: unknown[] = [CAPTION_A, CAPTION_B];
  return hashPlanBinding(
    contentIds.map((contentId, index) => ({
      contentId,
      contentVersion: 1,
      captionHash: hashCaption(captions[index] ?? CAPTION_A)
    }))
  );
}

function generateJobs(contentId: string): { payload: unknown; status: string }[] {
  return db.raw
    .prepare(
      "SELECT payload_json AS payload, status FROM jobs WHERE job_type = 'GENERATE_VIDEO' AND content_id = ?"
    )
    .all(contentId)
    .map((row) => {
      const value = row as { payload: string; status: string };
      return { payload: JSON.parse(value.payload) as unknown, status: value.status };
    });
}

function contentStatus(contentId: string): string {
  const row = db.raw
    .prepare('SELECT approval_status FROM content_items WHERE id = ?')
    .get(contentId) as { approval_status: string };
  return row.approval_status;
}

function planApprovalCount(): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM plan_approvals').get() as { n: number };
  return row.n;
}

describe('GET /api/v1/plans/:jobId', () => {
  it('mengembalikan seluruh item rencana dan bindingHash dari server', async () => {
    const plan = seedPlan();

    const response = await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.jobId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      contents: { id: string }[];
      bindingHash: string;
      approval: unknown;
    }>();
    expect(body.contents.map((content) => content.id)).toEqual(plan.contentIds);
    expect(body.bindingHash).toBe(bindingHashOf(plan.contentIds));
    expect(body.approval).toBeNull();
  });

  it('mengembalikan 404 untuk job yang bukan rencana', async () => {
    const plan = seedPlan({ jobType: 'PUBLISH' });
    const response = await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.jobId}` });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/plans/:jobId/approve', () => {
  it('menyetujui rencana: semua item approved dan GENERATE_VIDEO dibuat per item', async () => {
    const plan = seedPlan();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/approve`,
      payload: { bindingHash: bindingHashOf(plan.contentIds), decidedBy: 'owner' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ enqueuedJobIds: string[]; contentIds: string[] }>();
    expect(body.contentIds).toEqual(plan.contentIds);
    expect(body.enqueuedJobIds).toHaveLength(2);

    for (const contentId of plan.contentIds) {
      expect(contentStatus(contentId)).toBe('approved');
      const jobs = generateJobs(contentId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.payload).toMatchObject({
        contentId,
        campaignId: plan.campaignId,
        videoPrompt: contentId.endsWith('_2') ? 'video 2' : 'video 1',
        aspectRatio: '9:16'
      });
      expect(getJobByIdempotencyKey(db.raw, `generate:${contentId}`)).not.toBeNull();
    }

    expect(planApprovalCount()).toBe(1);
    const audit = db.raw
      .prepare("SELECT action, result FROM audit_logs WHERE resource_id = ?")
      .all(plan.jobId) as { action: string; result: string }[];
    expect(audit).toEqual([{ action: 'plan.approve', result: 'success' }]);
  });

  it('menolak keputusan kedua untuk rencana yang sama tanpa menggandakan job', async () => {
    const plan = seedPlan();
    const payload = { bindingHash: bindingHashOf(plan.contentIds) };

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/approve`,
      payload
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/approve`,
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('PLAN_ALREADY_DECIDED');
    expect(planApprovalCount()).toBe(1);
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM jobs WHERE job_type = 'GENERATE_VIDEO'").get() as {
        n: number;
      }).n
    ).toBe(2);
  });

  it('menolak approval bila rencana berubah sejak ditampilkan', async () => {
    const plan = seedPlan();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/approve`,
      payload: { bindingHash: 'f'.repeat(64) }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PLAN_MISMATCH');
    expect(planApprovalCount()).toBe(0);
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM jobs WHERE job_type = 'GENERATE_VIDEO'").get() as {
        n: number;
      }).n
    ).toBe(0);
    expect(contentStatus(plan.contentIds[0]!)).toBe('pending');
  });

  it('menolak keputusan selama perencanaan belum selesai', async () => {
    const plan = seedPlan({ jobStatus: 'PLANNING' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/approve`,
      payload: { bindingHash: bindingHashOf(plan.contentIds) }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PLAN_NOT_READY');
  });
});

describe('POST /api/v1/plans/:jobId/reject', () => {
  it('menolak rencana: semua item rejected dan tidak ada GENERATE_VIDEO', async () => {
    const plan = seedPlan();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.jobId}/reject`,
      payload: { bindingHash: bindingHashOf(plan.contentIds), reason: 'topik kurang tepat' }
    });

    expect(response.statusCode).toBe(201);
    for (const contentId of plan.contentIds) {
      expect(contentStatus(contentId)).toBe('rejected');
      expect(generateJobs(contentId)).toHaveLength(0);
    }
    expect(planApprovalCount()).toBe(1);

    const audit = db.raw
      .prepare("SELECT action, result FROM audit_logs WHERE resource_id = ?")
      .all(plan.jobId) as { action: string; result: string }[];
    expect(audit).toEqual([{ action: 'plan.reject', result: 'success' }]);
  });
});
