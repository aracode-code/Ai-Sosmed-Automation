import { createHash } from 'node:crypto';
import type {
  PlatformCapabilities,
  PublishRequest,
  PublishResult,
  PublishValidationResult,
  SocialAdapter
} from '@saa/domain';

export type MockPublishOutcome =
  | 'published'
  | 'processing'
  | 'unknown'
  | 'failed_retryable'
  | 'failed_permanent';

export interface MockYouTubeAdapterOptions {
  /** Hasil `publish()`; default `published`. */
  outcome?: MockPublishOutcome;
  /** Hasil `getStatus()` setelah publish; default mengikuti `outcome`. */
  statusOutcome?: MockPublishOutcome;
  now?: () => Date;
  maxCaptionLength?: number;
}

const DEFAULT_MAX_CAPTION = 5_000;

function postIdOf(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  return `mock_yt_${digest.slice(0, 11)}`;
}

function resultFor(outcome: MockPublishOutcome, idempotencyKey: string): PublishResult {
  const externalPostId = postIdOf(idempotencyKey);
  switch (outcome) {
    case 'published':
      return {
        status: 'published',
        externalPostId,
        permalink: `https://www.youtube.com/watch?v=${externalPostId}`,
        retryable: false
      };
    case 'processing':
      return { status: 'processing', retryable: true };
    case 'unknown':
      return { status: 'unknown', retryable: true, errorCode: 'MOCK_UNKNOWN' };
    case 'failed_retryable':
      return { status: 'failed', retryable: true, errorCode: 'MOCK_FAILED_RETRYABLE' };
    case 'failed_permanent':
      return { status: 'failed', retryable: false, errorCode: 'MOCK_FAILED_PERMANENT' };
  }
}

/**
 * Adapter YouTube palsu untuk menguji alur publish/verify/reconcile tanpa OAuth
 * dan tanpa unggahan nyata. Semua penanda memakai prefiks `mock_` agar baris DB
 * tidak dapat disalahartikan sebagai publikasi nyata.
 */
export class MockYouTubeAdapter implements SocialAdapter {
  readonly platform = 'youtube' as const;
  private readonly now: () => Date;
  private readonly maxCaptionLength: number;
  private readonly results = new Map<string, PublishResult>();

  constructor(private readonly options: MockYouTubeAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxCaptionLength = options.maxCaptionLength ?? DEFAULT_MAX_CAPTION;
  }

  async capabilities(): Promise<PlatformCapabilities> {
    return {
      platform: 'youtube',
      adapterVersion: 'mock-1',
      authStatus: 'connected',
      textSupported: false,
      videoSupported: true,
      directPublishSupported: true,
      draftSupported: false,
      schedulingSupported: false,
      lastVerifiedAt: this.now().toISOString(),
      limitations: [
        'mock adapter — tidak ada unggahan nyata',
        'kuota, izin, dan batas media YouTube belum diverifikasi (OD-2/OD-5)'
      ]
    };
  }

  async validate(request: PublishRequest): Promise<PublishValidationResult> {
    const issues: string[] = [];
    if (request.accountId.trim() === '') issues.push('accountId kosong');
    if (request.assetId.trim() === '') issues.push('assetId kosong');
    if (request.caption.trim() === '') {
      issues.push('caption kosong');
    } else if (request.caption.length > this.maxCaptionLength) {
      issues.push(`caption melebihi ${this.maxCaptionLength} karakter`);
    }
    return { ok: issues.length === 0, issues };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const existing = this.results.get(request.idempotencyKey);
    if (existing?.status === 'published') return existing;

    const result = resultFor(this.options.outcome ?? 'published', request.idempotencyKey);
    this.results.set(request.idempotencyKey, result);
    return result;
  }

  async getStatus(idempotencyKey: string): Promise<PublishResult> {
    const stored = this.results.get(idempotencyKey);
    if (stored === undefined) {
      return { status: 'unknown', retryable: true, errorCode: 'MOCK_UNKNOWN_KEY' };
    }
    const outcome = this.options.statusOutcome;
    return outcome === undefined ? stored : resultFor(outcome, idempotencyKey);
  }
}
