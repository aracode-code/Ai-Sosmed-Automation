import { transitionJob, type Job, type JobEvent, type JobStatus } from '@saa/domain';
import { applyTransition, listExpiredLeases, type DatabaseHandle } from '@saa/database';
import type { LoggerLike } from './dispatcher';

const IRREVERSIBLE: readonly JobStatus[] = ['PUBLISHING', 'VERIFYING'];

export function isIrreversible(status: JobStatus): boolean {
  return IRREVERSIBLE.includes(status);
}

export function recoveryEventFor(status: JobStatus): JobEvent {
  return isIrreversible(status) ? { type: 'ESCALATE' } : { type: 'RECOVER_REQUEUE' };
}

export interface RecoveryOptions {
  now?: () => Date;
  logger?: LoggerLike;
}

export interface RecoveryResult {
  requeued: Job[];
  escalated: Job[];
}

/**
 * Pemulihan saat startup (LLD §14.2): lease kedaluwarsa berarti worker mati.
 * Job non-eksternal dikembalikan ke antrean; job yang mungkin sudah memanggil
 * platform tidak pernah diulang otomatis.
 */
export function runStartupRecovery(
  db: DatabaseHandle,
  options: RecoveryOptions = {}
): RecoveryResult {
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const logger = options.logger;
  const expired = listExpiredLeases(db.raw, nowIso);

  const requeued: Job[] = [];
  const escalated: Job[] = [];

  for (const job of expired) {
    const irreversible = isIrreversible(job.status);
    const exhausted = !irreversible && job.attempts + 1 >= job.maxAttempts;
    const event: JobEvent = exhausted ? { type: 'ESCALATE' } : recoveryEventFor(job.status);

    const result = transitionJob(job.status, event);
    if (!result.ok) {
      logger?.warn(
        { jobId: job.id, status: job.status, reason: result.reason },
        'recovery: transisi ditolak'
      );
      continue;
    }

    const updated = applyTransition(db.raw, {
      jobId: job.id,
      from: job.status,
      to: result.status,
      now: nowIso,
      patch: {
        attempts: irreversible ? job.attempts : job.attempts + 1,
        lastErrorCode: 'LEASE_EXPIRED',
        clearLease: true
      }
    });

    if (updated === null) continue;
    if (result.status === 'QUEUED') {
      requeued.push(updated);
    } else {
      escalated.push(updated);
    }
  }

  logger?.info(
    { requeued: requeued.length, escalated: escalated.length, expired: expired.length },
    'startup recovery selesai'
  );

  return { requeued, escalated };
}
