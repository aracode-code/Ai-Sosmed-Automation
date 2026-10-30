import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSocialAccount,
  insertCampaign,
  insertJob,
  insertMediaAsset,
  insertPublishAttempt,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  updatePublishAttempt,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import type { PublishRequest } from '@saa/domain';
import type { CredentialStore, YouTubeTokenRecord } from '@saa/youtube';
import { loadConfig } from './config';
import { createYouTubeApiPublisher, youtubeSecretRef } from './publisher';

const ASSET_BYTES = Buffer.from('payload-mp4-uji-a4', 'utf8');

let workDir: string;
let mediaRoot: string;
let db: DatabaseHandle;
let campaignId: string;

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

function tokenRecord(): YouTubeTokenRecord {
  return {
    accessToken: 'access-token-a4',
    refreshToken: 'refresh-token-a4',
    tokenType: 'Bearer',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    expiresAt: Date.now() + 3_600_000,
    clientId: 'client-id.apps.googleusercontent.com',
    pairedAt: '2026-10-30T00:00:00.000Z'
  };
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>): {
  impl: typeof fetch;
  urls: string[];
  bodies: unknown[];
} {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const impl = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    bodies.push(init?.body === undefined ? null : init.body);
    return Promise.resolve(handler(url));
  };
  return { impl: impl as typeof fetch, urls, bodies };
}

function mediaFixture(): string {
  const path = join(mediaRoot, 'video.mp4');
  writeFileSync(path, ASSET_BYTES);
  return path;
}

function publishRequest(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    accountId: 'acc_a4',
    assetId: 'med_a4',
    caption: 'Kenapa model bisa menebak kata?',
    title: 'Tokenisasi dalam 60 detik',
    idempotencyKey: 'publish:job_a4',
    ...overrides
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-a4-publisher-'));
  mediaRoot = join(workDir, 'media');
  mkdirSync(mediaRoot, { recursive: true });
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);

  const campaign = insertCampaign(db.raw, {
    name: 'uji A4',
    niche: 'teknologi',
    approvalMode: 'automatic',
    platforms: ['youtube']
  });
  campaignId = campaign.id;
  upsertContentItem(db.raw, {
    id: 'cnt_a4',
    campaignId: campaign.id,
    topic: 'uji A4',
    prompt: {}
  });
});

