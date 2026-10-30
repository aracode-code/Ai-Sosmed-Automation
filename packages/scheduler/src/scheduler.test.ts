import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import {
  getSchedule,
  insertCampaign,
  insertJob,
  insertSchedule,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import {
  createDbQuotaGate,
  isSchedulerPaused,
  Scheduler,
  setSchedulerPaused,
  type EnqueueFn
} from './index';

/** 10:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';

const cleanups: (() => void)[] = [];
let dbCounter = 0;

function tempDbPath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'saa-scheduler-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, `scheduler-${(dbCounter += 1)}.sqlite`) };
}

function openMigrated(file: string): DatabaseHandle {
  const handle = openDatabase(file);
  runMigrations(handle.raw);
  cleanups.push(() => handle.close());
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function seedSchedule(
  db: DatabaseHandle,
  overrides: Partial<Parameters<typeof insertSchedule>[1]> = {}
) {
  const campaign = insertCampaign(db.raw, {
    name: 'Edukasi AI',
    niche: 'teknologi',
    approvalMode: 'required',
    platforms: ['youtube']
  });
  const schedule = insertSchedule(db.raw, {
    campaignId: campaign.id,
    mode: 'fixed',
    minMinutes: 60,
    timezone: 'Asia/Jakarta',
    dailyLimit: 2,
    nextRunAt: T0,
    ...overrides
  });
  return { campaign, schedule };
}

function schedulerAt(db: DatabaseHandle, iso: string): Scheduler {
  return new Scheduler(db, { now: () => new Date(iso), rng: () => 0 });
}

describe('Scheduler.runOnce', () => {
  it('meng-enqueue jadwal due lalu mempersist next_run_at', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule } = seedSchedule(db);
    const calls: string[] = [];

    const summary = await schedulerAt(db, T0).runOnce((item) => {
      calls.push(item.id);
      return ['job_1'];
    });

    expect(summary).toMatchObject({
      paused: false,
      due: 1,
      enqueued: 1,
      shifted: 0,
      quotaSkipped: 0,
      failed: []
    });
    expect(calls).toEqual([schedule.id]);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T04:00:00.000Z');
  });

  it('restart tidak mengubah next_run_at yang tersimpan', async () => {
    const { file } = tempDbPath();
    const first = openMigrated(file);
    const { schedule } = seedSchedule(first);
    await schedulerAt(first, T0).runOnce(() => []);
    const persisted = getSchedule(first.raw, schedule.id)?.nextRunAt;
    first.close();

    const reopened = openMigrated(file);
    const summary = await schedulerAt(reopened, T0).runOnce(() => {
      throw new Error('tidak boleh enqueue sebelum next_run_at');
    });

    expect(summary.due).toBe(0);
    expect(getSchedule(reopened.raw, schedule.id)?.nextRunAt).toBe(persisted);
  });

  it('pause menghentikan dispatch tanpa menghapus jadwal', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule } = seedSchedule(db);

    setSchedulerPaused(db, true);
    const paused = schedulerAt(db, T0);
    const summary = await paused.runOnce(() => ['job_1']);

    expect(summary.paused).toBe(true);
    expect(summary.enqueued).toBe(0);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe(T0);

    paused.resume();
    expect(isSchedulerPaused(db)).toBe(false);
    const resumed = await paused.runOnce(() => ['job_1']);
    expect(resumed.paused).toBe(false);
    expect(resumed.enqueued).toBe(1);
  });

  it('menggeser next_run_at bila sekarang di luar window', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule } = seedSchedule(db, { windowStart: '12:00', windowEnd: '18:00' });
    const calls: string[] = [];

    const summary = await schedulerAt(db, T0).runOnce((item) => {
      calls.push(item.id);
      return [];
    });

    expect(summary.shifted).toBe(1);
    expect(calls).toEqual([]);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T05:00:00.000Z');
  });

  it('melewati enqueue bila kuota harian habis, tanpa menggeser next_run_at', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule, campaign } = seedSchedule(db, { dailyLimit: 1 });
    const account = insertSocialAccount(db.raw, { platform: 'youtube', label: 'kanal uji' });
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'publish:quota',
      payload: {},
      campaignId: campaign.id
    });
    db.raw
      .prepare(
        `INSERT INTO publish_attempts
         (id, job_id, account_id, platform, idempotency_key, status, attempted_at)
         VALUES ('pa_1', ?, ?, 'youtube', 'pa:1', 'submitted', '2026-01-01T02:00:00.000Z')`
      )
      .run(job.id, account.id);

    const summary = await schedulerAt(db, T0).runOnce(() => {
      throw new Error('kuota habis, enqueue tidak boleh dipanggil');
    });

    expect(summary.quotaSkipped).toBe(1);
    expect(summary.enqueued).toBe(0);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe(T0);
  });

  it('mencatat kegagalan enqueue dan tidak menggeser jadwal', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule } = seedSchedule(db);

    const enqueue: EnqueueFn = () => {
      throw new AppError('TRANSIENT_NETWORK', 'jaringan putus');
    };
    const summary = await schedulerAt(db, T0).runOnce(enqueue);

    expect(summary.failed).toEqual([{ scheduleId: schedule.id, errorClass: 'TRANSIENT_NETWORK' }]);
    expect(summary.enqueued).toBe(0);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe(T0);
  });

  it('mengisi next_run_at untuk jadwal lama yang belum punya jadwal', async () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule } = seedSchedule(db, { nextRunAt: null });

    const summary = await schedulerAt(db, T0).runOnce(() => ['job_1']);

    expect(summary.seeded).toBe(1);
    expect(summary.enqueued).toBe(0);
    expect(getSchedule(db.raw, schedule.id)?.nextRunAt).toBe('2026-01-01T04:00:00.000Z');
  });

  it('mengabaikan jadwal yang dinonaktifkan', async () => {
    const db = openMigrated(tempDbPath().file);
    seedSchedule(db, { enabled: false });

    const summary = await schedulerAt(db, T0).runOnce(() => ['job_1']);

    expect(summary.due).toBe(0);
    expect(summary.enqueued).toBe(0);
  });
});

describe('createDbQuotaGate', () => {
  function seedAttempt(
    db: DatabaseHandle,
    campaignId: string,
    accountId: string,
    attemptedAt: string,
    suffix: string
  ): void {
    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: `publish:${suffix}`,
      payload: {},
      campaignId
    });
    db.raw
      .prepare(
        `INSERT INTO publish_attempts
         (id, job_id, account_id, platform, idempotency_key, status, attempted_at)
         VALUES (?, ?, ?, 'youtube', ?, 'submitted', ?)`
      )
      .run(`pa_${suffix}`, job.id, accountId, `pa:${suffix}`, attemptedAt);
  }

  it('menghitung per account+platform pada tanggal lokal jadwal', () => {
    const db = openMigrated(tempDbPath().file);
    const { schedule, campaign } = seedSchedule(db, { dailyLimit: 2 });
    const youtube = insertSocialAccount(db.raw, { platform: 'youtube', label: 'yt' });
    const other = insertSocialAccount(db.raw, { platform: 'youtube', label: 'yt lain' });
    const gate = createDbQuotaGate(db);

    expect(gate.isExceeded(schedule, '2026-01-01')).toBe(false);

    // 2026-01-01T16:59Z masih 23:59 WIB tanggal 1.
    seedAttempt(db, campaign.id, youtube.id, '2026-01-01T16:59:00.000Z', 'hari-1');
    expect(gate.isExceeded(schedule, '2026-01-01')).toBe(false);

    seedAttempt(db, campaign.id, youtube.id, '2026-01-01T10:00:00.000Z', 'hari-1b');
    expect(gate.isExceeded(schedule, '2026-01-01')).toBe(true);

    // 2026-01-01T17:30Z sudah 00:30 WIB tanggal 2 dan hanya satu attempt akun lain.
    seedAttempt(db, campaign.id, other.id, '2026-01-01T17:30:00.000Z', 'hari-2');
    expect(gate.isExceeded(schedule, '2026-01-01')).toBe(true);
    expect(gate.isExceeded(schedule, '2026-01-02')).toBe(false);
  });
});
