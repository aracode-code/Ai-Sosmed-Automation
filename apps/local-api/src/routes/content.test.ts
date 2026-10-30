import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from '../app';
import { loadConfig } from '../config';

const T0 = '2026-01-01T03:00:00.000Z';
const CAPTION = { youtube: { caption: 'Halo dunia', contentFormat: 'short' } };

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-content-api-'));
  db = openDatabase(join(workDir, 'content.sqlite'));
  runMigrations(db.raw);
  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'content.sqlite') }),
    now: () => new Date(T0)
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function createCampaign(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/campaigns',
    payload: { name: 'Edukasi AI', niche: 'teknologi', approvalMode: 'automatic', platforms: ['youtube'] }
  });
  expect(response.statusCode).toBe(202);
  return response.json<{ campaignId: string }>().campaignId;
}

function planJobs(): { id: string; idempotency_key: string; payload_json: string }[] {
  return db.raw
    .prepare("SELECT id, idempotency_key, payload_json FROM jobs WHERE job_type = 'PLAN_CONTENT'")
    .all() as { id: string; idempotency_key: string; payload_json: string }[];
}

describe('POST /api/v1/content', () => {
  it('membuat job PLAN_CONTENT manual di luar jadwal', async () => {
    const campaignId = await createCampaign();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      payload: { campaignId, notes: 'minta satu konten sekarang' }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json<{ jobId: string; status: string }>();
    expect(body.status).toBe('queued');

    const [job] = planJobs();
    expect(job?.id).toBe(body.jobId);
    expect(job?.idempotency_key.startsWith('plan:manual:')).toBe(true);
    expect(JSON.parse(job!.payload_json)).toMatchObject({
      campaignId,
      notes: 'minta satu konten sekarang'
    });
  });

  it('requestId yang sama tidak menggandakan job', async () => {
    const campaignId = await createCampaign();
    const payload = { campaignId, requestId: 'manual-1' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/content', payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/content', payload });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json<{ status: string }>().status).toBe('duplicate');
    expect(second.json<{ jobId: string }>().jobId).toBe(first.json<{ jobId: string }>().jobId);
    expect(planJobs()).toHaveLength(1);
  });

  it('mengembalikan 404 untuk campaign yang tidak ada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      payload: { campaignId: 'cmp_tidak_ada' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('menolak saat masih ada PLAN_CONTENT non-terminal', async () => {
    const campaignId = await createCampaign();
    await app.inject({ method: 'POST', url: '/api/v1/content', payload: { campaignId } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      payload: { campaignId }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PLAN_IN_PROGRESS');
    expect(planJobs()).toHaveLength(1);
  });

  it('menolak saat konten terbaru belum punya job PUBLISH', async () => {
    const campaignId = await createCampaign();
    upsertContentItem(db.raw, {
      id: 'cnt_busy',
      campaignId,
      topic: 'topik',
      prompt: { videoPrompt: 'p' },
      caption: CAPTION,
      approvalStatus: 'pending'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content',
      payload: { campaignId }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PIPELINE_BUSY');
    expect(planJobs()).toHaveLength(0);
  });
});
