import { describe, expect, it } from 'vitest';
import { transitionJob, type JobEvent, type JobStatus } from './index';

function run(start: JobStatus, events: JobEvent[], ctx = {}): JobStatus {
  let status = start;
  for (const event of events) {
    const result = transitionJob(status, event, ctx);
    if (!result.ok) {
      throw new Error(`unexpected reject at ${status} + ${event.type}: ${result.reason}`);
    }
    status = result.status;
  }
  return status;
}

const EVIDENCE = { externalPostId: 'yt_123', verifiedAt: '2026-10-29T10:00:00.000Z' };

describe('state machine — happy path', () => {
  it('menelusuri QUEUED sampai PUBLISHED', () => {
    const finalStatus = run('QUEUED', [
      { type: 'START_PLANNING' },
      { type: 'PLAN_READY' },
      { type: 'GENERATION_COMPLETED' },
      { type: 'DOWNLOAD_COMPLETED' },
      { type: 'VALIDATION_PASSED', approvalRequired: false },
      { type: 'PUBLISH_STARTED' },
      { type: 'PUBLISH_SUBMITTED' },
      { type: 'VERIFICATION_SUCCEEDED', evidence: EVIDENCE }
    ]);
    expect(finalStatus).toBe('PUBLISHED');
  });

  it('mode approval menahan publikasi sampai APPROVED', () => {
    const pending = run('VALIDATING', [
      { type: 'VALIDATION_PASSED', approvalRequired: true }
    ]);
    expect(pending).toBe('AWAITING_APPROVAL');
    expect(run(pending, [{ type: 'APPROVED' }])).toBe('SCHEDULED');
  });
});

describe('state machine — penolakan', () => {
  it('menolak PUBLISHED tanpa bukti', () => {
    const result = transitionJob('VERIFYING', {
      type: 'VERIFICATION_SUCCEEDED',
      evidence: { verifiedAt: '2026-10-29T10:00:00.000Z' }
    });
    expect(result.ok).toBe(false);
  });

  it('menolak retry langsung dari PUBLISHING (wajib rekonsiliasi)', () => {
    const result = transitionJob('PUBLISHING', { type: 'RETRYABLE_FAILURE' });
    expect(result.ok).toBe(false);
  });

  it('menolak cancel saat aksi eksternal berjalan', () => {
    expect(transitionJob('PUBLISHING', { type: 'CANCEL' }).ok).toBe(false);
    expect(transitionJob('VERIFYING', { type: 'CANCEL' }).ok).toBe(false);
  });

  it('mengizinkan cancel hanya bila dipastikan tidak ada aksi eksternal', () => {
    const result = transitionJob('PUBLISHING', { type: 'CANCEL' }, { externalActionInProgress: false });
    expect(result).toEqual({ ok: true, status: 'CANCELLED' });
  });

  it('menolak event apa pun dari status terminal', () => {
    for (const status of ['PUBLISHED', 'FAILED', 'CANCELLED'] as const) {
      expect(transitionJob(status, { type: 'ESCALATE' }).ok).toBe(false);
    }
  });

  it('menolak retry kembali ke PUBLISHING', () => {
    const result = transitionJob('RETRY_WAIT', {
      type: 'RETRY_DUE',
      target: 'PUBLISHING' as never
    });
    expect(result.ok).toBe(false);
  });
});

describe('state machine — jalur pemulihan', () => {
  it('hasil ambigu menjadi NEEDS_ATTENTION, bukan retry buta', () => {
    expect(transitionJob('PUBLISHING', { type: 'AMBIGUOUS_RESULT' })).toEqual({
      ok: true,
      status: 'NEEDS_ATTENTION'
    });
  });

  it('REQUEUE mengembalikan job ke QUEUED', () => {
    expect(transitionJob('NEEDS_ATTENTION', { type: 'REQUEUE' })).toEqual({
      ok: true,
      status: 'QUEUED'
    });
  });

  it('RETRY_DUE kembali ke state aman', () => {
    expect(transitionJob('RETRY_WAIT', { type: 'RETRY_DUE', target: 'VALIDATING' })).toEqual({
      ok: true,
      status: 'VALIDATING'
    });
  });

  it('kegagalan permanen menjadi FAILED dari state aktif mana pun', () => {
    expect(transitionJob('DOWNLOADING', { type: 'PERMANENT_FAILURE' })).toEqual({
      ok: true,
      status: 'FAILED'
    });
  });

  it('lease kedaluwarsa mengembalikan job ke QUEUED, tapi tidak dari PUBLISHING', () => {
    expect(transitionJob('GENERATING', { type: 'RECOVER_REQUEUE' })).toEqual({
      ok: true,
      status: 'QUEUED'
    });
    expect(transitionJob('PUBLISHING', { type: 'RECOVER_REQUEUE' }).ok).toBe(false);
  });
});
