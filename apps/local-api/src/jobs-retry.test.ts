import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getJob,
  insertCampaign,
  insertJob,
  listAuditByResource,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;
let campaignId: string;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-job-retry-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
  const campaign = insertCampaign(db.raw, {
    name: 'Demo',
    niche: 'edukasi',
    approvalMode: 'required',
    platforms: ['youtube']
  });
  campaignId = campaign.id;
  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') }),
    now: () => new Date('2026-11-01T10:00:00.000Z')
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('POST /api/v1/jobs/:id/retry', () => {
  it('mengembalikan job NEEDS_ATTENTION ke QUEUED dan mereset percobaan', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'retry-1',
      payload: {},
      campaignId,
      status: 'NEEDS_ATTENTION'
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/retry`
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ jobId: string; status: string }>()).toEqual({
      jobId: job.id,
      status: 'queued'
    });

    const updated = getJob(db.raw, job.id);
    expect(updated?.status).toBe('QUEUED');
    expect(updated?.attempts).toBe(0);
    expect(updated?.lastErrorCode).toBeNull();
    expect(updated?.leaseOwner).toBeNull();
    expect(updated?.runAt).toBe('2026-11-01T10:00:00.000Z');

    const audit = listAuditByResource(db.raw, 'job', job.id);
    expect(
      audit.some((event) => event.action === 'job.retry' && event.result === 'success')
    ).toBe(true);
  });

  it('menolak job yang tidak dapat diulang aman', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'retry-2',
      payload: {},
      campaignId,
      status: 'FAILED'
    });

    const response = await app.inject({ method: 'POST', url: `/api/v1/jobs/${job.id}/retry` });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_RETRYABLE');
    expect(getJob(db.raw, job.id)?.status).toBe('FAILED');
  });

  it('404 untuk job yang tidak ada', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/jobs/job_tidak_ada/retry' });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/jobs/:id/cancel', () => {
  it('membatalkan job QUEUED dan mencatat audit', async () => {
    const job = insertJob(db.raw, {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: 'cancel-1',
      payload: {},
      campaignId,
      status: 'QUEUED',
      runAt: '2026-11-01T09:00:00.000Z'
    });

    const response = await app.inject({ method: 'POST', url: `/api/v1/jobs/${job.id}/cancel` });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ status: string }>().status).toBe('cancelled');

    const updated = getJob(db.raw, job.id);
    expect(updated?.status).toBe('CANCELLED');
    expect(updated?.lastErrorCode).toBe('CANCELLED_BY_USER');
    expect(updated?.runAt).toBeNull();
    expect(updated?.leaseOwner).toBeNull();

    const audit = listAuditByResource(db.raw, 'job', job.id);
    expect(audit.some((event) => event.action === 'job.cancel')).toBe(true);
  });

  it('menolak pembatalan saat aksi eksternal mungkin berjalan', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'cancel-2',
      payload: {},
      campaignId,
      status: 'PUBLISHING'
    });

    const response = await app.inject({ method: 'POST', url: `/api/v1/jobs/${job.id}/cancel` });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_CANCELLABLE');
    expect(getJob(db.raw, job.id)?.status).toBe('PUBLISHING');
  });

  it('menolak pembatalan job terminal', async () => {
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'cancel-3',
      payload: {},
      campaignId,
      status: 'PUBLISHED'
    });

    const response = await app.inject({ method: 'POST', url: `/api/v1/jobs/${job.id}/cancel` });

    expect(response.statusCode).toBe(409);
    expect(getJob(db.raw, job.id)?.status).toBe('PUBLISHED');
  });

  it('404 untuk job yang tidak ada', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/jobs/job_hilang/cancel' });
    expect(response.statusCode).toBe(404);
  });
});
