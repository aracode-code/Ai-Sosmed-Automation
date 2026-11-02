import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppError,
  hashCaption,
  hashPlanBinding,
  type PublishRequest,
  type PublishResult
} from '@saa/domain';
import {
  applyTransition,
  getJob,
  getPublishAttemptByKey,
  insertApproval,
  insertCampaign,
  insertJob,
  insertMediaAsset,
  insertPlanApproval,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { MockYouTubeAdapter } from '@saa/youtube';
import { Dispatcher, createPublishHandler } from '../index';

const T0 = '2026-01-01T00:00:00.000Z';
const now = () => new Date(T0);
const ASSET_SHA = 'b'.repeat(64);

const cleanups: (() => void)[] = [];
let seq = 0;

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-publish-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  runMigrations(handle.raw);
  cleanups.push(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface SeedOptions {
  approvalMode?: 'automatic' | 'required';
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  approvedCaption?: unknown;
  connectionStatus?: 'connected' | 'reauth_required' | 'disconnected';
  assetMimeType?: 'video/mp4' | 'image/png';
}

function seed(db: DatabaseHandle, options: SeedOptions = {}) {
  seq += 1;
  const campaign = insertCampaign(
    db.raw,
    {
      name: 'Edukasi AI',
      niche: 'edukasi teknologi',
      approvalMode: options.approvalMode ?? 'required',
      platforms: ['youtube']
    },
    T0
  );

  const caption = {
    youtube: {
      caption: 'Dasar AI dalam 30 detik',
      contentFormat: 'short_video',
      title: 'Dasar AI'
    }
  };

  const content = upsertContentItem(db.raw, {
    id: `cnt_pub_${seq}`,
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: { videoPrompt: 'Animasi dasar AI' },
    caption,
    approvalStatus: options.approvalStatus ?? 'approved'
  });

  const asset = insertMediaAsset(db.raw, {
    id: `med_${content.id}`,
    contentId: content.id,
    path: `content/${content.id}/video.mp4`,
    sha256: ASSET_SHA,
    mimeType: options.assetMimeType ?? 'video/mp4',
    sizeBytes: 4_096,
    durationMs: 30_000,
    validationStatus: 'valid'
  });

  const account = insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'YouTube utama',
    connectionStatus: options.connectionStatus ?? 'connected'
  });

  if ((options.approvalMode ?? 'required') === 'required') {
    insertApproval(
      db.raw,
      {
        contentId: content.id,
        contentVersion: content.version,
        assetSha256: asset.sha256,
        captionHash: hashCaption(options.approvedCaption ?? caption),
        accountId: account.id,
        platform: 'youtube',
        decision: 'approved',
        decidedBy: 'owner'
      },
      T0
    );
  }

  return { campaign, content, asset, account };
}

interface PlanSeedOptions {
  approvedCaption?: unknown;
  approvalStatus?: 'approved' | 'rejected';
}

/** Konten dari rencana: tidak ada baris `approvals` per item, hanya keputusan tahap rencana. */
function seedPlanContent(db: DatabaseHandle, options: PlanSeedOptions = {}) {
  seq += 1;
  const status = options.approvalStatus ?? 'approved';
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
  const planJob = insertJob(
    db.raw,
    {
      jobType: 'PLAN_CONTENT',
      idempotencyKey: `plan-publish-${seq}`,
      payload: {},
      campaignId: campaign.id,
      status: 'COMPLETED'
    },
    T0
  );

  const caption = {
    youtube: {
      caption: 'Dasar AI dalam 30 detik',
      contentFormat: 'short_video',
      title: 'Dasar AI'
    }
  };
  const content = upsertContentItem(db.raw, {
    id: `cnt_${planJob.id}_1`,
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: { planJobId: planJob.id, videoPrompt: 'Animasi dasar AI', aspectRatio: '9:16' },
    caption,
    approvalStatus: status
  });

  insertMediaAsset(db.raw, {
    id: `med_${content.id}`,
    contentId: content.id,
    path: `content/${content.id}/video.mp4`,
    sha256: ASSET_SHA,
    mimeType: 'video/mp4',
    sizeBytes: 4_096,
    durationMs: 30_000,
    validationStatus: 'valid'
  });

  const account = insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'YouTube utama',
    connectionStatus: 'connected'
  });

  insertPlanApproval(
    db.raw,
    {
      planJobId: planJob.id,
      campaignId: campaign.id,
      bindingHash: hashPlanBinding([
        {
          contentId: content.id,
          contentVersion: content.version,
          captionHash: hashCaption(options.approvedCaption ?? caption)
        }
      ]),
      itemCount: 1,
      decision: status,
      decidedBy: 'owner'
    },
    T0
  );

  return { campaign, content, account };
}

