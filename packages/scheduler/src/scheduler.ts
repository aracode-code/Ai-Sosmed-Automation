import { errorClassOf, type Schedule } from '@saa/domain';
import {
  getSetting,
  listDueSchedules,
  setScheduleNextRun,
  setSetting,
  type DatabaseHandle
} from '@saa/database';
import { createDbQuotaGate, type QuotaGate } from './quota';
import { computeNextRun, shiftIntoAllowedSlot } from './schedule';
import { formatLocalDate } from './time';

export const SCHEDULER_PAUSED_KEY = 'scheduler.paused';

export interface EnqueueContext {
  now: Date;
  localDate: string;
}

/** Mengembalikan id job yang dibuat; array kosong berarti tidak ada target siap. */
export type EnqueueFn = (
  schedule: Schedule,
  context: EnqueueContext
) => string[] | Promise<string[]>;

export interface RunSummary {
  paused: boolean;
  due: number;
  seeded: number;
  shifted: number;
  quotaSkipped: number;
  enqueued: number;
  failed: Array<{ scheduleId: string; errorClass: string }>;
}

export interface SchedulerOptions {
  now?: () => Date;
  rng?: () => number;
  quota?: QuotaGate;
}

export function setSchedulerPaused(
  db: DatabaseHandle,
  paused: boolean,
  now: Date = new Date()
): void {
  setSetting(db.raw, SCHEDULER_PAUSED_KEY, paused, now.toISOString());
}

export function isSchedulerPaused(db: DatabaseHandle): boolean {
  return getSetting<boolean>(db.raw, SCHEDULER_PAUSED_KEY) === true;
}

export class Scheduler {
  private readonly now: () => Date;
  private readonly rng: () => number;
  private readonly quota: QuotaGate;

  constructor(
    private readonly db: DatabaseHandle,
    options: SchedulerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.rng = options.rng ?? Math.random;
    this.quota = options.quota ?? createDbQuotaGate(db);
  }

  isPaused(): boolean {
    return isSchedulerPaused(this.db);
  }

  pause(): void {
    setSchedulerPaused(this.db, true, this.now());
  }

  resume(): void {
    setSchedulerPaused(this.db, false, this.now());
  }

  /**
   * Satu putaran scheduler. `enqueue` hanya dipanggil untuk jadwal due, di dalam
   * window, dan masih memiliki kuota. next_run_at dihitung dari `now` setelah
   * enqueue berhasil, lalu dipersist agar restart tidak mengubahnya.
   */
  async runOnce(enqueue: EnqueueFn): Promise<RunSummary> {
    const summary: RunSummary = {
      paused: false,
      due: 0,
      seeded: 0,
      shifted: 0,
      quotaSkipped: 0,
      enqueued: 0,
      failed: []
    };

    if (this.isPaused()) {
      summary.paused = true;
      return summary;
    }

    const now = this.now();
    const dueSchedules = listDueSchedules(this.db.raw, now.toISOString());
    summary.due = dueSchedules.length;

    for (const schedule of dueSchedules) {
      if (schedule.nextRunAt === null) {
        setScheduleNextRun(this.db.raw, schedule.id, computeNextRun(schedule, now, this.rng).toISOString());
        summary.seeded += 1;
        continue;
      }

      const aligned = shiftIntoAllowedSlot(now, schedule);
      if (aligned.getTime() > now.getTime()) {
        setScheduleNextRun(this.db.raw, schedule.id, aligned.toISOString());
        summary.shifted += 1;
        continue;
      }

      const localDate = formatLocalDate(now, schedule.timezone);
      if (this.quota.isExceeded(schedule, localDate)) {
        summary.quotaSkipped += 1;
        continue;
      }

      let jobIds: string[];
      try {
        jobIds = await enqueue(schedule, { now, localDate });
      } catch (error) {
        summary.failed.push({ scheduleId: schedule.id, errorClass: errorClassOf(error) });
        continue;
      }

      summary.enqueued += jobIds.length;
      setScheduleNextRun(this.db.raw, schedule.id, computeNextRun(schedule, now, this.rng).toISOString());
    }

    return summary;
  }
}
