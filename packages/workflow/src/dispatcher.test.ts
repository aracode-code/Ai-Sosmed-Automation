import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import { getJob, insertJob, openDatabase, runMigrations, type DatabaseHandle } from '@saa/database';
import { Dispatcher, type HandlerRegistry } from './index';

const T0 = '2026-01-01T00:00:00.000Z';
const now = () => new Date(T0);

const cleanups: (() => void)[] = [];

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-dispatch-'));
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
      jobType: 'PLAN_CONTENT',
      idempotencyKey: `dispatch-${seq}`,
      payload: {},
      maxAttempts
    },
    T0
  );
}

function dispatcher(db: DatabaseHandle, handlers: HandlerRegistry): Dispatcher {
  return new Dispatcher({
    db,
    workerId: 'w1',
    handlers,
    now,
    backoff: { jitterMs: 0, rng: () => 0 }
  });
}

describe('dispatcher', () => {
  it('menjalankan handler dan melepas lease', async () => {
    const db = tempDb();
    const job = seed(db);

    const result = await dispatcher(db, {
      PLAN_CONTENT: async (ctx) => {
        ctx.transition({ type: 'START_PLANNING' });
      }
    }).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('PLANNING');
    expect(result?.leaseOwner).toBeNull();
  });

  it('mengembalikan null bila tidak ada job due', async () => {
    const db = tempDb();
    expect(await dispatcher(db, {}).runOnce()).toBeNull();
  });

  it('kegagalan transien menjadi RETRY_WAIT dengan backoff', async () => {
    const db = tempDb();
    const job = seed(db);

    const result = await dispatcher(db, {
      PLAN_CONTENT: async () => {
        throw new AppError('TRANSIENT_NETWORK', 'timeout');
      }
    }).runOnce();

    expect(result?.status).toBe('RETRY_WAIT');
    expect(result?.attempts).toBe(1);
    expect(result?.runAt).toBe('2026-01-01T00:00:02.000Z');
    expect(result?.leaseOwner).toBeNull();
    expect(getJob(db.raw, job.id)?.status).toBe('RETRY_WAIT');
  });

  it('menghabiskan percobaan menjadi FAILED', async () => {
    const db = tempDb();
    seed(db, 1);

    const result = await dispatcher(db, {
      PLAN_CONTENT: async () => {
        throw new AppError('TRANSIENT_NETWORK', 'timeout');
      }
    }).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.attempts).toBe(1);
  });

  it('error AUTH berhenti untuk intervensi manusia', async () => {
    const db = tempDb();
    seed(db);

    const result = await dispatcher(db, {
      PLAN_CONTENT: async () => {
        throw new AppError('AUTH', 'perlu login ulang');
      }
    }).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('AUTH');
  });

  it('error CANCELLED menutup job tanpa retry', async () => {
    const db = tempDb();
    seed(db);

    const result = await dispatcher(db, {
      PLAN_CONTENT: async () => {
        throw new AppError('CANCELLED', 'user stop');
      }
    }).runOnce();

    expect(result?.status).toBe('CANCELLED');
  });

  it('job tanpa handler tidak dijalankan diam-diam', async () => {
    const db = tempDb();
    seed(db);

    const result = await dispatcher(db, {}).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('NO_HANDLER');
  });
});
