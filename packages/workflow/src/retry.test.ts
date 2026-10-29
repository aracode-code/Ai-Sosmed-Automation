import { describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import { classify, computeBackoffMs } from './index';

describe('classify', () => {
  it('mengklasifikasikan error sesuai kebijakan retry LLD §15', () => {
    expect(classify(new AppError('TRANSIENT_NETWORK', 'timeout'))).toBe('retry');
    expect(classify(new AppError('RATE_LIMIT', '429'))).toBe('retry');
    expect(classify(new AppError('EXTERNAL_5XX', '503'))).toBe('retry');
    expect(classify(new AppError('AUTH', 'token kedaluwarsa'))).toBe('escalate');
    expect(classify(new AppError('SECURITY_CHALLENGE', 'captcha'))).toBe('escalate');
    expect(classify(new AppError('AMBIGUOUS_RESULT', 'hasil tidak pasti'))).toBe('escalate');
    expect(classify(new AppError('VALIDATION', 'payload invalid'))).toBe('fail');
    expect(classify(new AppError('AI_OUTPUT_INVALID', 'output planner invalid'))).toBe('escalate');
    expect(classify(new AppError('CANCELLED', 'user stop'))).toBe('cancel');
    expect(classify(new Error('apa saja'))).toBe('retry');
  });
});

describe('computeBackoffMs', () => {
  const fixed = { jitterMs: 0, rng: () => 0 };

  it('naik eksponensial dan berhenti di plafon', () => {
    expect(computeBackoffMs(1, fixed)).toBe(2000);
    expect(computeBackoffMs(2, fixed)).toBe(4000);
    expect(computeBackoffMs(3, fixed)).toBe(8000);
    expect(computeBackoffMs(20, fixed)).toBe(300_000);
  });

  it('menghormati Retry-After yang lebih besar', () => {
    expect(computeBackoffMs(1, fixed, 60_000)).toBe(60_000);
    expect(computeBackoffMs(1, fixed, 500)).toBe(2000);
  });
});
