import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appliedMigrations,
  claimDueJob,
  getJob,
  insertJob,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { runStartupRecovery } from '@saa/workflow';
import { buildApp } from '@saa/local-api/app';
import { loadConfig } from '@saa/local-api/config';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:02:00.000Z';

const cleanups: (() => void)[] = [];
let dirCount = 0;

function tempDir(): string {
  dirCount += 1;
  const dir = mkdtempSync(join(tmpdir(), `saa-int-${dirCount}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function openAt(dir: string): DatabaseHandle {
  const handle = openDatabase(join(dir, 'app.sqlite'));
  cleanups.push(() => handle.close());
  return handle;
}

function seedWithLease(
  db: DatabaseHandle,
  status: string,
  options: { maxAttempts?: number } = {}
) {
  dirCount += 1;
  const job = insertJob(
    db.raw,
    {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: `int-${dirCount}`,
      payload: {},
      maxAttempts: options.maxAttempts ?? 3
    },
    T0
  );
  db.raw
    .prepare('UPDATE jobs SET status = ?, lease_owner = ?, lease_until = ? WHERE id = ?')
    .run(status, 'worker-mati', T0, job.id);
  return job;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('P1 integration: siklus hidup database', () => {
  it('migrasi berjalan di DB kosong dan idempoten setelah restart', () => {
    const dir = tempDir();

    const first = openAt(dir);
    const appliedFirst = runMigrations(first.raw);
    expect(appliedFirst.length).toBeGreaterThan(0);
    first.close();

    const second = openAt(dir);
    expect(runMigrations(second.raw)).toEqual([]);
    expect(appliedMigrations(second.raw)).toEqual(appliedFirst);

    const tables = second.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(['jobs', 'campaigns', 'media_assets', 'schema_migrations']));
    expect(second.raw.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('P1 integration: restart recovery', () => {
  it('mengembalikan job non-eksternal yang lease-nya kedaluwarsa ke antrean', () => {
    const dir = tempDir();
    const first = openAt(dir);
    runMigrations(first.raw);
    const job = seedWithLease(first, 'GENERATING');
    first.close();

    const second = openAt(dir);
    runMigrations(second.raw);
    const recovery = runStartupRecovery(second, { now: () => new Date(T1) });

    expect(recovery.requeued.map((item) => item.id)).toEqual([job.id]);
    expect(recovery.escalated).toEqual([]);

    const reloaded = getJob(second.raw, job.id);
    expect(reloaded).toMatchObject({
      status: 'QUEUED',
      attempts: 1,
      leaseOwner: null,
      leaseUntil: null,
      lastErrorCode: 'LEASE_EXPIRED'
    });
  });

  it('tidak mengulang job publikasi yang mungkin sudah menyentuh platform', () => {
    const dir = tempDir();
    const first = openAt(dir);
    runMigrations(first.raw);
    const publishing = seedWithLease(first, 'PUBLISHING');
    const verifying = seedWithLease(first, 'VERIFYING');
    first.close();

    const second = openAt(dir);
    runMigrations(second.raw);
    const recovery = runStartupRecovery(second, { now: () => new Date(T1) });

    expect(recovery.requeued).toEqual([]);
    expect(recovery.escalated.map((item) => item.id).sort()).toEqual(
      [publishing.id, verifying.id].sort()
    );
    for (const jobId of [publishing.id, verifying.id]) {
      expect(getJob(second.raw, jobId)).toMatchObject({
        status: 'NEEDS_ATTENTION',
        attempts: 0,
        leaseOwner: null,
        lastErrorCode: 'LEASE_EXPIRED'
      });
    }
  });
});

describe('P1 integration: klaim antrean lintas koneksi', () => {
  it('hanya satu koneksi yang berhasil mengklaim job due', () => {
    const dir = tempDir();
    const writer = openAt(dir);
    runMigrations(writer.raw);
    const job = insertJob(
      writer.raw,
      { jobType: 'PLAN_CONTENT', idempotencyKey: 'claim-satu', payload: {} },
      T0
    );

    const workerA = openAt(dir);
    const workerB = openAt(dir);

    const claimA = claimDueJob(workerA.raw, {
      workerId: 'worker-a',
      leaseTtlMs: 60_000,
      now: T1
    });
    const claimB = claimDueJob(workerB.raw, {
      workerId: 'worker-b',
      leaseTtlMs: 60_000,
      now: T1
    });

    expect(claimA?.id).toBe(job.id);
    expect(claimB).toBeNull();
    expect(getJob(workerA.raw, job.id)?.leaseOwner).toBe('worker-a');
  });
});

describe('P1 integration: kontrak API', () => {
  it('mengembalikan envelope error tanpa membocorkan detail internal', async () => {
    const dir = tempDir();
    const db = openAt(dir);
    runMigrations(db.raw);

    const app = buildApp({ db, config: loadConfig({ DATABASE_PATH: join(dir, 'app.sqlite') }) });
    try {
      await app.ready();

      const missing = await app.inject({ method: 'GET', url: '/api/v1/tidak-ada' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({
        error: { code: 'NOT_FOUND', details: [] }
      });
      expect(missing.body).not.toMatch(/node_modules|at .*\.ts:\d+/);

      const invalid = await app.inject({ method: 'GET', url: '/api/v1/jobs?limit=0' });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });
});
