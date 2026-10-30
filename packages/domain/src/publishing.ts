import type { PlatformId } from './platform';

/** Kontrak adapter publikasi (LLD §11.1) — adapter mengimplementasikan interface domain. */
export interface PublishRequest {
  accountId: string;
  assetId: string;
  caption: string;
  title?: string;
  visibility?: string;
  idempotencyKey: string;
}

export type PublishStatus = 'published' | 'processing' | 'failed' | 'unknown';

export interface PublishResult {
  status: PublishStatus;
  externalPostId?: string;
  permalink?: string;
  errorCode?: string;
  retryable: boolean;
}

export interface PublishValidationResult {
  ok: boolean;
  issues: string[];
}

/** Capability wajib jujur (LLD §11.3): fitur belum terverifikasi = `false` + limitations. */
export interface PlatformCapabilities {
  platform: PlatformId;
  adapterVersion: string;
  authStatus: 'connected' | 'reauth_required' | 'disconnected';
  textSupported: boolean;
  videoSupported: boolean;
  directPublishSupported: boolean;
  draftSupported: boolean;
  schedulingSupported: boolean;
  maxUploadBytes?: number;
  supportedAspectRatios?: string[];
  lastVerifiedAt?: string;
  limitations: string[];
}

export interface CaptionTarget {
  caption: string;
  title?: string;
}

/**
 * Caption satu platform dari peta caption hasil planner. Bentuk tidak valid
 * dianggap tidak tersedia — enqueuer dan handler PUBLISH wajib menolak sama.
 */
export function resolveCaption(caption: unknown, platform: PlatformId): CaptionTarget | null {
  if (caption === null || typeof caption !== 'object' || Array.isArray(caption)) return null;
  const entry = (caption as Record<string, unknown>)[platform];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const text = (entry as Record<string, unknown>).caption;
  if (typeof text !== 'string' || text.trim() === '') return null;
  const title = (entry as Record<string, unknown>).title;
  return {
    caption: text,
    ...(typeof title === 'string' && title.trim() !== '' ? { title } : {})
  };
}

export interface SocialAdapter {
  readonly platform: PlatformId;
  capabilities(): Promise<PlatformCapabilities>;
  validate(request: PublishRequest): Promise<PublishValidationResult>;
  publish(request: PublishRequest): Promise<PublishResult>;
  /** Rekonsiliasi: status terakhir untuk idempotency key; `unknown` bila tidak dapat dipastikan. */
  getStatus(idempotencyKey: string): Promise<PublishResult>;
}
