import { errorClassOf, type Job } from '@saa/domain';
import type { LoggerLike } from './dispatcher';

/** Minimal yang dibutuhkan loop; `Dispatcher` memenuhi kontrak ini. */
export interface JobRunner {
  runOnce(): Promise<Job | null>;
}

export interface WorkerOptions {
  runner: JobRunner;
  intervalMs?: number;
  logger?: LoggerLike;
}

/**
 * Loop polling di dalam proses. Klaim job tetap atomik di SQLite, tetapi tick
 * lokal tidak boleh tumpang tindih agar satu worker tidak mengerjakan dua job.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: WorkerOptions) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      this.tick();
    }, this.options.intervalMs ?? 1_000);
    this.timer.unref();
    this.tick();
  }

  /** Hentikan timer dan tunggu tick yang sedang berjalan selesai. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight !== null) await this.inFlight;
  }

  /** Satu siklus; kegagalan di luar handler dicatat dan loop tetap hidup. */
  async runOnce(): Promise<Job | null> {
    try {
      return await this.options.runner.runOnce();
    } catch (error) {
      this.options.logger?.error(
        { errorClass: errorClassOf(error), err: error },
        'worker: siklus gagal'
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
