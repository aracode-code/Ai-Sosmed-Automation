import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashCaption } from '@saa/domain';
import {
  insertSocialAccount,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { isSchedulerPaused } from '@saa/scheduler';
import { buildApp } from '../app';
import { loadConfig } from '../config';

const T0 = '2026-01-01T03:00:00.000Z';

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;

function makeApp(handle: DatabaseHandle): FastifyInstance {
  return buildApp({
    db: handle,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'p4.sqlite') }),
    now: () => new Date(T0)
  });
}

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-p4-api-'));
  db = openDatabase(join(workDir, 'p4.sqlite'));
  runMigrations(db.raw);
  app = makeApp(db);
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
    payload: {
      name: 'Edukasi AI',
      niche: 'teknologi',
      approvalMode: 'required',
      platforms: ['youtube']
    }
  });
  expect(response.statusCode).toBe(202);
  return response.json<{ campaignId: string }>().campaignId;
}

const CAPTION = { youtube: { caption: 'Halo dunia', contentFormat: 'short' } };
const ASSET_SHA = 'a'.repeat(64);

function seedContent(campaignId: string, id = 'cnt_1') {
  return upsertContentItem(db.raw, {
    id,
    campaignId,
    topic: 'topik',
    prompt: { videoPrompt: 'p' },
    caption: CAPTION,
    approvalStatus: 'pending'
  });
}

function seedAccount() {
  return insertSocialAccount(db.raw, {
    id: 'acc_yt',
    platform: 'youtube',
    label: 'kanal utama',
    connectionStatus: 'connected'
  });
}

