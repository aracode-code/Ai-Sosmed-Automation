import { errorClassOf } from '@saa/domain';
import type { EnqueueFn, RunSummary, Scheduler } from './scheduler';

export interface DispatchLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface DispatchLoopOptions {
  scheduler: Pick<Scheduler, 'runOnce'>;
  enqueue: EnqueueFn;
  intervalMs?: number;
  logger?: DispatchLogger;
}

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Tick periodik yang memanggil `Scheduler.runOnce`. Berbeda dari `Worker`:
 * loop ini tidak mengerjakan job, hanya membuat job PUBLISH untuk jadwal yang due.
 */
export class ScheduleDispatchLoop {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: DispatchLoopOptions) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      this.tick();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
    this.tick();
  }

  /** Hentikan timer dan tunggu tick berjalan selesai agar tidak ada dispatch baru saat shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight !== null) await this.inFlight;
  }

  async runOnce(): Promise<RunSummary | null> {
    try {
      const summary = await this.options.scheduler.runOnce(this.options.enqueue);
      if (summary.enqueued > 0) {
        this.options.logger?.info({ ...summary }, 'scheduler: job publikasi dibuat');
      }
      if (summary.failed.length > 0) {
        this.options.logger?.warn({ failed: summary.failed }, 'scheduler: dispatch gagal');
      }
      return summary;
    } catch (error) {
      this.options.logger?.error(
        { errorClass: errorClassOf(error), err: error },
        'scheduler: siklus gagal'
      );
      return null;
    }
  }

  private tick(): void {
    if (this.stopped || this.inFlight !== null) return;
    this.inFlight = this.runOnce()
      .then(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
  }
}
