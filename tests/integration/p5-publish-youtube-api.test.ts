import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SocialAdapter } from '@saa/domain';
import {
  getPublishAttemptByKey,
  getSocialAccount,
  insertCampaign,
  insertJob,
  insertMediaAsset,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { Dispatcher, createPublishHandler } from '@saa/workflow';
import { loadConfig } from '../../apps/local-api/src/config';
import { createYouTubeApiPublisher } from '../../apps/local-api/src/publisher';

const T0 = '2026-01-01T00:00:00.000Z';
const now = () => new Date(T0);
const ASSET_BYTES = Buffer.from('payload-mp4-uji-a5', 'utf8');
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const SESSION_URI = 'https://upload.example/session-a5';

let workDir: string;
let mediaRoot: string;
let db: DatabaseHandle;
let seq = 0;

/** Bentuk struktural `CredentialStore`; @saa/youtube bukan dependency root. */
class MemoryCredentialStore {
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

function tokenRecord() {
  return {
    accessToken: 'access-token-a5',
    refreshToken: 'refresh-token-a5',
    tokenType: 'Bearer',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    expiresAt: Date.now() + 3_600_000,
    clientId: 'client-uji.apps.googleusercontent.com',
    pairedAt: '2026-10-30T00:00:00.000Z'
  };
}

type FetchInit = Parameters<typeof fetch>[1];

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function fakeFetch(handler: (url: string, init: NonNullable<FetchInit>) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = (input: Parameters<typeof fetch>[0], init?: FetchInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const resolved = init ?? {};
    calls.push({ url, method: resolved.method ?? 'GET', body: resolved.body ?? null });
    return Promise.resolve(handler(url, resolved));
  };
  return { impl: impl as typeof fetch, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function sessionResponse(): Response {
  return new Response(null, { status: 200, headers: { location: SESSION_URI } });
}

function uploadedResponse(videoId: string): Response {
  return jsonResponse(200, { id: videoId });
}

function statusResponse(status: Record<string, unknown>): Response {
  return jsonResponse(200, { items: [{ status }] });
}

function insertJobFor(ids: { campaignId: string; contentId: string; accountId: string }) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType: 'PUBLISH',
      idempotencyKey: `publish-job-a5-${seq}`,
      campaignId: ids.campaignId,
      contentId: ids.contentId,
      payload: {
        contentId: ids.contentId,
        campaignId: ids.campaignId,
        accountId: ids.accountId,
        platform: 'youtube'
      }
    },
    T0
  );
}

function attemptRows(jobId: string): number {
  const row = db.raw
    .prepare('SELECT COUNT(*) AS n FROM publish_attempts WHERE job_id = ?')
    .get(jobId) as { n: number };
  return row.n;
}

function dispatcherWith(adapter: SocialAdapter): Dispatcher {
  const backoff = { jitterMs: 0, rng: () => 0 };
  return new Dispatcher({
    db,
    workerId: 'w1',
    handlers: { PUBLISH: createPublishHandler({ db, adapter, now, backoff }) },
    now,
    backoff
  });
}

interface Harness {
  ids: { campaignId: string; contentId: string; accountId: string };
  store: MemoryCredentialStore;
  calls: RecordedCall[];
  adapter: SocialAdapter;
}

/** Rantai nyata: handler PUBLISH → composition root → YouTubeApiAdapter → HTTP palsu. */
async function harness(
  handler: (url: string, init: NonNullable<FetchInit>) => Response | Promise<Response>,
  options: { paired?: boolean } = {}
): Promise<Harness> {
  const store = new MemoryCredentialStore();
  if (options.paired !== false) await store.save('youtube-acc_yt', tokenRecord());
  const { impl, calls } = fakeFetch(handler);
  const adapter = createYouTubeApiPublisher({
    db,
    config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
    credentials: { clientId: 'client-uji', clientSecret: null },
    store,
    fetchImpl: impl
  });
  return { ids: { campaignId: campaign.id, contentId: content.id, accountId: account.id }, store, calls, adapter };
}

let campaign: { id: string };
let content: { id: string };
let account: { id: string };

beforeEach(() => {
  seq = 0;
  workDir = mkdtempSync(join(tmpdir(), 'saa-a5-publish-'));
  mediaRoot = join(workDir, 'media');
  mkdirSync(mediaRoot, { recursive: true });
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);

  const mediaPath = join(mediaRoot, 'video.mp4');
  writeFileSync(mediaPath, ASSET_BYTES);

  campaign = insertCampaign(db.raw, {
    name: 'uji A5',
    niche: 'edukasi teknologi',
    approvalMode: 'automatic',
    platforms: ['youtube']
  });

  content = upsertContentItem(db.raw, {
    id: 'cnt_a5',
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: { videoPrompt: 'Animasi dasar AI' },
    caption: {
      youtube: {
        caption: 'Dasar AI dalam 30 detik',
        contentFormat: 'short_video',
        title: 'Dasar AI'
      }
    },
    approvalStatus: 'not_required'
  });

  insertMediaAsset(db.raw, {
    id: 'med_a5',
    contentId: content.id,
    path: mediaPath,
    sha256: 'd'.repeat(64),
    mimeType: 'video/mp4',
    sizeBytes: ASSET_BYTES.length,
    durationMs: 30_000,
    validationStatus: 'valid'
  });

  account = insertSocialAccount(db.raw, {
    id: 'acc_yt',
    platform: 'youtube',
    label: 'kanal uji A5',
    connectionStatus: 'connected',
    secretRef: 'dpapi:youtube:acc_yt'
  });
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('PUBLISH handler × YouTubeApiAdapter (A5)', () => {
  it('mengunggah lewat adapter API dan menutup job ke PUBLISHED setelah videos.list', async () => {
    const h = await harness((url) => {
      if (url.startsWith(UPLOAD_URL)) return sessionResponse();
      if (url.startsWith(SESSION_URI)) return uploadedResponse('yt_vid_a5');
      return statusResponse({ privacyStatus: 'private', uploadStatus: 'uploaded' });
    });
    const job = insertJobFor(h.ids);

    const result = await dispatcherWith(h.adapter).runOnce();

    expect(result?.status).toBe('PUBLISHED');
    expect(result?.lastErrorCode).toBeNull();

    const attempt = getPublishAttemptByKey(db.raw, `publish:${job.id}`);
    expect(attempt).toMatchObject({
      jobId: job.id,
      accountId: account.id,
      platform: 'youtube',
      status: 'published',
      externalPostId: 'yt_vid_a5',
      permalink: 'https://www.youtube.com/watch?v=yt_vid_a5',
      verifiedAt: T0,
      errorCode: null
    });

    // Tiga panggilan eksternal: inisialisasi sesi, unggah byte, verifikasi status.
    expect(h.calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'GET']);
    const initBody = JSON.parse(String(h.calls[0].body)) as Record<string, any>;
    expect(initBody.snippet).toEqual({
      title: 'Dasar AI',
      description: 'Dasar AI dalam 30 detik',
      categoryId: '27'
    });
    expect(initBody.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
    expect((h.calls[1].body as Buffer).equals(ASSET_BYTES)).toBe(true);
    expect(h.calls[2].url).toBe(`${VIDEOS_URL}?part=status&id=yt_vid_a5`);

    expect(getSocialAccount(db.raw, account.id)?.connectionStatus).toBe('connected');
  });

  it('privasi yang tidak sesuai membuat attempt unknown dan job NEEDS_ATTENTION', async () => {
    const h = await harness((url) => {
      if (url.startsWith(UPLOAD_URL)) return sessionResponse();
      if (url.startsWith(SESSION_URI)) return uploadedResponse('yt_vid_mismatch');
      return statusResponse({ privacyStatus: 'public', uploadStatus: 'uploaded' });
    });
    const job = insertJobFor(h.ids);

    const result = await dispatcherWith(h.adapter).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('YT_PRIVACY_MISMATCH');
    expect(result?.attempts).toBe(0);
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'unknown',
      errorCode: 'YT_PRIVACY_MISMATCH'
    });
  });

  it('video yang ditolak YouTube menutup job FAILED tanpa retry', async () => {
    const h = await harness((url) => {
      if (url.startsWith(UPLOAD_URL)) return sessionResponse();
      if (url.startsWith(SESSION_URI)) return uploadedResponse('yt_vid_rejected');
      return statusResponse({ privacyStatus: 'private', uploadStatus: 'rejected' });
    });
    const job = insertJobFor(h.ids);

    const result = await dispatcherWith(h.adapter).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('YT_UPLOAD_REJECTED');
    expect(result?.attempts).toBe(1);
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'failed',
      errorCode: 'YT_UPLOAD_REJECTED'
    });
  });

  it('kuota habis pada inisialisasi dieskalasi tanpa retry dan tanpa unggahan byte', async () => {
    const h = await harness(() =>
      jsonResponse(403, {
        error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] }
      })
    );
    const job = insertJobFor(h.ids);

    const result = await dispatcherWith(h.adapter).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('AUTH');
    // Eskalasi mencatat satu percobaan gagal, tetapi tidak menjadwalkan retry.
    expect(result?.attempts).toBe(1);
    expect(result?.runAt).toBeNull();
    expect(h.calls).toHaveLength(1);
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'unknown',
      errorCode: 'AUTH'
    });
    // Kuota bukan masalah pairing: akun tetap dianggap terhubung.
    expect(getSocialAccount(db.raw, account.id)?.connectionStatus).toBe('connected');
  });

  it('akun tanpa kredensial ditandai reauth_required dan job berikutnya ditolak sebelum aksi eksternal', async () => {
    const h = await harness(() => jsonResponse(500, {}), { paired: false });
    const first = insertJobFor(h.ids);

    const firstResult = await dispatcherWith(h.adapter).runOnce();

    expect(firstResult?.status).toBe('NEEDS_ATTENTION');
    expect(firstResult?.lastErrorCode).toBe('AUTH');
    expect(getPublishAttemptByKey(db.raw, `publish:${first.id}`)).toMatchObject({
      status: 'unknown',
      errorCode: 'AUTH'
    });
    expect(getSocialAccount(db.raw, account.id)?.connectionStatus).toBe('reauth_required');
    expect(h.calls).toHaveLength(0);

    const second = insertJobFor(h.ids);
    const secondResult = await dispatcherWith(h.adapter).runOnce();

    expect(secondResult?.status).toBe('NEEDS_ATTENTION');
    expect(secondResult?.lastErrorCode).toBe('AUTH');
    expect(attemptRows(second.id)).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
});
