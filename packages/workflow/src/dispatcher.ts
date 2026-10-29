import {
  errorClassOf,
  transitionJob,
  type Job,
  type JobEvent,
  type JobType
} from '@saa/domain';
import {
  applyTransition,
  claimDueJob,
  getJob,
  promoteDueRetries,
  releaseLease,
  type DatabaseHandle,
  type TransitionPatch
} from '@saa/database';
import {
  classify,
  computeBackoffMs,
  retryAfterOf,
  type BackoffConfig
} from './retry';

export interface LoggerLike {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface HandlerContext {
  readonly job: Job;
  /** Satu-satunya jalan mengubah status job: lewat state machine domain. */
  transition(event: JobEvent, patch?: TransitionPatch): Job;
}

export type JobHandler = (context: HandlerContext) => Promise<void>;

export type HandlerRegistry = Partial<Record<JobType, JobHandler>>;

export interface DispatcherOptions {
  db: DatabaseHandle;
  workerId: string;
  handlers: HandlerRegistry;
  leaseTtlMs?: number;
  now?: () => Date;
  logger?: LoggerLike;
  backoff?: Partial<BackoffConfig>;
}

export class Dispatcher {
  constructor(private readonly options: DispatcherOptions) {}

  /** Satu siklus: promosikan retry due, klaim satu job, jalankan handler. */
  async runOnce(): Promise<Job | null> {
    const { db, workerId, handlers, leaseTtlMs = 30_000, now = () => new Date(), logger } =
      this.options;
    const nowIso = now().toISOString();

    promoteDueRetries(db.raw, nowIso);

    const job = claimDueJob(db.raw, { workerId, leaseTtlMs, now: nowIso });
    if (job === null) return null;

    const handler = handlers[job.jobType];
    if (handler === undefined) {
      logger?.warn({ jobId: job.id, jobType: job.jobType }, 'handler belum terdaftar');
      return applyTransition(db.raw, {
        jobId: job.id,
        from: job.status,
        to: 'NEEDS_ATTENTION',
        now: nowIso,
        patch: { lastErrorCode: 'NO_HANDLER', clearLease: true }
      });
    }

    try {
      await handler(this.handlerContext(job, nowIso));
      releaseLease(db.raw, { jobId: job.id, workerId, now: nowIso });
      return getJob(db.raw, job.id);
    } catch (error) {
      logger?.error(
        { jobId: job.id, errorClass: errorClassOf(error), err: error },
        'handler job gagal'
      );
      return this.handleFailure(job.id, error, nowIso);
    }
  }

  private handlerContext(job: Job, nowIso: string): HandlerContext {
    const { db } = this.options;
    let current = job;

    return {
      get job() {
        return current;
      },
      transition: (event: JobEvent, patch?: TransitionPatch): Job => {
        const result = transitionJob(current.status, event);
        if (!result.ok) throw new Error(result.reason);

        const updated = applyTransition(db.raw, {
          jobId: current.id,
          from: current.status,
          to: result.status,
          now: nowIso,
          patch
        });
        if (updated === null) {
          throw new Error(`transisi ${current.status} -> ${result.status} gagal diterapkan`);
        }
        current = updated;
        return updated;
      }
    };
  }

  private handleFailure(jobId: string, error: unknown, nowIso: string): Job | null {
    const { db, logger } = this.options;
    const job = getJob(db.raw, jobId);
    if (job === null) return null;

    const errorCode = errorClassOf(error);
    const decision = classify(error);
    const attempts = job.attempts + 1;

    let event: JobEvent;
    let runAt: string | null = null;

    if (decision === 'cancel') {
      event = { type: 'CANCEL' };
    } else if (decision === 'retry' && attempts < job.maxAttempts) {
      event = { type: 'RETRYABLE_FAILURE' };
      const delay = computeBackoffMs(attempts, this.options.backoff, retryAfterOf(error));
      runAt = new Date(Date.parse(nowIso) + delay).toISOString();
    } else if (decision === 'escalate') {
      event = { type: 'ESCALATE' };
    } else {
      event = { type: 'PERMANENT_FAILURE' };
    }

    const patch: TransitionPatch = {
      attempts,
      lastErrorCode: errorCode,
      clearLease: true,
      ...(runAt === null ? {} : { runAt })
    };

    const direct = transitionJob(job.status, event);
    if (direct.ok) {
      return applyTransition(db.raw, {
        jobId,
        from: job.status,
        to: direct.status,
        now: nowIso,
        patch
      });
    }

    logger?.warn(
      { jobId, from: job.status, event: event.type, reason: direct.reason },
      'transisi kegagalan ditolak, dieskalasi ke NEEDS_ATTENTION'
    );

    const escalated = transitionJob(job.status, { type: 'ESCALATE' });
    if (!escalated.ok) return job;

    return applyTransition(db.raw, {
      jobId,
      from: job.status,
      to: escalated.status,
      now: nowIso,
      patch
    });
  }
}
