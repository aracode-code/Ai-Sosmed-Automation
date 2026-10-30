import { isTerminalStatus, type JobStatus } from './job';

export interface PublishEvidence {
  externalPostId?: string;
  permalink?: string;
  verifiedAt: string;
}

export type RetrySafeState =
  | 'QUEUED'
  | 'PLANNING'
  | 'GENERATING'
  | 'DOWNLOADING'
  | 'VALIDATING'
  | 'SCHEDULED';

export type JobEvent =
  | { type: 'START_PLANNING' }
  | { type: 'START_GENERATION' }
  | { type: 'PLAN_READY' }
  | { type: 'GENERATION_COMPLETED' }
  | { type: 'DOWNLOAD_COMPLETED' }
  | { type: 'VALIDATION_PASSED'; approvalRequired: boolean }
  | { type: 'APPROVED' }
  | { type: 'PUBLISH_STARTED' }
  | { type: 'PUBLISH_SUBMITTED' }
  | { type: 'VERIFICATION_SUCCEEDED'; evidence: PublishEvidence }
  | { type: 'VERIFICATION_FAILED' }
  | { type: 'STEP_COMPLETED' }
  | { type: 'RETRYABLE_FAILURE' }
  | { type: 'RETRY_DUE'; target: RetrySafeState }
  | { type: 'REQUEUE' }
  | { type: 'RECOVER_REQUEUE' }
  | { type: 'AMBIGUOUS_RESULT' }
  | { type: 'ESCALATE' }
  | { type: 'PERMANENT_FAILURE' }
  | { type: 'CANCEL' };

export interface TransitionContext {
  /** Default true untuk PUBLISHING/VERIFYING: status eksternal belum pasti, cancel ditolak. */
  externalActionInProgress?: boolean;
}

export type TransitionResult =
  | { ok: true; status: JobStatus }
  | { ok: false; reason: string };

const RETRY_SAFE_STATES: readonly RetrySafeState[] = [
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'DOWNLOADING',
  'VALIDATING',
  'SCHEDULED'
];

const RETRYABLE_FAILURE_SOURCES: readonly JobStatus[] = [
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'DOWNLOADING',
  'VALIDATING',
  'AWAITING_APPROVAL',
  'SCHEDULED'
];

const AMBIGUOUS_SOURCES: readonly JobStatus[] = ['PUBLISHING', 'VERIFYING', 'RETRY_WAIT'];

/** Lease kedaluwarsa (worker mati) boleh dikembalikan ke antrean, kecuali state dengan aksi eksternal. */
const RECOVERABLE_STATES: readonly JobStatus[] = [
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'DOWNLOADING',
  'VALIDATING',
  'AWAITING_APPROVAL',
  'SCHEDULED',
  'RETRY_WAIT',
  'NEEDS_ATTENTION'
];

const IRREVERSIBLE_STATES: readonly JobStatus[] = ['PUBLISHING', 'VERIFYING'];

/** Job per langkah workflow berakhir di COMPLETED; publication berakhir di PUBLISHED. */
const STEP_COMPLETION_SOURCES: readonly JobStatus[] = [
  'PLANNING',
  'GENERATING',
  'DOWNLOADING',
  'VALIDATING'
];

function accept(status: JobStatus): TransitionResult {
  return { ok: true, status };
}

function reject(current: JobStatus, event: JobEvent['type']): TransitionResult {
  return { ok: false, reason: `transisi ilegal: ${current} + ${event}` };
}

function hasEvidence(evidence: PublishEvidence | undefined): boolean {
  if (!evidence) return false;
  const hasIdentity = Boolean(evidence.externalPostId?.trim()) || Boolean(evidence.permalink?.trim());
  return hasIdentity && Boolean(evidence.verifiedAt?.trim());
}

export function canCancel(current: JobStatus, ctx: TransitionContext = {}): boolean {
  if (isTerminalStatus(current)) return false;
  if (IRREVERSIBLE_STATES.includes(current)) {
    return ctx.externalActionInProgress === false;
  }
  return true;
}