describe('POST /api/v1/campaigns', () => {
  it('membuat campaign dan mengembalikan 202 dengan campaignId', async () => {
    const campaignId = await createCampaign();
    expect(campaignId.startsWith('cmp_')).toBe(true);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      campaign: {
        id: campaignId,
        name: 'Edukasi AI',
        approvalMode: 'required',
        platforms: ['youtube']
      },
      content: []
    });
  });

  it('menolak platform yang tidak dikenal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: { name: 'X', niche: 'y', platforms: ['myspace'] }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('mengembalikan 404 untuk campaign yang tidak ada', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/cmp_hilang' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/content/:id/approve|reject', () => {
  it('menyimpan approval yang terikat pada versi, hash, akun, dan platform', async () => {
    const campaignId = await createCampaign();
    seedContent(campaignId);
    seedAccount();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/cnt_1/approve',
      payload: {
        version: 1,
        assetSha256: ASSET_SHA,
        captionHash: hashCaption(CAPTION),
        accountId: 'acc_yt',
        platform: 'youtube',
        decidedBy: 'owner'
      }
    });

    expect(response.statusCode).toBe(201);
    const approval = response.json<{ approval: Record<string, unknown> }>().approval;
    expect(approval).toMatchObject({
      contentId: 'cnt_1',
      contentVersion: 1,
      assetSha256: ASSET_SHA,
      accountId: 'acc_yt',
      platform: 'youtube',
      decision: 'approved',
      decidedBy: 'owner'
    });

    const detail = await app.inject({ method: 'GET', url: `/api/v1/campaigns/${campaignId}` });
    expect(detail.json<{ content: Array<{ approvalStatus: string }> }>().content[0]).toMatchObject({
      approvalStatus: 'approved'
    });
  });

  it('menolak approval dengan captionHash yang tidak cocok setelah konten berubah', async () => {
    const campaignId = await createCampaign();
    seedContent(campaignId);
    seedAccount();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/cnt_1/approve',
      payload: {
        version: 1,
        assetSha256: ASSET_SHA,
        captionHash: hashCaption({ youtube: { caption: 'caption lama' } }),
        accountId: 'acc_yt',
        platform: 'youtube'
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string; details: string[] } }>().error).toMatchObject({
      code: 'APPROVAL_MISMATCH',
      details: ['captionHash']
    });
  });

  it('menolak platform yang tidak sesuai dengan akun', async () => {
    const campaignId = await createCampaign();
    seedContent(campaignId);
    seedAccount();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/cnt_1/approve',
      payload: {
        version: 1,
        assetSha256: ASSET_SHA,
        captionHash: hashCaption(CAPTION),
        accountId: 'acc_yt',
        platform: 'tiktok'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PLATFORM_MISMATCH');
  });

  it('menyimpan reject beserta alasan', async () => {
    const campaignId = await createCampaign();
    seedContent(campaignId);
    seedAccount();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/cnt_1/reject',
      payload: {
        version: 1,
        assetSha256: ASSET_SHA,
        captionHash: hashCaption(CAPTION),
        accountId: 'acc_yt',
        platform: 'youtube',
        reason: 'caption terlalu umum'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ approval: { decision: string; reason: string } }>().approval).toMatchObject({
      decision: 'rejected',
      reason: 'caption terlalu umum'
    });
  });

  it('mengembalikan 404 untuk versi konten yang tidak ada', async () => {
    const campaignId = await createCampaign();
    seedContent(campaignId);
    seedAccount();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/content/cnt_1/approve',
      payload: {
        version: 2,
        assetSha256: ASSET_SHA,
        captionHash: hashCaption(CAPTION),
        accountId: 'acc_yt',
        platform: 'youtube'
      }
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('schedules', () => {
  it('membuat jadwal dengan next_run_at yang dipersist', async () => {
    const campaignId = await createCampaign();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/schedules',
      payload: { campaignId, mode: 'fixed', minMinutes: 60, timezone: 'Asia/Jakarta' }
    });

    expect(response.statusCode).toBe(201);
    const schedule = response.json<{ schedule: { id: string; nextRunAt: string } }>().schedule;
    expect(schedule.nextRunAt).toBe('2026-01-01T04:00:00.000Z');

    const list = await app.inject({ method: 'GET', url: `/api/v1/schedules?campaignId=${campaignId}` });
    expect(list.json<{ items: Array<{ id: string }> }>().items).toHaveLength(1);
    expect(list.json<{ items: Array<{ id: string }> }>().items[0]?.id).toBe(schedule.id);
  });

  it('menolak maxMinutes lebih kecil dari minMinutes', async () => {
    const campaignId = await createCampaign();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/schedules',
      payload: { campaignId, mode: 'random', minMinutes: 120, maxMinutes: 60 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { details: string[] } }>().error.details).toContain(
      'maxMinutes tidak boleh kurang dari minMinutes'
    );
  });

  it('patch menghitung ulang next_run_at dan menonaktifkan jadwal', async () => {
    const campaignId = await createCampaign();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/schedules',
      payload: { campaignId, mode: 'fixed', minMinutes: 60 }
    });
    const scheduleId = created.json<{ schedule: { id: string } }>().schedule.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/schedules/${scheduleId}`,
      payload: { dailyLimit: 3, minMinutes: 30 }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ schedule: { dailyLimit: number; nextRunAt: string } }>().schedule).toMatchObject(
      { dailyLimit: 3, nextRunAt: '2026-01-01T03:30:00.000Z' }
    );

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/schedules/${scheduleId}`,
      payload: { enabled: false }
    });
    expect(disabled.json<{ schedule: { enabled: boolean; nextRunAt: string | null } }>().schedule).toMatchObject(
      { enabled: false, nextRunAt: null }
    );
  });

  it('pause dan resume mengubah state scheduler yang persisten', async () => {
    const paused = await app.inject({ method: 'POST', url: '/api/v1/scheduler/pause' });
    expect(paused.json()).toEqual({ paused: true });
    expect(isSchedulerPaused(db)).toBe(true);

    const resumed = await app.inject({ method: 'POST', url: '/api/v1/scheduler/resume' });
    expect(resumed.json()).toEqual({ paused: false });
    expect(isSchedulerPaused(db)).toBe(false);
  });

  it('mengembalikan 404 untuk jadwal yang tidak ada', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/schedules/sch_hilang',
      payload: { dailyLimit: 2 }
    });
    expect(response.statusCode).toBe(404);
  });
});