function enqueuePublish(
  db: DatabaseHandle,
  ids: { campaignId: string; contentId: string; accountId: string }
) {
  seq += 1;
  return insertJob(
    db.raw,
    {
      jobType: 'PUBLISH',
      idempotencyKey: `publish-job-${seq}`,
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

function dispatcherWith(db: DatabaseHandle, adapter: MockYouTubeAdapter) {
  const backoff = { jitterMs: 0, rng: () => 0 };
  return new Dispatcher({
    db,
    workerId: 'w1',
    handlers: { PUBLISH: createPublishHandler({ db, adapter, now, backoff }) },
    now,
    backoff
  });
}

function attemptRows(db: DatabaseHandle, jobId: string): number {
  const row = db.raw
    .prepare('SELECT COUNT(*) AS n FROM publish_attempts WHERE job_id = ?')
    .get(jobId) as { n: number };
  return row.n;
}

/** getStatus yang dapat dikendalikan per panggilan untuk menguji rekonsiliasi. */
class ScriptedStatusAdapter extends MockYouTubeAdapter {
  private readonly statuses: PublishResult[];

  constructor(statuses: PublishResult[]) {
    super();
    this.statuses = [...statuses];
  }

  override async getStatus(idempotencyKey: string): Promise<PublishResult> {
    const next = this.statuses.shift();
    return next ?? super.getStatus(idempotencyKey);
  }
}

class ProcessingWithIdAdapter extends MockYouTubeAdapter {
  override async publish(_request: PublishRequest): Promise<PublishResult> {
    return { status: 'processing', externalPostId: 'yt_submitted_1', retryable: false };
  }

  override async getStatus(_idempotencyKey: string): Promise<PublishResult> {
    return { status: 'unknown', retryable: false, errorCode: 'YT_UNKNOWN_IDEMPOTENCY' };
  }
}

class AuthFailingAdapter extends MockYouTubeAdapter {
  override async publish(_request: PublishRequest): Promise<PublishResult> {
    throw new AppError('AUTH', 'token OAuth kedaluwarsa');
  }
}

describe('PUBLISH handler', () => {
  it('menolak publikasi bila satu-satunya aset valid adalah gambar', async () => {
    const db = tempDb();
    const seeded = seed(db, { assetMimeType: 'image/png' });
    enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter({ now })).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
  });

  it('mempublikasikan lalu memverifikasi lewat getStatus, menutup job ke PUBLISHED', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter({ now })).runOnce();

    expect(result?.id).toBe(job.id);
    expect(result?.status).toBe('PUBLISHED');
    expect(result?.lastErrorCode).toBeNull();
    expect(result?.leaseOwner).toBeNull();

    const attempt = getPublishAttemptByKey(db.raw, `publish:${job.id}`);
    expect(attempt).toMatchObject({
      jobId: job.id,
      accountId: seeded.account.id,
      platform: 'youtube',
      status: 'published',
      verifiedAt: T0,
      errorCode: null
    });
    expect(attempt?.externalPostId).toMatch(/^mock_yt_[0-9a-f]{11}$/);
    expect(attempt?.permalink).toBe(
      `https://www.youtube.com/watch?v=${attempt?.externalPostId}`
    );

    const audits = db.raw
      .prepare('SELECT action, result FROM audit_logs WHERE resource_id = ?')
      .all(attempt?.id) as { action: string; result: string }[];
    expect(audits).toEqual([{ action: 'content.publish', result: 'published' }]);
  });

  it('menolak konten yang belum disetujui dan tidak mencatat attempt', async () => {
    const db = tempDb();
    const seeded = seed(db, { approvalStatus: 'pending' });
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
    expect(attemptRows(db, job.id)).toBe(0);
  });

  it('approval yang tidak lagi cocok dengan caption = kegagalan validasi', async () => {
    const db = tempDb();
    const seeded = seed(db, {
      approvedCaption: { youtube: { caption: 'caption lama', contentFormat: 'short_video' } }
    });
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
    expect(attemptRows(db, job.id)).toBe(0);
  });

  it('akun yang tidak terhubung dieskalasi ke NEEDS_ATTENTION, bukan dicoba', async () => {
    const db = tempDb();
    const seeded = seed(db, { connectionStatus: 'reauth_required' });
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('AUTH');
    expect(attemptRows(db, job.id)).toBe(0);
  });

  it('error AUTH dari adapter dieskalasi dan attempt ditandai unknown', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new AuthFailingAdapter()).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('AUTH');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'unknown',
      errorCode: 'AUTH'
    });
  });

  it('kegagalan retryable dijadwalkan ulang dan menaikkan attempts', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter({
      outcome: 'failed_retryable'
    })).runOnce();

    expect(result?.status).toBe('RETRY_WAIT');
    expect(result?.attempts).toBe(1);
    expect(result?.lastErrorCode).toBe('MOCK_FAILED_RETRYABLE');
    expect(result?.runAt).toBe('2026-01-01T00:00:02.000Z');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'failed',
      errorCode: 'MOCK_FAILED_RETRYABLE'
    });
  });

  it('kegagalan permanen menutup job ke FAILED tanpa retry', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter({
      outcome: 'failed_permanent'
    })).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('MOCK_FAILED_PERMANENT');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)?.status).toBe('failed');
  });

  it('status processing memaksa NEEDS_ATTENTION karena belum dapat diverifikasi', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter({
      statusOutcome: 'processing'
    })).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(result?.lastErrorCode).toBe('PUBLISH_UNVERIFIED');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)?.status).toBe('processing');
  });

  it('menyimpan videoId begitu publish mengembalikan processing', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new ProcessingWithIdAdapter({ now })).runOnce();

    expect(result?.status).toBe('NEEDS_ATTENTION');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'unknown',
      externalPostId: 'yt_submitted_1'
    });
  });

  it('rekonsiliasi setelah unknown memakai attempt yang sama dan berakhir PUBLISHED', async () => {
    const db = tempDb();
    const seeded = seed(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });
    const adapter = new ScriptedStatusAdapter([
      { status: 'unknown', retryable: true, errorCode: 'MOCK_UNKNOWN' },
      {
        status: 'published',
        externalPostId: 'mock_yt_0123456789a',
        permalink: 'https://www.youtube.com/watch?v=mock_yt_0123456789a',
        retryable: false
      }
    ]);

    const first = await dispatcherWith(db, adapter).runOnce();
    expect(first?.status).toBe('NEEDS_ATTENTION');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)?.status).toBe('unknown');

    const requeued = applyTransition(db.raw, {
      jobId: job.id,
      from: 'NEEDS_ATTENTION',
      to: 'QUEUED',
      now: T0,
      patch: { runAt: null, clearLease: true }
    });
    expect(requeued?.status).toBe('QUEUED');

    const second = await dispatcherWith(db, adapter).runOnce();
    expect(second?.status).toBe('PUBLISHED');
    expect(attemptRows(db, job.id)).toBe(1);
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)).toMatchObject({
      status: 'published',
      externalPostId: 'mock_yt_0123456789a',
      verifiedAt: T0
    });
    expect(getJob(db.raw, job.id)?.status).toBe('PUBLISHED');
  });

  it('campaign mode automatic tidak membutuhkan approval', async () => {
    const db = tempDb();
    const seeded = seed(db, { approvalMode: 'automatic', approvalStatus: 'not_required' });
    enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('PUBLISHED');
  });

  it('rencana yang disetujui menggantikan approval per item', async () => {
    const db = tempDb();
    const seeded = seedPlanContent(db);
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('PUBLISHED');
    expect(getPublishAttemptByKey(db.raw, `publish:${job.id}`)?.status).toBe('published');
  });

  it('rencana yang berubah setelah disetujui tidak lolos lewat gerbang rencana', async () => {
    const db = tempDb();
    const seeded = seedPlanContent(db, { approvedCaption: { youtube: { caption: 'caption lama' } } });
    const job = enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
    expect(attemptRows(db, job.id)).toBe(0);
  });

  it('konten dari rencana yang ditolak tidak pernah dipublikasikan', async () => {
    const db = tempDb();
    const seeded = seedPlanContent(db, { approvalStatus: 'rejected' });
    enqueuePublish(db, {
      campaignId: seeded.campaign.id,
      contentId: seeded.content.id,
      accountId: seeded.account.id
    });

    const result = await dispatcherWith(db, new MockYouTubeAdapter()).runOnce();

    expect(result?.status).toBe('FAILED');
    expect(result?.lastErrorCode).toBe('VALIDATION');
  });
});
