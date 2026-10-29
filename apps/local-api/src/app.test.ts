import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertJob, openDatabase, runMigrations, type DatabaseHandle } from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;

function makeApp(handle: DatabaseHandle): FastifyInstance {
  return buildApp({ db: handle, config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') }) });
}

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-local-api-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
  app = makeApp(db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('GET /api/v1/health', () => {
  it('mengembalikan status ok beserta status database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<{
      status: string;
      version: string;
      db: string;
      workers: { active: number };
      time: string;
    }>();
    expect(payload.status).toBe('ok');
    expect(payload.db).toBe('ok');
    expect(payload.version).toBe('0.1.0');
    expect(payload.workers.active).toBe(0);
    expect(Number.isNaN(Date.parse(payload.time))).toBe(false);
  });

  it('tersedia juga pada /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('melaporkan degraded bila database tidak dapat diakses', async () => {
    const localDir = mkdtempSync(join(tmpdir(), 'saa-local-api-down-'));
    const brokenDb = openDatabase(join(localDir, 'app.sqlite'));
    const brokenApp = buildApp({ db: brokenDb, config: loadConfig({}) });
    try {
      await brokenApp.ready();
      brokenDb.close();

      const response = await brokenApp.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ status: string; db: string }>()).toMatchObject({
        status: 'degraded',
        db: 'error'
      });
    } finally {
      await brokenApp.close();
      rmSync(localDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/v1/jobs', () => {
  it('mengembalikan daftar kosong saat belum ada job', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it('mengembalikan job yang tersimpan', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'plan:campaign-1',
      payload: { campaignId: 'cmp_1' }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs' });
    expect(response.statusCode).toBe(200);
    const payload = response.json<{ items: Array<{ id: string; status: string }> }>();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: job.id, status: 'QUEUED' });
  });

  it('memfilter berdasarkan status', async () => {
    insertJob(db.raw, {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: 'plan:a',
      payload: null
    });
    insertJob(db.raw, {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: 'generate:a',
      payload: null,
      status: 'NEEDS_ATTENTION'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs?status=NEEDS_ATTENTION' });
    expect(response.statusCode).toBe(200);
    const payload = response.json<{ items: Array<{ jobType: string; status: string }> }>();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ jobType: 'GENERATE_VIDEO', status: 'NEEDS_ATTENTION' });
  });

  it('menolak status yang tidak dikenal', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs?status=SUCCESS' });

    expect(response.statusCode).toBe(400);
    const payload = response.json<{ error: { code: string; requestId: string; details: unknown[] } }>();
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.requestId.startsWith('req_')).toBe(true);
    expect(payload.error.details.length).toBeGreaterThan(0);
  });

  it('menolak limit di luar rentang', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs?limit=999' });

    expect(response.statusCode).toBe(400);
    const payload = response.json<{ error: { code: string; details: Array<{ path: string }> } }>();
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details[0]?.path).toBe('limit');
  });
});

describe('GET /api/v1/jobs/:id', () => {
  it('mengembalikan detail job', async () => {
    const job = insertJob(db.raw, {
      jobType: 'VALIDATE_MEDIA',
      idempotencyKey: 'validate:asset-1',
      payload: { assetId: 'asset_1' }
    });

    const response = await app.inject({ method: 'GET', url: `/api/v1/jobs/${job.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: job.id,
      jobType: 'VALIDATE_MEDIA',
      status: 'QUEUED',
      payload: { assetId: 'asset_1' }
    });
  });

  it('mengembalikan 404 dengan envelope error untuk job yang tidak ada', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs/job_tidak_ada' });

    expect(response.statusCode).toBe(404);
    const payload = response.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(payload.error.code).toBe('NOT_FOUND');
    expect(payload.error.message).toContain('job_tidak_ada');
    expect(payload.error.requestId.startsWith('req_')).toBe(true);
  });
});

describe('Penanganan route tidak dikenal', () => {
  it('mengembalikan 404 tanpa stack trace', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/tidak-ada' });

    expect(response.statusCode).toBe(404);
    const body = response.body;
    expect(body).not.toContain('stack');
    expect(body).not.toContain('node_modules');
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});
