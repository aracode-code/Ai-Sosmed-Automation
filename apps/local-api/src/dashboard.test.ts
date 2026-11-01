import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  insertCampaign,
  insertJob,
  insertPublishAttempt,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

interface SummaryPayload {
  generatedAt: string;
  jobs: { total: number; byStatus: Record<string, number> };
  publishAttempts: { total: number; byStatus: Record<string, number> };
  campaigns: { total: number; byStatus: Record<string, number> };
  content: { total: number; byApprovalStatus: Record<string, number>; pendingApproval: number };
  accounts: { total: number; byConnectionStatus: Record<string, number> };
  recentFailures: { id: string; jobType: string; status: string; lastErrorCode: string | null }[];
}

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-dashboard-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);

  const campaign = insertCampaign(db.raw, {
    name: 'Demo',
    niche: 'edukasi',
    approvalMode: 'required',
    platforms: ['youtube']
  });

  const youtubeAccount = insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'Kanal',
    connectionStatus: 'connected'
  });
  insertSocialAccount(db.raw, { platform: 'tiktok', label: 'Kanal 2', connectionStatus: 'reauth_required' });

  upsertContentItem(db.raw, {
    id: 'cnt_1',
    campaignId: campaign.id,
    topic: 'Topik',
    prompt: {},
    caption: { youtube: 'Caption' },
    approvalStatus: 'pending'
  });
  upsertContentItem(db.raw, {
    id: 'cnt_2',
    campaignId: campaign.id,
    topic: 'Topik 2',
    prompt: {},
    caption: { youtube: 'Caption 2' },
    approvalStatus: 'approved'
  });

  const completed = insertJob(
    db.raw,
    {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'job-ok',
      payload: {},
      campaignId: campaign.id,
      status: 'COMPLETED'
    },
    '2026-11-01T01:00:00.000Z'
  );
  insertJob(
    db.raw,
    {
      jobType: 'PUBLISH',
      idempotencyKey: 'job-fail',
      payload: {},
      campaignId: campaign.id,
      status: 'FAILED'
    },
    '2026-11-01T02:00:00.000Z'
  );
  insertJob(
    db.raw,
    {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: 'job-attention',
      payload: {},
      campaignId: campaign.id,
      status: 'NEEDS_ATTENTION'
    },
    '2026-11-01T03:00:00.000Z'
  );

  insertPublishAttempt(db.raw, {
    jobId: completed.id,
    accountId: youtubeAccount.id,
    platform: 'youtube',
    idempotencyKey: 'pub-1',
    status: 'published'
  });
  insertPublishAttempt(db.raw, {
    jobId: completed.id,
    accountId: youtubeAccount.id,
    platform: 'youtube',
    idempotencyKey: 'pub-2',
    status: 'unknown'
  });

  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') })
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('GET /api/v1/dashboard/summary', () => {
  it('mengembalikan agregasi status dan kegagalan terbaru', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/summary' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<SummaryPayload>();
    expect(Number.isNaN(Date.parse(payload.generatedAt))).toBe(false);
    expect(payload.jobs.total).toBe(3);
    expect(payload.jobs.byStatus).toEqual({ COMPLETED: 1, FAILED: 1, NEEDS_ATTENTION: 1 });
    expect(payload.campaigns.total).toBe(1);
    expect(payload.publishAttempts.byStatus).toEqual({ published: 1, unknown: 1 });
    expect(payload.content.pendingApproval).toBe(1);
    expect(payload.accounts.byConnectionStatus).toEqual({ connected: 1, reauth_required: 1 });
    expect(payload.recentFailures.map((failure) => failure.jobType)).toEqual([
      'GENERATE_VIDEO',
      'PUBLISH'
    ]);
    expect(payload.recentFailures[0]?.status).toBe('NEEDS_ATTENTION');
  });

  it('menghormati parameter jumlah kegagalan terbaru', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary?recentFailures=1'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SummaryPayload>().recentFailures).toHaveLength(1);
  });

  it('menolak parameter di luar rentang', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary?recentFailures=99'
    });

    expect(response.statusCode).toBe(400);
  });
});
