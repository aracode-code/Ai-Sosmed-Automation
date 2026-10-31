import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashCaption } from '@saa/domain';
import {
  insertCampaign,
  insertMediaAsset,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

interface DetailPayload {
  content: { id: string; version: number; caption: unknown; approvalStatus: string };
  campaign: { id: string; platforms: string[]; approvalMode: string };
  assets: { sha256: string; mimeType: string; validationStatus: string; path?: string }[];
  captionHash: string;
  accounts: { id: string; platform: string; connectionStatus: string; secretRef?: string }[];
}

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;
let campaignId: string;

const SHA_V1 = 'a'.repeat(64);
const SHA_V2 = 'b'.repeat(64);

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-content-detail-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);

  const campaign = insertCampaign(db.raw, {
    name: 'Demo',
    niche: 'edukasi',
    approvalMode: 'required',
    platforms: ['youtube']
  });
  campaignId = campaign.id;

  upsertContentItem(db.raw, {
    id: 'cnt_1',
    campaignId,
    version: 1,
    topic: 'Topik v1',
    prompt: { videoPrompt: 'prompt v1' },
    caption: { youtube: 'Caption v1' }
  });
  // Versi lebih tinggi harus memakai id baris baru: PK content_items = id (drift vs LLD §5).
  upsertContentItem(db.raw, {
    id: 'cnt_2',
    campaignId,
    version: 5,
    topic: 'Topik v5',
    prompt: { videoPrompt: 'prompt v5' },
    caption: { youtube: 'Caption v5' }
  });

  insertMediaAsset(db.raw, {
    id: 'med_v1',
    contentId: 'cnt_1',
    path: 'C:/private/aset-v1.mp4',
    sha256: SHA_V1,
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    validationStatus: 'valid'
  });
  insertMediaAsset(db.raw, {
    id: 'med_v2',
    contentId: 'cnt_1',
    path: 'C:/private/aset-v2.mp4',
    sha256: SHA_V2,
    mimeType: 'video/mp4',
    sizeBytes: 2048,
    validationStatus: 'invalid'
  });

  insertSocialAccount(db.raw, { platform: 'youtube', label: 'Kanal A' });
  insertSocialAccount(db.raw, { platform: 'tiktok', label: 'Kanal B' });

  app = buildApp({ db, config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') }) });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('GET /api/v1/content/:id', () => {
  it('mengembalikan konten beserta hash caption dan kandidat akun', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_1' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<DetailPayload>();
    expect(payload.content.id).toBe('cnt_1');
    expect(payload.content.version).toBe(1);
    expect(payload.captionHash).toBe(hashCaption({ youtube: 'Caption v1' }));
    expect(payload.campaign.platforms).toEqual(['youtube']);
    expect(payload.campaign.approvalMode).toBe('required');
    expect(payload.assets).toHaveLength(2);
    expect(payload.accounts.map((account) => account.platform)).toEqual(['youtube']);
  });

  it('mengembalikan versi tertinggi untuk baris id tersebut', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_2' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<DetailPayload>();
    expect(payload.content.version).toBe(5);
    expect(payload.captionHash).toBe(hashCaption({ youtube: 'Caption v5' }));
  });

  it('tidak membocorkan path filesystem maupun referensi rahasia', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_1' });
    const payload = response.json<DetailPayload>();

    expect(payload.assets.every((asset) => asset.path === undefined)).toBe(true);
    expect(payload.accounts.every((account) => account.secretRef === undefined)).toBe(true);
    expect(response.body).not.toContain('C:/private');
  });

  it('menghormati parameter versi eksplisit', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_1?version=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json<DetailPayload>().content.version).toBe(1);
  });

  it('404 untuk konten yang tidak ada', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_tidak_ada' });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('404 untuk versi yang tidak ada pada baris yang ada', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_1?version=2' });

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('v2');
  });

  it('400 untuk versi yang bukan bilangan bulat positif', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/cnt_1?version=0' });

    expect(response.statusCode).toBe(400);
  });
});