export function transitionJob(
  current: JobStatus,
  event: JobEvent,
  ctx: TransitionContext = {}
): TransitionResult {
  if (isTerminalStatus(current)) {
    return { ok: false, reason: `status terminal: ${current}` };
  }

  switch (event.type) {
    case 'START_PLANNING':
      return current === 'QUEUED' ? accept('PLANNING') : reject(current, event.type);

    case 'START_GENERATION':
      return current === 'QUEUED' ? accept('GENERATING') : reject(current, event.type);

    case 'PLAN_READY':
      return current === 'PLANNING' ? accept('GENERATING') : reject(current, event.type);

    case 'GENERATION_COMPLETED':
      return current === 'GENERATING' ? accept('DOWNLOADING') : reject(current, event.type);

    case 'DOWNLOAD_COMPLETED':
      return current === 'DOWNLOADING' ? accept('VALIDATING') : reject(current, event.type);

    case 'VALIDATION_PASSED':
      if (current !== 'VALIDATING') return reject(current, event.type);
      return accept(event.approvalRequired ? 'AWAITING_APPROVAL' : 'SCHEDULED');

    case 'APPROVED':
      return current === 'AWAITING_APPROVAL' ? accept('SCHEDULED') : reject(current, event.type);

    case 'PUBLISH_STARTED':
      // QUEUED juga diterima: promosi retry selalu mengembalikan job ke QUEUED.
      return current === 'SCHEDULED' || current === 'QUEUED'
        ? accept('PUBLISHING')
        : reject(current, event.type);

    case 'PUBLISH_SUBMITTED':
      return current === 'PUBLISHING' ? accept('VERIFYING') : reject(current, event.type);

    case 'VERIFICATION_SUCCEEDED':
      if (current !== 'VERIFYING') return reject(current, event.type);
      if (!hasEvidence(event.evidence)) {
        return { ok: false, reason: 'PUBLISHED membutuhkan bukti verifikasi (externalPostId/permalink + verifiedAt)' };
      }
      return accept('PUBLISHED');

    case 'VERIFICATION_FAILED':
      return current === 'VERIFYING' ? accept('RETRY_WAIT') : reject(current, event.type);

    case 'STEP_COMPLETED':
      return STEP_COMPLETION_SOURCES.includes(current)
        ? accept('COMPLETED')
        : reject(current, event.type);

    case 'RETRYABLE_FAILURE':
      return RETRYABLE_FAILURE_SOURCES.includes(current)
        ? accept('RETRY_WAIT')
        : reject(current, event.type);

    case 'RETRY_DUE': {
      if (current !== 'RETRY_WAIT') return reject(current, event.type);
      if (!RETRY_SAFE_STATES.includes(event.target)) {
        return { ok: false, reason: `retry target tidak aman: ${event.target}` };
      }
      return accept(event.target);
    }

    case 'REQUEUE':
      return current === 'NEEDS_ATTENTION' ? accept('QUEUED') : reject(current, event.type);

    case 'RECOVER_REQUEUE':
      return RECOVERABLE_STATES.includes(current) ? accept('QUEUED') : reject(current, event.type);

    case 'AMBIGUOUS_RESULT':
      return AMBIGUOUS_SOURCES.includes(current)
        ? accept('NEEDS_ATTENTION')
        : reject(current, event.type);

    case 'ESCALATE':
      return accept('NEEDS_ATTENTION');

    case 'PERMANENT_FAILURE':
      return accept('FAILED');

    case 'CANCEL':
      return canCancel(current, ctx) ? accept('CANCELLED') : reject(current, event.type);
  }
}

export function assertTransition(
  current: JobStatus,
  event: JobEvent,
  ctx: TransitionContext = {}
): JobStatus {
  const result = transitionJob(current, event, ctx);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.status;
}
