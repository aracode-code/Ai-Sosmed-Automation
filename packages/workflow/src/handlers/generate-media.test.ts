import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MockMediaGenerator,
  type GeneratedMedia,
  type MediaGenerator
} from '@saa/browser-engine';
import {
  getContentItem,
  getJob,
  getMediaAsset,
  insertCampaign,
  insertJob,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { Dispatcher, createGenerateMediaHandler, type HandlerContext } from '../index';

const T0 = '2026-01-01T00:00:00.000Z';
const now = () => new Date(T0);

const cleanups: (() => void)[] = [];
let seq = 0;

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-gen-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  runMigrations(handle.raw);
  cleanups.push(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return handle;
}

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saa-media-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function seededContent(db: DatabaseHandle) {
  seq += 1;
  const campaign = insertCampaign(
    db.raw,
    {
      name: 'Edukasi AI',
      niche: 'edukasi teknologi',
      approvalMode: 'required',
      platforms: ['youtube']
    },
    T0
  );
  const content = upsertContentItem(db.raw, {
    id: `cnt_gen_${seq}`,
    campaignId: campaign.id,
    topic: 'Tokenisasi',
    prompt: { videoPrompt: 'Animasi tokenisasi' },
    caption: {},
    approvalStatus: 'pending'
  });
  return { campaign, content };
}

function enqueueMedia(
  db: DatabaseHandle,
  campaignId: string,
  contentId: string,
  jobType: 'GENERATE_VIDEO' | 'GENERATE_IMAGE',
  aspectRatio = '9:16'
) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType,
      idempotencyKey: `generate-${seq}`,
      payload: {
        contentId,
        campaignId,
        videoPrompt: 'Animasi memecah kalimat menjadi token',
        aspectRatio,
        targets: []
      },
      campaignId,
      contentId
    },
    T0
  );
}

function dispatcherWith(
  db: DatabaseHandle,
  generator: MediaGenerator,
  outputRoot: string,
  kind: 'video' | 'image' = 'video'
) {
  const handler = createGenerateMediaHandler({ db, generator, outputRoot }, kind);
  return new Dispatcher({
    db,
    workerId: 'w1',
    handlers: { [kind === 'image' ? 'GENERATE_IMAGE' : 'GENERATE_VIDEO']: handler },
    now,
    backoff: { jitterMs: 0, rng: () => 0 }
  });
}

describe('handler produksi media', () => {
  it('menghasilkan video valid, menyimpan aset, dan menutup job ke COMPLETED', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign, content } = seededContent(db);
    const job = enqueueMedia(db, campaign.id, content.id, 'GENERATE_VIDEO');

    const result = await dispatcherWith(db, new MockMediaGenerator({ outputRoot: root }), root).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('COMPLETED');
    expect(result?.contentId).toBe(content.id);
    expect(result?.leaseOwner).toBeNull();

    const asset = getMediaAsset(db.raw, `med_${content.id}`);
    expect(asset).toMatchObject({
      contentId: content.id,
      mimeType: 'video/mp4',
      validationStatus: 'valid'
    });
    expect(asset?.sizeBytes).toBeGreaterThan(0);
    expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset?.path.startsWith(root)).toBe(true);
    expect(existsSync(asset?.path ?? '')).toBe(true);

    const bytes = readFileSync(asset?.path ?? '');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset?.sha256);
  });

  it('mode image menghasilkan PNG valid tanpa durasi', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign, content } = seededContent(db);
    const job = enqueueMedia(db, campaign.id, content.id, 'GENERATE_IMAGE');

    const result = await dispatcherWith(
      db,
      new MockMediaGenerator({ outputRoot: root }),
      root,
      'image'
    ).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('COMPLETED');

    const asset = getMediaAsset(db.raw, `med_${content.id}`);
    expect(asset).toMatchObject({
      mimeType: 'image/png',
      validationStatus: 'valid',
      durationMs: null
    });
    const bytes = readFileSync(asset?.path ?? '');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('menjadwalkan ulang ketika generator tidak tersedia', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign, content } = seededContent(db);
    enqueueMedia(db, campaign.id, content.id, 'GENERATE_VIDEO');

    const generator: MediaGenerator = {
      async checkAvailability() {
        return { available: false, reason: 'profil browser terkunci' };
      },
      async generate() {
        throw new Error('tidak boleh dipanggil');
      }
    };

    const result = await dispatcherWith(db, generator, root).runOnce();

    expect(result?.status).toBe('RETRY_WAIT');
    expect(result?.lastErrorCode).toBe('RESOURCE_BUSY');
    expect(getMediaAsset(db.raw, `med_${content.id}`)).toBeNull();
  });

  it('media tidak valid berakhir FAILED dengan kode VALIDATION', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign, content } = seededContent(db);
    enqueueMedia(db, campaign.id, content.id, 'GENERATE_VIDEO');

    const bytes = Buffer.alloc(4_096, 1);
    const filePath = join(root, 'rusak.mp4');
    writeFileSync(filePath, bytes);
    const generator: MediaGenerator = {
      async checkAvailability() {
        return { available: true };
      },
      async generate(): Promise<GeneratedMedia> {
        return {
          filePath,
          mimeType: 'video/mp4',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        };
      }
    };

    const result = await dispatcherWith(db, generator, root).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
    expect(getMediaAsset(db.raw, `med_${content.id}`)).toBeNull();
  });

  it('payload dengan konten yang tidak ada = kegagalan validasi', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign } = seededContent(db);
    seq += 1;
    const job = insertJob(
      db.raw,
      {
        jobType: 'GENERATE_VIDEO',
        idempotencyKey: `generate-missing-${seq}`,
        payload: {
          contentId: 'cnt_tidak_ada',
          campaignId: campaign.id,
          videoPrompt: 'Apa saja',
          aspectRatio: '9:16'
        }
      },
      T0
    );

    const result = await dispatcherWith(db, new MockMediaGenerator({ outputRoot: root }), root).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
  });

  it('pengulangan handler tidak membuat aset ganda', async () => {
    const db = tempDb();
    const root = tempRoot();
    const { campaign, content } = seededContent(db);
    const job = enqueueMedia(db, campaign.id, content.id, 'GENERATE_VIDEO');
    const handler = createGenerateMediaHandler(
      {
        db,
        generator: new MockMediaGenerator({ outputRoot: root }),
        outputRoot: root
      },
      'video'
    );

    const stubContext: HandlerContext = {
      get job() {
        return getJob(db.raw, job.id) ?? job;
      },
      transition() {
        return getJob(db.raw, job.id) ?? job;
      }
    };

    await handler(stubContext);
    await handler(stubContext);

    const rows = db.raw.prepare('SELECT * FROM media_assets').all();
    expect(rows).toHaveLength(1);
    expect(getContentItem(db.raw, content.id)?.id).toBe(content.id);
  });
});
