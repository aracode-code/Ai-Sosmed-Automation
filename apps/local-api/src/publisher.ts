import {
  getMediaAsset,
  getPublishAttemptByKey,
  listSocialAccounts,
  updateAccountConnection,
  type DatabaseHandle
} from '@saa/database';
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
  // `capabilities()` tidak membawa accountId; pakai akun YouTube satu-satunya bila tidak ambigu.
  const youtubeAccounts = listSocialAccounts(options.db.raw).filter(
    (account) => account.platform === 'youtube'
  );
  const soleAccountId = youtubeAccounts.length === 1 ? youtubeAccounts[0]!.id : undefined;
  return new YouTubeApiAdapter({
    store,
    clientId: options.credentials.clientId,
    ...(options.credentials.clientSecret === null
      ? {}
      : { clientSecret: options.credentials.clientSecret }),
    ...(soleAccountId === undefined ? {} : { accountId: soleAccountId }),
    privacy: options.config.youtubeUploadPrivacy,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    resolveAsset: (assetId) => {
      const asset = getMediaAsset(options.db.raw, assetId);
      if (asset === null) return null;
      return { path: asset.path, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes };
    },
    onReauthRequired: (accountId) => {
      updateAccountConnection(options.db.raw, accountId, { connectionStatus: 'reauth_required' });
    },
    // Rekonsiliasi lintas restart: attempt yang sudah menyimpan videoId dipakai ulang
    // sehingga handler tidak mengunggah video kedua untuk job yang sama.
    resolveUpload: (idempotencyKey) => {
      const attempt = getPublishAttemptByKey(options.db.raw, idempotencyKey);
      if (attempt === null || attempt.platform !== 'youtube') return null;
      const videoId = attempt.externalPostId?.trim() ?? '';
      if (videoId === '') return null;
      return {
        accountId: attempt.accountId,
        videoId,
        privacy: options.config.youtubeUploadPrivacy
      };
    }
  });
}
