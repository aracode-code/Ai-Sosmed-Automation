import { getMediaAsset, updateAccountConnection, type DatabaseHandle } from '@saa/database';
import type { SocialAdapter } from '@saa/domain';
import { DpapiCredentialStore, YouTubeApiAdapter, type CredentialStore } from '@saa/youtube';
import type { AppConfig, YouTubeCredentials } from './config';

/** Nilai `social_accounts.secret_ref`; rahasianya sendiri hanya ada di blob DPAPI. */
export function youtubeSecretRef(accountId: string): string {
  return `dpapi:youtube:${accountId}`;
}

export interface YouTubeApiPublisherOptions {
  db: DatabaseHandle;
  config: AppConfig;
  credentials: YouTubeCredentials;
  /** Disuntikkan pada test; default DPAPI di `%LOCALAPPDATA%`. */
  store?: CredentialStore;
  fetchImpl?: typeof fetch;
}

/**
 * Adapter YouTube nyata untuk composition root (ADR-0008 A3–A4): aset diresolusi dari
 * `media_assets`, token dari credential store, dan akun yang perlu pairing ulang ditandai
 * di database agar terlihat lewat `GET /api/v1/accounts`.
 */
export function createYouTubeApiPublisher(options: YouTubeApiPublisherOptions): SocialAdapter {
  const store = options.store ?? new DpapiCredentialStore();
  return new YouTubeApiAdapter({
    store,
    clientId: options.credentials.clientId,
    ...(options.credentials.clientSecret === null
      ? {}
      : { clientSecret: options.credentials.clientSecret }),
    privacy: options.config.youtubeUploadPrivacy,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    resolveAsset: (assetId) => {
      const asset = getMediaAsset(options.db.raw, assetId);
      if (asset === null) return null;
      return { path: asset.path, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes };
    },
    onReauthRequired: (accountId) => {
      updateAccountConnection(options.db.raw, accountId, { connectionStatus: 'reauth_required' });
    }
  });
}
