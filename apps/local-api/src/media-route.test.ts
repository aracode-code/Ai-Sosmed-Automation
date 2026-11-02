import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  insertCampaign,
  insertMediaAsset,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00
]);

let workDir: string;
let mediaRoot: string;
let db: DatabaseHandle;
let app: FastifyInstance;
let contentId: string;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-media-route-'));
  mediaRoot = join(workDir, 'media');
  mkdirSync(mediaRoot, { recursive: true });
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
  const campaign = insertCampaign(db.raw, {
    name: 'Demo media',
    niche: 'edukasi',
    approvalMode: 'automatic',
    platforms: ['youtube']
  });
  contentId = 'cnt_media_1';
  upsertContentItem(db.raw, {
    id: contentId,
    campaignId: campaign.id,
    topic: 'Topik',
    prompt: { videoPrompt: 'prompt' }
  });
  app = buildApp({
    db,
    config: loadConfig({
      DATABASE_PATH: join(workDir, 'app.sqlite'),
      MEDIA_ROOT: mediaRoot
    })
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

function writeAsset(relativePath: string, bytes: Buffer): string {
  const filePath = join(mediaRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return filePath;
}

describe('GET /api/v1/media/:id/file', () => {
  it('menyajikan berkas PNG yang terdaftar dengan tipe dan checksum', async () => {
    const filePath = writeAsset(join('content', `${contentId}.png`), PNG_BYTES);
    insertMediaAsset(db.raw, {
      id: 'med_media_1',
      contentId,
      path: filePath,
      sha256: 'a'.repeat(64),
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      validationStatus: 'valid'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/media/med_media_1/file' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['content-length']).toBe(String(PNG_BYTES.length));
    expect(response.headers['x-media-sha256']).toBe('a'.repeat(64));
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('404 untuk aset yang tidak terdaftar', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/media/med_tidak_ada/file' });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('409 bila path aset berada di luar MEDIA_ROOT', async () => {
    const outside = join(workDir, 'rahasia.png');
    writeFileSync(outside, PNG_BYTES);
    insertMediaAsset(db.raw, {
      id: 'med_outside',
      contentId,
      path: outside,
      sha256: 'b'.repeat(64),
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      validationStatus: 'valid'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/media/med_outside/file' });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MEDIA_OUTSIDE_ROOT');
    expect(response.body).not.toContain(PNG_BYTES.toString('base64'));
  });

  it('404 bila berkas aset hilang dari disk', async () => {
    insertMediaAsset(db.raw, {
      id: 'med_missing',
      contentId,
      path: join(mediaRoot, 'content', 'hilang.png'),
      sha256: 'c'.repeat(64),
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      validationStatus: 'valid'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/media/med_missing/file' });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MEDIA_MISSING');
  });

  it('409 untuk tipe media yang tidak disajikan', async () => {
    const filePath = writeAsset(join('content', 'catatan.txt'), Buffer.from('halo'));
    insertMediaAsset(db.raw, {
      id: 'med_text',
      contentId,
      path: filePath,
      sha256: 'd'.repeat(64),
      mimeType: 'text/plain',
      sizeBytes: 4,
      validationStatus: 'valid'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/media/med_text/file' });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('MEDIA_UNSUPPORTED');
  });
});
