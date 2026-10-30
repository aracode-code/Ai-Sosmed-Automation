import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError, errorClassOf } from '@saa/domain';
import type { CredentialStore } from './credential-store';
import { YouTubeAuthError, type YouTubeTokenRecord } from './oauth-client';
import {
  DEFAULT_YOUTUBE_CATEGORY_ID,
  YouTubeApiAdapter,
  type YouTubeApiAdapterOptions,
  type YouTubeAssetSource
} from './youtube-api-adapter';

const TEMP_DIRS: string[] = [];
const ASSET_BYTES = Buffer.from('fake-mp4-payload-for-a3-tests', 'utf8');

afterEach(async () => {
  while (TEMP_DIRS.length > 0) await rm(TEMP_DIRS.pop()!, { recursive: true, force: true });
});

class MemoryCredentialStore implements CredentialStore {
  readonly entries = new Map<string, unknown>();

  async save(name: string, payload: unknown): Promise<void> {
    this.entries.set(name, structuredClone(payload));
  }

  async load<T = unknown>(name: string): Promise<T | null> {
    if (!this.entries.has(name)) return null;
    return structuredClone(this.entries.get(name)) as T;
  }

  async remove(name: string): Promise<boolean> {
    return this.entries.delete(name);
  }
}

function tokenRecord(overrides: Partial<YouTubeTokenRecord> = {}): YouTubeTokenRecord {
  return {
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    tokenType: 'Bearer',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    expiresAt: Date.now() + 3_600_000,
    clientId: 'client-id.apps.googleusercontent.com',
    pairedAt: '2026-10-30T00:00:00.000Z',
    ...overrides
  };
}

type FetchInit = Parameters<typeof fetch>[1];

interface RecordedCall {
  url: string;
  init: NonNullable<FetchInit>;
}

function fakeFetch(handler: (url: string, init: FetchInit) => Promise<Response> | Response): {
  impl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = (input: Parameters<typeof fetch>[0], init?: FetchInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: (init ?? {}) as NonNullable<FetchInit> });
    return Promise.resolve(handler(url, init ?? {}));
  };
  return { impl: impl as typeof fetch, calls };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

async function assetFixture(): Promise<YouTubeAssetSource> {
  const dir = await mkdtemp(join(tmpdir(), 'saa-yt-a3-'));
  TEMP_DIRS.push(dir);
  const path = join(dir, 'video.mp4');
  await writeFile(path, ASSET_BYTES);
  return { path, mimeType: 'video/mp4', sizeBytes: ASSET_BYTES.length };
}

interface Harness {
  adapter: YouTubeApiAdapter;
  store: MemoryCredentialStore;
  calls: RecordedCall[];
  asset: YouTubeAssetSource;
}

async function harness(
  handler: (url: string, init: FetchInit) => Promise<Response> | Response,
  options: Partial<YouTubeApiAdapterOptions> = {}
): Promise<Harness> {
  const store = new MemoryCredentialStore();
  await store.save('youtube-acc_1', tokenRecord());
  const asset = await assetFixture();
  const { impl, calls } = fakeFetch(handler);
  const adapter = new YouTubeApiAdapter({
    store,
    clientId: 'client-id.apps.googleusercontent.com',
    resolveAsset: (assetId) => (assetId === 'med_1' ? asset : null),
    fetchImpl: impl,
    uploadEndpoint: 'https://upload.example/upload',
    videosEndpoint: 'https://api.example/videos',
    ...options
  });
  return { adapter, store, calls, asset };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'acc_1',
    assetId: 'med_1',
    caption: 'Kenapa model bisa menebak kata?',
    title: 'Tokenisasi dalam 60 detik',
    idempotencyKey: 'publish:job_1',
    ...overrides
  };
}

async function expectAppError(promise: Promise<unknown>, errorClass: string): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.errorClass).toBe(errorClass);
    expect(errorClassOf(appError)).toBe(errorClass);
    return appError;
  }
  throw new Error('diharapkan AppError, tetapi promise selesai normal');
}