afterEach(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('createYouTubeApiPublisher', () => {
  it('meresolusi aset dari media_assets dan menerima request valid', async () => {
    const path = mediaFixture();
    insertMediaAsset(db.raw, {
      id: 'med_a4',
      contentId: 'cnt_a4',
      path,
      sha256: 'a'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: ASSET_BYTES.length,
      validationStatus: 'valid'
    });
    insertSocialAccount(db.raw, { id: 'acc_a4', platform: 'youtube', label: 'kanal uji' });

    const store = new MemoryCredentialStore();
    await store.save('youtube-acc_a4', tokenRecord());
    const publisher = createYouTubeApiPublisher({
      db,
      config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store,
      fetchImpl: fakeFetch(() => new Response('{}')).impl
    });

    expect(publisher.platform).toBe('youtube');
    await expect(publisher.validate(publishRequest())).resolves.toEqual({ ok: true, issues: [] });
    await expect(
      publisher.validate(publishRequest({ assetId: 'med_tidak_ada' }))
    ).resolves.toMatchObject({
      ok: false,
      issues: ['aset med_tidak_ada tidak ditemukan']
    });
  });

  it('menandai akun yang belum dipasangkan sebagai reauth_required', async () => {
    const path = mediaFixture();
    insertMediaAsset(db.raw, {
      id: 'med_a4',
      contentId: 'cnt_a4',
      path,
      sha256: 'b'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: ASSET_BYTES.length,
      validationStatus: 'valid'
    });
    insertSocialAccount(db.raw, {
      id: 'acc_a4',
      platform: 'youtube',
      label: 'kanal uji',
      connectionStatus: 'connected',
      secretRef: youtubeSecretRef('acc_a4')
    });

    const publisher = createYouTubeApiPublisher({
      db,
      config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store: new MemoryCredentialStore(),
      fetchImpl: fakeFetch(() => new Response('{}')).impl
    });

    await expect(publisher.publish(publishRequest())).rejects.toMatchObject({
      name: 'YouTubeAuthError',
      code: 'reauth_required'
    });
    expect(getSocialAccount(db.raw, 'acc_a4')?.connectionStatus).toBe('reauth_required');
  });

  it('meneruskan privasi dari YOUTUBE_UPLOAD_PRIVACY ke inisialisasi unggahan', async () => {
    const path = mediaFixture();
    insertMediaAsset(db.raw, {
      id: 'med_a4',
      contentId: 'cnt_a4',
      path,
      sha256: 'c'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: ASSET_BYTES.length,
      validationStatus: 'valid'
    });
    insertSocialAccount(db.raw, { id: 'acc_a4', platform: 'youtube', label: 'kanal uji' });

    const store = new MemoryCredentialStore();
    await store.save('youtube-acc_a4', tokenRecord());
    const { impl, bodies } = fakeFetch((url) => {
      if (url.includes('uploadType=resumable')) {
        return new Response('{}', { status: 200, headers: { location: 'https://upload.example/s1' } });
      }
      return new Response(JSON.stringify({ id: 'vid_a4' }), { status: 200 });
    });

    const publisher = createYouTubeApiPublisher({
      db,
      config: loadConfig({
        GOOGLE_OAUTH_CLIENT_ID: 'client-uji',
        YOUTUBE_UPLOAD_PRIVACY: 'unlisted'
      }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store,
      fetchImpl: impl
    });

    const result = await publisher.publish(publishRequest());
    expect(result.status).toBe('processing');

    const initBody = JSON.parse(String(bodies[0])) as {
      status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
      snippet: { categoryId: string };
    };
    expect(initBody.status).toEqual({ privacyStatus: 'unlisted', selfDeclaredMadeForKids: false });
    expect(initBody.snippet.categoryId).toBe('27');
  });

  it('memakai videoId tersimpan agar tidak mengunggah ulang setelah restart', async () => {
    const path = mediaFixture();
    insertMediaAsset(db.raw, {
      id: 'med_a4',
      contentId: 'cnt_a4',
      path,
      sha256: 'd'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: ASSET_BYTES.length,
      validationStatus: 'valid'
    });
    insertSocialAccount(db.raw, { id: 'acc_a4', platform: 'youtube', label: 'kanal uji' });

    const job = insertJob(db.raw, {
      jobType: 'PUBLISH',
      idempotencyKey: 'publish-job-a4',
      campaignId,
      contentId: 'cnt_a4',
      payload: {}
    });
    const attempt = insertPublishAttempt(db.raw, {
      jobId: job.id,
      accountId: 'acc_a4',
      platform: 'youtube',
      idempotencyKey: 'publish:job_a4'
    });
    updatePublishAttempt(db.raw, {
      id: attempt.id,
      status: 'processing',
      externalPostId: 'yt_tersimpan'
    });

    const store = new MemoryCredentialStore();
    await store.save('youtube-acc_a4', tokenRecord());
    const { impl, urls } = fakeFetch(() => new Response('{}'));

    const publisher = createYouTubeApiPublisher({
      db,
      config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store,
      fetchImpl: impl
    });

    await expect(publisher.publish(publishRequest())).resolves.toEqual({
      status: 'processing',
      externalPostId: 'yt_tersimpan',
      retryable: false,
      errorCode: 'YT_UPLOAD_IN_PROGRESS'
    });
    expect(urls).toHaveLength(0);
  });

  it('melaporkan authStatus connected hanya bila akun YouTube tunggal punya token', async () => {
    insertSocialAccount(db.raw, { id: 'acc_a4', platform: 'youtube', label: 'kanal uji' });
    const store = new MemoryCredentialStore();
    await store.save('youtube-acc_a4', tokenRecord());

    const publisher = createYouTubeApiPublisher({
      db,
      config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store,
      fetchImpl: fakeFetch(() => new Response('{}')).impl
    });

    await expect(publisher.capabilities()).resolves.toMatchObject({ authStatus: 'connected' });

    insertSocialAccount(db.raw, { id: 'acc_kedua', platform: 'youtube', label: 'kanal kedua' });
    const ambiguous = createYouTubeApiPublisher({
      db,
      config: loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' }),
      credentials: { clientId: 'client-uji', clientSecret: null },
      store,
      fetchImpl: fakeFetch(() => new Response('{}')).impl
    });

    await expect(ambiguous.capabilities()).resolves.toMatchObject({ authStatus: 'disconnected' });
  });
});
