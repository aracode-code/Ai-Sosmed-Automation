import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTransition,
  claimDueJob,
  getJob,
  insertJob,
  listExpiredLeases,
  listJobs,
  openDatabase,
  promoteDueRetries,
  runMigrations,
  type DatabaseHandle
} from '../index';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:00:02.000Z';

const cleanups: (() => void)[] = [];

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-jobs-'));
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
function newJob(db: DatabaseHandle, patch: Partial<Parameters<typeof insertJob>[1]> = {}) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: `idem-${seq}`,
      payload: { prompt: 'halo' },
      ...patch
    },
    T0
  );
}

describe('repository jobs', () => {
  it('menyimpan dan membaca job', () => {
    const db = tempDb();
    const created = newJob(db);
    expect(created.status).toBe('QUEUED');
    expect(created.attempts).toBe(0);
    expect(created.payload).toEqual({ prompt: 'halo' });

    const loaded = getJob(db.raw, created.id);
    expect(loaded?.id).toBe(created.id);
  });

  it('menolak idempotency key ganda', () => {
    const db = tempDb();
    newJob(db, { idempotencyKey: 'sama' });
    expect(() => newJob(db, { idempotencyKey: 'sama' })).toThrow(/UNIQUE/i);
  });

  it('hanya satu worker yang berhasil mengklaim job', () => {
    const db = tempDb();
    newJob(db);

    const first = claimDueJob(db.raw, { workerId: 'w1', leaseTtlMs: 1000, now: T0 });
    const second = claimDueJob(db.raw, { workerId: 'w2', leaseTtlMs: 1000, now: T0 });

    expect(first?.leaseOwner).toBe('w1');
    expect(second).toBeNull();
  });

  it('job bisa diklaim lagi setelah lease kedaluwarsa', () => {
    const db = tempDb();
    newJob(db);

    claimDueJob(db.raw, { workerId: 'w1', leaseTtlMs: 1000, now: T0 });
    expect(listExpiredLeases(db.raw, T0)).toHaveLength(0);

    const expired = listExpiredLeases(db.raw, T1);
    expect(expired).toHaveLength(1);

    const reclaimed = claimDueJob(db.raw, { workerId: 'w2', leaseTtlMs: 1000, now: T1 });
    expect(reclaimed?.leaseOwner).toBe('w2');
  });

  it('transisi optimistis menolak status yang sudah berubah', () => {
    const db = tempDb();
    const job = newJob(db);

    const moved = applyTransition(db.raw, {
      jobId: job.id,
      from: 'QUEUED',
      to: 'PLANNING',
      now: T0
    });
    expect(moved?.status).toBe('PLANNING');

    const stale = applyTransition(db.raw, {
      jobId: job.id,
      from: 'QUEUED',
      to: 'PLANNING',
      now: T0
    });
    expect(stale).toBeNull();
  });

  it('mempromosikan retry yang sudah due ke QUEUED', () => {
    const db = tempDb();
    const due = newJob(db, { status: 'RETRY_WAIT', runAt: T0 });
    const later = newJob(db, { status: 'RETRY_WAIT', runAt: '2026-01-02T00:00:00.000Z' });

    const promoted = promoteDueRetries(db.raw, T1);
    expect(promoted.map((job) => job.id)).toEqual([due.id]);
    expect(getJob(db.raw, due.id)?.status).toBe('QUEUED');
    expect(getJob(db.raw, later.id)?.status).toBe('RETRY_WAIT');
  });

  it('mengurutkan daftar job dan meneruskan cursor', () => {
    const db = tempDb();
    const a = insertJob(
      db.raw,
      { jobType: 'PLAN_CONTENT', idempotencyKey: 'a', payload: null },
      '2026-01-01T00:00:00.000Z'
    );
    const b = insertJob(
      db.raw,
      { jobType: 'PLAN_CONTENT', idempotencyKey: 'b', payload: null },
      '2026-01-01T00:00:01.000Z'
    );

    const page1 = listJobs(db.raw, { limit: 1 });
    expect(page1.items.map((job) => job.id)).toEqual([b.id]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listJobs(db.raw, { limit: 1, cursor: page1.nextCursor });
    expect(page2.items.map((job) => job.id)).toEqual([a.id]);
  });
});