describe('YouTubeApiAdapter — validate', () => {
  it('menerima permintaan lengkap dan memakai judul eksplisit', async () => {
    const { adapter } = await harness(() => jsonResponse(500, {}));
    await expect(adapter.validate(request())).resolves.toEqual({ ok: true, issues: [] });
  });

  it('menolak caption kosong, judul terlalu panjang, dan karakter < >', async () => {
    const { adapter } = await harness(() => jsonResponse(500, {}));
    const result = await adapter.validate(
      request({ caption: '   ', title: `${'a'.repeat(101)}<` })
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('caption/deskripsi kosong');
    expect(result.issues.some((issue) => issue.includes('judul melebihi'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('judul memuat karakter'))).toBe(true);
  });

  it('menolak deskripsi > 5000 karakter dan visibility tak dikenal', async () => {
    const { adapter } = await harness(() => jsonResponse(500, {}));
    const result = await adapter.validate(
      request({ caption: 'x'.repeat(5_001), visibility: 'friends' })
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('deskripsi melebihi'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('bukan private|unlisted|public'))).toBe(true);
  });

  it('menolak aset yang tidak dikenal, bukan video, atau berkasnya tidak ada', async () => {
    const { adapter } = await harness(() => jsonResponse(500, {}), {
      resolveAsset: (assetId) => {
        if (assetId === 'med_gone') {
          return { path: join(tmpdir(), 'tidak-ada-a3.mp4'), mimeType: 'video/mp4', sizeBytes: 10 };
        }
        if (assetId === 'med_img') {
          return { path: join(tmpdir(), 'x.jpg'), mimeType: 'image/jpeg', sizeBytes: 10 };
        }
        return null;
      }
    });

    const unknown = await adapter.validate(request({ assetId: 'med_none' }));
    expect(unknown.issues).toContain('aset med_none tidak ditemukan');

    const image = await adapter.validate(request({ assetId: 'med_img' }));
    expect(image.issues.some((issue) => issue.includes('bukan video'))).toBe(true);

    const missing = await adapter.validate(request({ assetId: 'med_gone' }));
    expect(missing.issues.some((issue) => issue.includes('tidak dapat dibaca'))).toBe(true);
  });
});

describe('YouTubeApiAdapter — publish + getStatus', () => {
  it('menginisialisasi sesi resumable, mengunggah byte, lalu memverifikasi privasi', async () => {
    const { adapter, calls, asset } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-abc' }
        });
      }
      if (url.startsWith('https://upload.example/session-abc')) {
        return jsonResponse(200, { id: 'yt_video_1', status: { privacyStatus: 'private' } });
      }
      return jsonResponse(200, {
        items: [{ id: 'yt_video_1', status: { privacyStatus: 'private', uploadStatus: 'uploaded' } }]
      });
    });

    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'processing',
      retryable: false
    });

    const init = calls[0];
    expect(init.url).toBe(
      'https://upload.example/upload?uploadType=resumable&part=snippet%2Cstatus'
    );
    expect(init.init.method).toBe('POST');
    expect((init.init.headers as Record<string, string>).authorization).toBe(
      'Bearer access-token-1'
    );
    const initBody = JSON.parse(String(init.init.body)) as Record<string, any>;
    expect(initBody.snippet).toEqual({
      title: 'Tokenisasi dalam 60 detik',
      description: 'Kenapa model bisa menebak kata?',
      categoryId: DEFAULT_YOUTUBE_CATEGORY_ID
    });
    expect(initBody.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });

    const upload = calls[1];
    expect(upload.url).toBe('https://upload.example/session-abc');
    expect(upload.init.method).toBe('PUT');
    expect(Buffer.from(upload.init.body as Uint8Array)).toEqual(ASSET_BYTES);
    expect((upload.init.headers as Record<string, string>)['content-length']).toBe(
      String(asset.sizeBytes)
    );

    await expect(adapter.getStatus('publish:job_1')).resolves.toEqual({
      status: 'published',
      externalPostId: 'yt_video_1',
      permalink: 'https://www.youtube.com/watch?v=yt_video_1',
      retryable: false
    });
  });

  it('memakai privasi dari konfigurasi dan memakai caption sebagai judul cadangan', async () => {
    const { adapter, calls } = await harness(
      (url) => {
        if (url.startsWith('https://upload.example/upload')) {
          return new Response(null, {
            status: 200,
            headers: { location: 'https://upload.example/session-x' }
          });
        }
        if (url.startsWith('https://upload.example/session-x')) {
          return jsonResponse(200, { id: 'yt_video_2' });
        }
        return jsonResponse(200, {
          items: [{ status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }]
        });
      },
      { privacy: 'unlisted' }
    );

    await adapter.publish(request({ title: undefined }));

    const initBody = JSON.parse(String(calls[0].init.body)) as Record<string, any>;
    expect(initBody.status.privacyStatus).toBe('unlisted');
    expect(initBody.snippet.title).toBe('Kenapa model bisa menebak kata?');
    await expect(adapter.getStatus('publish:job_1')).resolves.toMatchObject({
      status: 'published'
    });
  });

  it('tidak mengunggah ulang untuk idempotency key yang sama', async () => {
    const { adapter, calls } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-once' }
        });
      }
      return jsonResponse(200, { id: 'yt_video_once' });
    });

    await adapter.publish(request());
    const afterFirst = calls.length;
    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'processing',
      retryable: false,
      errorCode: 'YT_UPLOAD_IN_PROGRESS'
    });
    expect(calls.length).toBe(afterFirst);
  });

  it('melaporkan unknown bila privasi hasil unggahan tidak sesuai permintaan', async () => {
    const { adapter } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-p' }
        });
      }
      if (url.startsWith('https://upload.example/session-p')) {
        return jsonResponse(200, { id: 'yt_video_3' });
      }
      return jsonResponse(200, {
        items: [{ status: { privacyStatus: 'public', uploadStatus: 'uploaded' } }]
      });
    });

    await adapter.publish(request());
    await expect(adapter.getStatus('publish:job_1')).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_PRIVACY_MISMATCH'
    });
  });

  it('mengembalikan unknown untuk key yang tidak dikenal tanpa memanggil API', async () => {
    const { adapter, calls } = await harness(() => jsonResponse(500, {}));
    await expect(adapter.getStatus('publish:tidak-ada')).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_UNKNOWN_IDEMPOTENCY'
    });
    expect(calls).toHaveLength(0);
  });

  it('menandai video yang hilang atau ditolak YouTube', async () => {
    const missing = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-m' }
        });
      }
      if (url.startsWith('https://upload.example/session-m')) {
        return jsonResponse(200, { id: 'yt_video_4' });
      }
      return jsonResponse(200, { items: [] });
    });
    await missing.adapter.publish(request());
    await expect(missing.adapter.getStatus('publish:job_1')).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_VIDEO_NOT_FOUND'
    });

    const rejected = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-r' }
        });
      }
      if (url.startsWith('https://upload.example/session-r')) {
        return jsonResponse(200, { id: 'yt_video_5' });
      }
      return jsonResponse(200, {
        items: [{ status: { uploadStatus: 'rejected', privacyStatus: 'private' } }]
      });
    });
    await rejected.adapter.publish(request());
    await expect(rejected.adapter.getStatus('publish:job_1')).resolves.toEqual({
      status: 'failed',
      retryable: false,
      errorCode: 'YT_UPLOAD_REJECTED'
    });
  });

  it('tidak mengarang videoId bila respons unggahan tidak memuat id', async () => {
    const { adapter } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-noid' }
        });
      }
      return jsonResponse(200, { status: {} });
    });

    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_RESPONSE_INVALID'
    });
  });
});

