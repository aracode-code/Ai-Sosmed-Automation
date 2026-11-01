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
let completedJobId: string;
let youtubeAccountId: string;

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
  youtubeAccountId = youtubeAccount.id;
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
  completedJobId = completed.id;
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
    jobId: completedJobId,
    accountId: youtubeAccountId,
    platform: 'youtube',
    idempotencyKey: 'pub-1',
    status: 'published'
  }, '2026-11-01T04:40:00.000Z');
  insertPublishAttempt(db.raw, {
    jobId: completedJobId,
    accountId: youtubeAccountId,
    platform: 'youtube',
    idempotencyKey: 'pub-2',
    status: 'unknown'
  }, '2026-11-01T04:41:00.000Z');

  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') }),
    now: () => new Date('2026-11-01T04:40:00.000Z')
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

describe('tren 7 hari pada ringkasan', () => {
  it('mengelompokkan job dan attempt per hari WIB dengan titik kosong', async () => {
    const attemptDay = '2026-10-30T03:00:00.000Z'; // 10.00 WIB, 2 hari sebelum 1 Nov
    insertPublishAttempt(db.raw, {
      jobId: completedJobId,
      accountId: youtubeAccountId,
      platform: 'youtube',
      idempotencyKey: 'trend-pub-1',
      status: 'published'
    });
    db.raw
      .prepare('UPDATE publish_attempts SET attempted_at = ? WHERE idempotency_key = ?')
      .run(attemptDay, 'trend-pub-1');
    insertPublishAttempt(db.raw, {
      jobId: completedJobId,
      accountId: youtubeAccountId,
      platform: 'youtube',
      idempotencyKey: 'trend-fail-1',
      status: 'unknown'
    });
    db.raw
      .prepare('UPDATE publish_attempts SET attempted_at = ? WHERE idempotency_key = ?')
      .run('2026-10-31T05:00:00.000Z', 'trend-fail-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary?trendDays=3'
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json<{ trend: { date: string; jobs: number; published: number; failed: number }[] }>();
    expect(payload.trend).toHaveLength(3);
    expect(payload.trend.map((point) => point.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(payload.trend[0]?.published).toBe(1);
    expect(payload.trend[1]?.failed).toBe(1);
    expect(payload.trend[2]).toEqual({ date: '2026-11-01', jobs: 3, published: 1, failed: 1 });
  });
});

describe('batas trendDays', () => {
  it('mendukung hingga 30 hari dan menolak di atasnya', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/v1/dashboard/summary?trendDays=30' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ trend: unknown[] }>().trend).toHaveLength(30);

    const bad = await app.inject({ method: 'GET', url: '/api/v1/dashboard/summary?trendDays=31' });
    expect(bad.statusCode).toBe(400);
  });
});
