import { AppError, errorClassOf, type ErrorClass } from '@saa/domain';

export type RetryDecision = 'retry' | 'escalate' | 'fail' | 'cancel';

const ESCALATE_CLASSES: readonly ErrorClass[] = [
  'AUTH',
  'SECURITY_CHALLENGE',
  'UI_CHANGED',
  'AMBIGUOUS_RESULT',
  'DISK'
];

const FAIL_CLASSES: readonly ErrorClass[] = ['VALIDATION'];

export function classify(error: unknown): RetryDecision {
  const errorClass = errorClassOf(error);
  if (errorClass === 'CANCELLED') return 'cancel';
  if (ESCALATE_CLASSES.includes(errorClass)) return 'escalate';
  if (FAIL_CLASSES.includes(errorClass)) return 'fail';
  return 'retry';
}

export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  jitterMs: number;
  rng: () => number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 2000,
  maxMs: 300_000,
  jitterMs: 1000,
  rng: Math.random
};

/** Exponential backoff + jitter; `overrideMs` (mis. Retry-After) tidak pernah memperkecil jeda. */
export function computeBackoffMs(
  attempt: number,
  config: Partial<BackoffConfig> = {},
  overrideMs?: number
): number {
  const merged = { ...DEFAULT_BACKOFF, ...config };
  const exponential = Math.min(merged.baseMs * 2 ** Math.max(attempt - 1, 0), merged.maxMs);
  const base = overrideMs === undefined ? exponential : Math.max(exponential, overrideMs);
  return base + Math.floor(merged.rng() * merged.jitterMs);
}

export function retryAfterOf(error: unknown): number | undefined {
  return error instanceof AppError ? error.options.retryAfterMs : undefined;
}
