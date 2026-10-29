import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTransition,
  claimDueJob,
  getJob,
  insertJob,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { runStartupRecovery } from './index';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:00:02.000Z';

const cleanups: (() => void)[] = [];

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-recover-'));
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

let seq = 0;
function seed(db: DatabaseHandle, maxAttempts = 3) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: `recover-${seq}`,
      payload: {},
      maxAttempts
    },
    T0
  );
}

function seedWithExpiredLease(db: DatabaseHandle, status: 'PLANNING' | 'PUBLISHING') {
  const job = seed(db);
  db.raw
    .prepare('UPDATE jobs SET status = ?, lease_owner = ?, lease_until = ? WHERE id = ?')
    .run(status, 'worker-mati', T0, job.id);
  return job;
}

describe('startup recovery', () => {
  it('mengembalikan job non-eksternal ke antrean setelah lease kedaluwarsa', () => {
    const db = tempDb();
    const job = seedWithExpiredLease(db, 'PLANNING');

    const result = runStartupRecovery(db, { now: () => new Date(T1) });

    expect(result.requeued.map((item) => item.id)).toEqual([job.id]);
    const recovered = getJob(db.raw, job.id);
    expect(recovered?.status).toBe('QUEUED');
    expect(recovered?.attempts).toBe(1);
    expect(recovered?.leaseOwner).toBeNull();
    expect(recovered?.lastErrorCode).toBe('LEASE_EXPIRED');
  });

  it('tidak mengulang otomatis job yang mungkin sudah memanggil platform', () => {
    const db = tempDb();
    const job = seedWithExpiredLease(db, 'PUBLISHING');

    const result = runStartupRecovery(db, { now: () => new Date(T1) });

    expect(result.escalated.map((item) => item.id)).toEqual([job.id]);
    const recovered = getJob(db.raw, job.id);
    expect(recovered?.status).toBe('NEEDS_ATTENTION');
    expect(recovered?.attempts).toBe(0);
  });

  it('eskalasi bila percobaan sudah habis', () => {
    const db = tempDb();
    const job = seed(db, 2);
    db.raw
      .prepare(
        "UPDATE jobs SET status = 'GENERATING', attempts = 1, lease_owner = 'worker-mati', lease_until = ? WHERE id = ?"
      )
      .run(T0, job.id);

    const result = runStartupRecovery(db, { now: () => new Date(T1) });

    expect(result.escalated.map((item) => item.id)).toEqual([job.id]);
    expect(getJob(db.raw, job.id)?.status).toBe('NEEDS_ATTENTION');
  });

  it('membiarkan job dengan lease aktif', () => {
    const db = tempDb();
    seed(db);
    claimDueJob(db.raw, { workerId: 'hidup', leaseTtlMs: 60_000, now: T0 });

    const result = runStartupRecovery(db, { now: () => new Date(T0) });

    expect(result.requeued).toHaveLength(0);
    expect(result.escalated).toHaveLength(0);
  });
});