describe('YouTubeApiAdapter — pemetaan error (D6)', () => {
  it('kuota habis pada inisialisasi → AUTH (eskalasi, tanpa retry)', async () => {
    const { adapter } = await harness(() =>
      jsonResponse(403, {
        error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] }
      })
    );

    const error = await expectAppError(adapter.publish(request()), 'AUTH');
    expect(error.message).toContain('quotaExceeded');
  });

  it('rate limit pada inisialisasi → RATE_LIMIT dengan retryAfterMs', async () => {
    const { adapter } = await harness(() =>
      jsonResponse(429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, {
        'retry-after': '2'
      })
    );

    const error = await expectAppError(adapter.publish(request()), 'RATE_LIMIT');
    expect(error.options.retryAfterMs).toBe(2_000);
  });

  it('gangguan 5xx pada inisialisasi → EXTERNAL_5XX (aman untuk retry)', async () => {
    const { adapter } = await harness(() => jsonResponse(503, {}));
    await expectAppError(adapter.publish(request()), 'EXTERNAL_5XX');
  });

  it('401 dan gangguan jaringan pada token → AUTH / TRANSIENT_NETWORK', async () => {
    const unauthorized = await harness(() => jsonResponse(500, {}));
    unauthorized.store.entries.delete('youtube-acc_1');
    await expectAppError(unauthorized.adapter.publish(request()), 'AUTH');

    const offline = await harness(() => {
      throw new TypeError('network down');
    });
    await expectAppError(offline.adapter.publish(request()), 'TRANSIENT_NETWORK');
  });

  it('kegagalan setelah unggahan dikirim tidak dilempar sebagai retry', async () => {
    const network = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-net' }
        });
      }
      throw new TypeError('koneksi terputus');
    });
    await expect(network.adapter.publish(request())).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_UPLOAD_UNCERTAIN'
    });

    const serverError = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-5xx' }
        });
      }
      return jsonResponse(500, {});
    });
    await expect(serverError.adapter.publish(request())).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_UPLOAD_UNCERTAIN'
    });

    const incomplete = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-308' }
        });
      }
      return new Response(null, { status: 308 });
    });
    await expect(incomplete.adapter.publish(request())).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_UPLOAD_INCOMPLETE'
    });
  });

  it('melanjutkan unggahan 308 dari offset yang dilaporkan header Range', async () => {
    let putCount = 0;
    const { adapter, calls, asset } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-resume' }
        });
      }
      putCount += 1;
      if (putCount === 1) {
        return new Response(null, { status: 308, headers: { range: 'bytes=0-9' } });
      }
      return jsonResponse(200, { id: 'yt_video_resume' });
    });

    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'processing',
      retryable: false
    });

    expect(calls).toHaveLength(3);
    const resume = calls[2];
    expect(resume.url).toBe('https://upload.example/session-resume');
    expect(resume.init.method).toBe('PUT');
    expect((resume.init.headers as Record<string, string>)['content-range']).toBe(
      `bytes 10-${asset.sizeBytes - 1}/${asset.sizeBytes}`
    );
    expect((resume.init.headers as Record<string, string>)['content-length']).toBe(
      String(asset.sizeBytes - 10)
    );
    expect(Buffer.from(resume.init.body as Uint8Array)).toEqual(ASSET_BYTES.subarray(10));
  });

  it('berhenti melanjutkan setelah 3 percobaan 308 lalu menjadi unknown', async () => {
    const { adapter, calls } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-stuck' }
        });
      }
      return new Response(null, { status: 308, headers: { range: 'bytes=0-9' } });
    });

    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'unknown',
      retryable: false,
      errorCode: 'YT_UPLOAD_INCOMPLETE'
    });
    // POST inisialisasi + PUT awal + 3 lanjutan.
    expect(calls).toHaveLength(5);
  });

  it('penolakan 400 setelah unggahan → failed tanpa retry', async () => {
    const { adapter } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-400' }
        });
      }
      return jsonResponse(400, { error: { errors: [{ reason: 'invalidVideoMetadata' }] } });
    });

    await expect(adapter.publish(request())).resolves.toEqual({
      status: 'failed',
      retryable: false,
      errorCode: 'YT_UPLOAD_REJECTED'
    });
  });

  it('403 kuota pada verifikasi status → AUTH', async () => {
    const { adapter } = await harness((url) => {
      if (url.startsWith('https://upload.example/upload')) {
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/session-q' }
        });
      }
      if (url.startsWith('https://upload.example/session-q')) {
        return jsonResponse(200, { id: 'yt_video_6' });
      }
      return jsonResponse(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
    });

    await adapter.publish(request());
    await expectAppError(adapter.getStatus('publish:job_1'), 'AUTH');
  });

  it('akun tanpa kredensial ditolak dengan reauth_required', async () => {
    const { adapter, store } = await harness(() => jsonResponse(500, {}));
    await store.remove('youtube-acc_1');

    try {
      await adapter.publish(request());
      throw new Error('diharapkan YouTubeAuthError');
    } catch (error) {
      expect(error).toBeInstanceOf(YouTubeAuthError);
      expect((error as YouTubeAuthError).code).toBe('reauth_required');
      expect(errorClassOf(error)).toBe('AUTH');
    }
  });

  it('memanggil onReauthRequired saat akun perlu pairing ulang', async () => {
    const seen: string[] = [];
    const { adapter, store } = await harness(() => jsonResponse(500, {}), {
      onReauthRequired: (accountId) => {
        seen.push(accountId);
      }
    });
    await store.remove('youtube-acc_1');

    await expect(adapter.publish(request())).rejects.toBeInstanceOf(YouTubeAuthError);
    expect(seen).toEqual(['acc_1']);
  });

  it('kegagalan callback reauth tidak menutupi galat auth', async () => {
    const { adapter, store } = await harness(() => jsonResponse(500, {}), {
      onReauthRequired: () => {
        throw new Error('basis data tidak tersedia');
      }
    });
    await store.remove('youtube-acc_1');

    await expect(adapter.publish(request())).rejects.toMatchObject({
      name: 'YouTubeAuthError',
      code: 'reauth_required'
    });
  });

  it('menyegarkan token kedaluwarsa sebelum mengunggah', async () => {
    const { adapter, store, calls } = await harness(
      (url) => {
        if (url === 'https://oauth.example/token') {
          return jsonResponse(200, {
            access_token: 'access-token-baru',
            expires_in: 3_600,
            token_type: 'Bearer'
          });
        }
        if (url.startsWith('https://upload.example/upload')) {
          return new Response(null, {
            status: 200,
            headers: { location: 'https://upload.example/session-refresh' }
          });
        }
        return jsonResponse(200, { id: 'yt_video_7' });
      },
      { tokenEndpoint: 'https://oauth.example/token' }
    );
    await store.save('youtube-acc_1', tokenRecord({ accessToken: 'basi', expiresAt: Date.now() - 1 }));

    await adapter.publish(request());

    expect(calls[0].url).toBe('https://oauth.example/token');
    const init = calls.find((call) => call.url.startsWith('https://upload.example/upload'));
    expect((init!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer access-token-baru'
    );
    await expect(store.load<YouTubeTokenRecord>('youtube-acc_1')).resolves.toMatchObject({
      accessToken: 'access-token-baru'
    });
  });

  it('membatalkan permintaan yang melewati batas waktu', async () => {
    const { adapter } = await harness(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { requestTimeoutMs: 5 }
    );

    await expectAppError(adapter.publish(request()), 'TRANSIENT_NETWORK');
  });
});

describe('YouTubeApiAdapter — capabilities', () => {
  it('melaporkan status auth sesuai akun yang dikonfigurasi', async () => {
    const { adapter } = await harness(() => jsonResponse(500, {}), { accountId: 'acc_1' });
    const capabilities = await adapter.capabilities();

    expect(capabilities).toMatchObject({
      platform: 'youtube',
      adapterVersion: 'api-1',
      authStatus: 'connected',
      videoSupported: true,
      textSupported: false,
      draftSupported: false,
      schedulingSupported: false
    });
    expect(capabilities.limitations.join(' ')).toContain('ADR-0008');
  });

  it('tidak mengklaim terhubung tanpa akun atau saat kredensial tidak ada', async () => {
    const withoutAccount = await harness(() => jsonResponse(500, {}));
    await expect(withoutAccount.adapter.capabilities()).resolves.toMatchObject({
      authStatus: 'disconnected'
    });

    const missing = await harness(() => jsonResponse(500, {}), { accountId: 'acc_lain' });
    await expect(missing.adapter.capabilities()).resolves.toMatchObject({
      authStatus: 'disconnected'
    });
  });
});
