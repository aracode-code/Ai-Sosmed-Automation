import { readFile, stat } from 'node:fs/promises';
import { AppError, errorClassOf } from '@saa/domain';
import type {
  PlatformCapabilities,
  PublishRequest,
  PublishResult,
  PublishValidationResult,
  SocialAdapter
} from '@saa/domain';
import type { CredentialStore } from './credential-store';
import {
  credentialNameFor,
  ensureFreshAccessToken,
  YouTubeAuthError,
  type YouTubeTokenRecord
} from './oauth-client';

/** Endpoint `videos.insert` (ADR-0008 D1). `part` wajib sama dengan kunci body. */
export const YOUTUBE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos';
/** Endpoint `videos.list` untuk rekonsiliasi status (ADR-0008 D4). */
export const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

export const DEFAULT_YOUTUBE_CATEGORY_ID = '27';
export const DEFAULT_YOUTUBE_PRIVACY = 'private' as const;

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5_000;
const MAX_ERROR_BODY_CHARS = 8_192;
const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
/** Batas lanjutan per unggahan; sesudah ini hasil dianggap `unknown` (tidak diulang dari awal). */
const MAX_RESUME_ATTEMPTS = 3;

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface YouTubeAssetSource {
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface YouTubeApiAdapterOptions {
  store: CredentialStore;
  clientId: string;
  clientSecret?: string | null;
  /** Resolusi `assetId` → berkas di disk. Disuntikkan agar paket ini tidak bergantung pada DB. */
  resolveAsset: (assetId: string) => YouTubeAssetSource | null;
  privacy?: YouTubePrivacyStatus;
  categoryId?: string;
  /** Opsional; hanya dipakai `capabilities()` untuk melaporkan status auth akun tersebut. */
  accountId?: string;
  /**
   * Dipanggil saat akun dipastikan perlu pairing ulang. Wiring runtime memakainya untuk
   * memperbarui `social_accounts.connection_status`; adapter tetap bebas database.
   */
  onReauthRequired?: (accountId: string) => void | Promise<void>;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  uploadEndpoint?: string;
  videosEndpoint?: string;
  tokenEndpoint?: string;
  uploadTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface UploadRecord {
  accountId: string;
  videoId: string;
  privacy: YouTubePrivacyStatus;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringField(source: JsonRecord | null, key: string): string | null {
  if (source === null) return null;
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isPrivacyStatus(value: string): value is YouTubePrivacyStatus {
  return value === 'private' || value === 'unlisted' || value === 'public';
}

/**
 * Byte yang sudah diterima server menurut header `Range` pada respons 308.
 * Format yang diterima: `bytes=0-N` (offset terakhir) atau bentuk total-saja
 * `bytes=` + bintang + `/total` (berarti 0 byte diterima).
 * `null` = server tidak memberi progres, jadi unggahan tidak boleh dilanjutkan.
 */
function receivedBytesOf(response: Response, totalBytes: number): number | null {
  const header = response.headers.get('range');
  if (header === null) return null;
  const value = header.trim();
  const partial = /^bytes=0-(\d+)$/i.exec(value);
  if (partial !== null) {
    const last = Number(partial[1]);
    if (!Number.isInteger(last) || last < 0 || last + 1 > totalBytes) return null;
    return last + 1;
  }
  return /^bytes=\*\/\d+$/i.test(value) ? 0 : null;
}

function retryAfterMsOf(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

interface ApiFailure {
  reason: string | null;
  message: string | null;
}

function failureOf(body: unknown): ApiFailure {
  const error = asRecord(asRecord(body)?.error);
  let reason: string | null = null;
  const entries = error?.errors;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const candidate = stringField(asRecord(entry), 'reason');
      if (candidate !== null) {
        reason = candidate;
        break;
      }
    }
  }
  const message = stringField(error, 'message');
  return { reason, message: message === null ? null : message.slice(0, 200) };
}

function isQuotaReason(reason: string | null): boolean {
  return (
    reason === 'quotaExceeded' ||
    reason === 'dailyLimitExceeded' ||
    reason === 'uploadLimitExceeded'
  );
}

function isRateLimitReason(reason: string | null): boolean {
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

/**
 * Kuota/limit harian dipetakan ke kelas `AUTH` karena satu-satunya kelas yang
 * mengeskalasi tanpa retry (`packages/workflow/src/retry.ts`). Retry tidak akan
 * berhasil sampai kuota direset atau limit project dinaikkan — pemilik harus bertindak.
 */
function apiErrorOf(context: string, status: number, body: unknown, retryAfterMs?: number): AppError {
  const { reason, message } = failureOf(body);
  const detail = reason ?? message ?? 'tanpa detail';
  const options = retryAfterMs === undefined ? {} : { retryAfterMs };

  if (isQuotaReason(reason)) {
    return new AppError(
      'AUTH',
      `${context}: kuota/limit YouTube habis (${detail}); perlu tindakan pemilik akun`
    );
  }
  if (status === 429 || isRateLimitReason(reason)) {
    return new AppError('RATE_LIMIT', `${context}: YouTube membatasi laju (${detail})`, options);
  }
  if (status === 401) {
    return new AppError('AUTH', `${context}: akses YouTube ditolak (401); pairing ulang mungkin diperlukan`);
  }
  if (status === 403) {
    return new AppError('AUTH', `${context}: akses YouTube ditolak (${detail})`);
  }
  if (status >= 500) {
    return new AppError('EXTERNAL_5XX', `${context}: YouTube gagal (HTTP ${status})`, options);
  }
  return new AppError('VALIDATION', `${context}: permintaan ditolak (HTTP ${status} — ${detail})`);
}

function requestOnce(
  doFetch: typeof fetch,
  url: string,
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
  context: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();

  return Promise.resolve()
    .then(() => doFetch(url, { ...init, signal: controller.signal }))
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        throw new AppError('TRANSIENT_NETWORK', `${context}: tidak merespons dalam ${timeoutMs} ms`, {
          cause: error
        });
      }
      throw new AppError('TRANSIENT_NETWORK', `${context}: gagal menghubungi YouTube`, {
        cause: error
      });
    })
    .finally(() => clearTimeout(timer));
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  const clipped = text.length > MAX_ERROR_BODY_CHARS ? text.slice(0, MAX_ERROR_BODY_CHARS) : text;
  try {
    return JSON.parse(clipped) as unknown;
  } catch {
    return null;
  }
}

/**
 * Adapter YouTube Data API v3 nyata (ADR-0008). Tanpa SDK: OAuth memakai
 * `oauth-client.ts`, unggahan memakai `videos.insert` resumable, dan status
 * hanya dipercaya setelah `videos.list` memverifikasi `privacyStatus`.
 */
export class YouTubeApiAdapter implements SocialAdapter {
  readonly platform = 'youtube' as const;
  private readonly options: YouTubeApiAdapterOptions;
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;
  private readonly categoryId: string;
  private readonly uploadEndpoint: string;
  private readonly videosEndpoint: string;
  private readonly uploadTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  /** Pemetaan sementara; hilang saat proses berakhir (restart → `unknown`, bukan tebakan). */
  private readonly uploads = new Map<string, UploadRecord>();

  constructor(options: YouTubeApiAdapterOptions) {
    this.options = options;
    this.doFetch = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.categoryId = options.categoryId ?? DEFAULT_YOUTUBE_CATEGORY_ID;
    this.uploadEndpoint = options.uploadEndpoint ?? YOUTUBE_UPLOAD_ENDPOINT;
    this.videosEndpoint = options.videosEndpoint ?? YOUTUBE_VIDEOS_ENDPOINT;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async capabilities(): Promise<PlatformCapabilities> {
    return {
      platform: 'youtube',
      adapterVersion: 'api-1',
      authStatus: await this.authStatus(),
      textSupported: false,
      videoSupported: true,
      directPublishSupported: true,
      draftSupported: false,
      schedulingSupported: false,
      lastVerifiedAt: this.now().toISOString(),
      limitations: [
        'kuota 10.000 unit/hari per project + 100 videos.insert/hari belum diverifikasi (ADR-0008 D3/F1)',
        'privasi public belum terverifikasi; default private (D4, OD-5)',
        'belum ada uji unggah nyata ke server Google (slice A5)',
        `unggahan dibaca penuh ke memori; resume 308 dibatasi ${MAX_RESUME_ATTEMPTS} lanjutan per unggahan`,
        'pemetaan idempotencyKey → videoId hanya di memori; setelah restart hasil menjadi unknown'
      ]
    };
  }

  async validate(request: PublishRequest): Promise<PublishValidationResult> {
    const issues: string[] = [];
    if (request.accountId.trim() === '') issues.push('accountId kosong');

    const caption = request.caption.trim();
    if (caption === '') {
      issues.push('caption/deskripsi kosong');
    } else if (caption.length > MAX_DESCRIPTION_LENGTH) {
      issues.push(`deskripsi melebihi ${MAX_DESCRIPTION_LENGTH} karakter`);
    } else if (/[<>]/.test(caption)) {
      issues.push('deskripsi memuat karakter < atau > yang ditolak YouTube');
    }

    const title = request.title?.trim() ?? '';
    if (title.length > MAX_TITLE_LENGTH) {
      issues.push(`judul melebihi ${MAX_TITLE_LENGTH} karakter`);
    }
    if (/[<>]/.test(title)) {
      issues.push('judul memuat karakter < atau > yang ditolak YouTube');
    }

    if (request.visibility !== undefined && !isPrivacyStatus(request.visibility)) {
      issues.push(`visibility ${request.visibility} bukan private|unlisted|public`);
    }

    if (request.assetId.trim() === '') {
      issues.push('assetId kosong');
    } else {
      const asset = this.options.resolveAsset(request.assetId);
      if (asset === null) {
        issues.push(`aset ${request.assetId} tidak ditemukan`);
      } else {
        if (!asset.mimeType.startsWith('video/')) {
          issues.push(`aset ${request.assetId} bukan video (${asset.mimeType})`);
        }
        if (asset.sizeBytes <= 0) {
          issues.push(`aset ${request.assetId} kosong`);
        }
        try {
          await stat(asset.path);
        } catch {
          issues.push(`berkas aset ${request.assetId} tidak dapat dibaca`);
        }
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (this.uploads.has(request.idempotencyKey)) {
      return { status: 'processing', retryable: false, errorCode: 'YT_UPLOAD_IN_PROGRESS' };
    }

    const asset = this.options.resolveAsset(request.assetId);
    if (asset === null) {
      throw new AppError('VALIDATION', `aset ${request.assetId} tidak ditemukan untuk unggahan`);
    }

    const token = await this.accessToken(request.accountId);
    const privacy = this.privacyOf(request);

    let bytes: Buffer;
    try {
      bytes = await readFile(asset.path);
    } catch (error) {
      throw new AppError('DISK', `gagal membaca aset ${request.assetId}`, { cause: error });
    }

    // Fase 1 — inisialisasi sesi resumable: belum ada byte yang diunggah, aman untuk retry.
    const initUrl = `${this.uploadEndpoint}?uploadType=resumable&part=${encodeURIComponent(
      'snippet,status'
    )}`;
    const initResponse = await requestOnce(
      this.doFetch,
      initUrl,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': asset.mimeType,
          'x-upload-content-length': String(bytes.length)
        },
        body: JSON.stringify({
          snippet: {
            title: this.titleOf(request),
            description: request.caption.trim(),
            categoryId: this.categoryId
          },
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false
          }
        })
      },
      this.requestTimeoutMs,
      'inisialisasi unggahan YouTube'
    );

    const initBody = await readJsonBody(initResponse);
    if (!initResponse.ok) {
      throw apiErrorOf(
        'inisialisasi unggahan YouTube',
        initResponse.status,
        initBody,
        retryAfterMsOf(initResponse)
      );
    }
    const sessionUri = initResponse.headers.get('location');
    if (sessionUri === null || sessionUri.trim() === '') {
      throw new AppError(
        'EXTERNAL_5XX',
        'inisialisasi unggahan YouTube tidak mengembalikan session URI'
      );
    }

    // Fase 2 — unggah byte. `videos.insert` tidak idempoten: kegagalan di sini bisa
    // berarti video sudah dibuat, jadi tidak boleh dilempar sebagai kelas retry.
    const putBytes = (start: number): Promise<Response> =>
      requestOnce(
        this.doFetch,
        sessionUri,
        start === 0
          ? {
              method: 'PUT',
              headers: {
                'content-type': asset.mimeType,
                'content-length': String(bytes.length)
              },
              body: bytes
            }
          : {
              method: 'PUT',
              headers: {
                'content-type': asset.mimeType,
                'content-length': String(bytes.length - start),
                'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`
              },
              body: bytes.subarray(start)
            },
        this.uploadTimeoutMs,
        'unggahan YouTube'
      );

    let uploadResponse: Response;
    try {
      uploadResponse = await putBytes(0);
      // 308 = server baru menerima sebagian byte; lanjutkan dari offset yang dilaporkan
      // alih-alih mengulang seluruh unggahan.
      for (let resumed = 0; resumed < MAX_RESUME_ATTEMPTS && uploadResponse.status === 308; ) {
        const received = receivedBytesOf(uploadResponse, bytes.length);
        if (received === null || received >= bytes.length) break;
        resumed += 1;
        uploadResponse = await putBytes(received);
      }
    } catch {
      return { status: 'unknown', retryable: false, errorCode: 'YT_UPLOAD_UNCERTAIN' };
    }

    if (!uploadResponse.ok) {
      if (uploadResponse.status === 308) {
        return { status: 'unknown', retryable: false, errorCode: 'YT_UPLOAD_INCOMPLETE' };
      }
      const body = await readJsonBody(uploadResponse);
      const error = apiErrorOf(
        'unggahan YouTube',
        uploadResponse.status,
        body,
        retryAfterMsOf(uploadResponse)
      );
      if (errorClassOf(error) === 'AUTH') throw error;
      if (errorClassOf(error) === 'VALIDATION') {
        return { status: 'failed', retryable: false, errorCode: 'YT_UPLOAD_REJECTED' };
      }
      return { status: 'unknown', retryable: false, errorCode: 'YT_UPLOAD_UNCERTAIN' };
    }

    const created = await readJsonBody(uploadResponse);
    const videoId = stringField(asRecord(created), 'id');
    if (videoId === null) {
      // Video mungkin sudah terbuat meski respons tidak terbaca.
      return { status: 'unknown', retryable: false, errorCode: 'YT_RESPONSE_INVALID' };
    }

    this.uploads.set(request.idempotencyKey, {
      accountId: request.accountId,
      videoId,
      privacy
    });
    return { status: 'processing', retryable: false };
  }

  async getStatus(idempotencyKey: string): Promise<PublishResult> {
    const record = this.uploads.get(idempotencyKey);
    if (record === undefined) {
      return { status: 'unknown', retryable: false, errorCode: 'YT_UNKNOWN_IDEMPOTENCY' };
    }

    const token = await this.accessToken(record.accountId);
    const url = `${this.videosEndpoint}?part=status&id=${encodeURIComponent(record.videoId)}`;
    const response = await requestOnce(
      this.doFetch,
      url,
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      this.requestTimeoutMs,
      'verifikasi status YouTube'
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { status: 'unknown', retryable: false, errorCode: 'YT_VIDEO_NOT_FOUND' };
      }
      const body = await readJsonBody(response);
      throw apiErrorOf('verifikasi status YouTube', response.status, body, retryAfterMsOf(response));
    }

    const body = await readJsonBody(response);
    const items = asRecord(body)?.items;
    const item = Array.isArray(items) ? asRecord(items[0]) : null;
    if (item === null) {
      return { status: 'unknown', retryable: false, errorCode: 'YT_VIDEO_NOT_FOUND' };
    }

    const statusRecord = asRecord(item.status);
    const uploadStatus = stringField(statusRecord, 'uploadStatus');
    if (uploadStatus === 'failed' || uploadStatus === 'rejected') {
      return { status: 'failed', retryable: false, errorCode: 'YT_UPLOAD_REJECTED' };
    }
    if (uploadStatus === 'deleted') {
      return { status: 'failed', retryable: false, errorCode: 'YT_VIDEO_DELETED' };
    }

    const actualPrivacy = stringField(statusRecord, 'privacyStatus');
    if (actualPrivacy === null || !isPrivacyStatus(actualPrivacy)) {
      return { status: 'unknown', retryable: false, errorCode: 'YT_PRIVACY_UNKNOWN' };
    }
    if (actualPrivacy !== record.privacy) {
      // Visibilitas tidak sesuai permintaan: bukan publikasi sukses (ADR-0008 D4).
      return { status: 'unknown', retryable: false, errorCode: 'YT_PRIVACY_MISMATCH' };
    }

    return {
      status: 'published',
      externalPostId: record.videoId,
      permalink: `https://www.youtube.com/watch?v=${record.videoId}`,
      retryable: false
    };
  }

  private async authStatus(): Promise<PlatformCapabilities['authStatus']> {
    const accountId = this.options.accountId;
    if (accountId === undefined) return 'disconnected';
    try {
      const record = await this.options.store.load<YouTubeTokenRecord>(
        credentialNameFor(accountId)
      );
      if (record === null) return 'disconnected';
      return record.refreshToken === null ? 'reauth_required' : 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async accessToken(accountId: string): Promise<string> {
    let ensured: Awaited<ReturnType<typeof ensureFreshAccessToken>>;
    try {
      ensured = await ensureFreshAccessToken({
        accountId,
        clientId: this.options.clientId,
        ...(this.options.clientSecret === undefined
          ? {}
          : { clientSecret: this.options.clientSecret }),
        store: this.options.store,
        now: this.now,
        fetchImpl: this.doFetch,
        ...(this.options.tokenEndpoint === undefined
          ? {}
          : { tokenEndpoint: this.options.tokenEndpoint }),
        timeoutMs: this.requestTimeoutMs
      });
    } catch (error) {
      if (error instanceof YouTubeAuthError && error.code === 'reauth_required') {
        await this.notifyReauth(accountId);
      }
      throw error;
    }
    if (ensured === null) {
      await this.notifyReauth(accountId);
      throw new YouTubeAuthError(
        'reauth_required',
        `akun ${accountId} belum dipasangkan dengan YouTube`
      );
    }
    return ensured.record.accessToken;
  }

  /** Kegagalan mencatat status tidak boleh menutupi galat auth yang sebenarnya. */
  private async notifyReauth(accountId: string): Promise<void> {
    if (this.options.onReauthRequired === undefined) return;
    try {
      await this.options.onReauthRequired(accountId);
    } catch {
      // diabaikan dengan sengaja; lihat komentar di atas.
    }
  }

  private privacyOf(request: PublishRequest): YouTubePrivacyStatus {
    const visibility = request.visibility?.trim() ?? '';
    if (isPrivacyStatus(visibility)) return visibility;
    return this.options.privacy ?? DEFAULT_YOUTUBE_PRIVACY;
  }

  private titleOf(request: PublishRequest): string {
    const explicit = request.title?.trim() ?? '';
    if (explicit !== '') return explicit;
    return request.caption.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH);
  }
}
