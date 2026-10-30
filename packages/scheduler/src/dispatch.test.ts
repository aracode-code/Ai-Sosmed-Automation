import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCaption, type PlatformId } from '@saa/domain';
import {
  insertApproval,
  insertCampaign,
  insertMediaAsset,
  insertSchedule,
  insertSocialAccount,
  listJobs,
  openDatabase,
  runMigrations,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { enqueueDuePublicationJobs } from './dispatch';

/** 10:00 WIB. */
const T0 = '2026-01-01T03:00:00.000Z';
const CONTEXT = { now: new Date(T0), localDate: '2026-01-01' };
const SHA = 'a'.repeat(64);

const cleanups: (() => void)[] = [];
let dbCounter = 0;

function openMigrated(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-dispatch-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const handle = openDatabase(join(dir, `dispatch-${(dbCounter += 1)}.sqlite`));
  runMigrations(handle.raw);
  cleanups.push(() => handle.close());
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface SeedOptions {
  approvalMode?: 'automatic' | 'required';
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  caption?: unknown;
  assetStatus?: 'valid' | 'invalid' | null;
  accountStatus?: 'connected' | 'reauth_required' | 'disconnected';
  platforms?: PlatformId[];
}

function seed(db: DatabaseHandle, options: SeedOptions = {}) {
  const approvalMode = options.approvalMode ?? 'automatic';
  const platforms = options.platforms ?? ['youtube'];
  const campaign = insertCampaign(db.raw, {
    name: 'Edukasi AI',
    niche: 'teknologi',
    approvalMode,
    platforms
  });
  const content = upsertContentItem(db.raw, {
    id: `cnt_${campaign.id}`,
    campaignId: campaign.id,
    topic: 'Dasar AI',
    prompt: {},
    caption: options.caption ?? {
      youtube: { caption: 'Dasar AI dalam 30 detik', title: 'Dasar AI' }
    },
    approvalStatus:
      options.approvalStatus ?? (approvalMode === 'automatic' ? 'not_required' : 'pending')
  });

  const assetStatus = options.assetStatus === undefined ? 'valid' : options.assetStatus;
  if (assetStatus !== null) {
    insertMediaAsset(db.raw, {
      id: `med_${content.id}`,
      contentId: content.id,
      path: `content/${content.id}/video.mp4`,
      sha256: SHA,
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      validationStatus: assetStatus
    });
  }

  const account = insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'YouTube utama',
    connectionStatus: options.accountStatus ?? 'connected'
  });

  const schedule = insertSchedule(db.raw, {
    campaignId: campaign.id,
    mode: 'fixed',
    minMinutes: 60,
    timezone: 'Asia/Jakarta',
    dailyLimit: 2,
    nextRunAt: T0
  });

  return { campaign, content, account, schedule };
}

describe('enqueueDuePublicationJobs', () => {
  it('membuat satu job PUBLISH dengan payload dan key idempoten per akun', () => {
    const db = openMigrated();
    const { campaign, content, account, schedule } = seed(db);

    const jobIds = enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube']);

    expect(jobIds).toHaveLength(1);
    const job = listJobs(db.raw).items[0];
    expect(job).toMatchObject({
      id: jobIds[0],
      jobType: 'PUBLISH',
      status: 'QUEUED',
      campaignId: campaign.id,
      contentId: content.id,
      idempotencyKey: `publish:${content.id}:v1:${account.id}:youtube`,
      payload: {
        contentId: content.id,
        campaignId: campaign.id,
        accountId: account.id,
        platform: 'youtube'
      }
    });
  });

  it('dispatch kedua tidak membuat job duplikat', () => {
    const db = openMigrated();
    const { schedule } = seed(db);

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toHaveLength(1);
    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(1);
  });

  it('menolak dispatch bila belum ada approval pada mode required', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { approvalMode: 'required' });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });

  it('membuat job setelah approval terbinding pada caption dan aset yang sama', () => {
    const db = openMigrated();
    const caption = { youtube: { caption: 'Dasar AI dalam 30 detik' } };
    const { content, account, schedule } = seed(db, {
      approvalMode: 'required',
      approvalStatus: 'approved',
      caption
    });
    insertApproval(db.raw, {
      contentId: content.id,
      contentVersion: content.version,
      assetSha256: SHA,
      captionHash: hashCaption(caption),
      accountId: account.id,
      platform: 'youtube',
      decision: 'approved',
      decidedBy: 'owner'
    });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toHaveLength(1);
  });

  it('menolak dispatch bila caption berubah setelah approval', () => {
    const db = openMigrated();
    const approvedCaption = { youtube: { caption: 'Dasar AI dalam 30 detik' } };
    const { content, account, schedule } = seed(db, {
      approvalMode: 'required',
      approvalStatus: 'approved',
      caption: { youtube: { caption: 'Dasar AI diubah setelah review' } }
    });
    insertApproval(db.raw, {
      contentId: content.id,
      contentVersion: content.version,
      assetSha256: SHA,
      captionHash: hashCaption(approvedCaption),
      accountId: account.id,
      platform: 'youtube',
      decision: 'approved',
      decidedBy: 'owner'
    });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati konten yang ditolak reviewer meski mode otomatis', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { approvalStatus: 'rejected' });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati akun yang tidak terhubung dan platform tanpa adapter', () => {
    const db = openMigrated();
    const disconnected = seed(db, { accountStatus: 'disconnected' });
    expect(enqueueDuePublicationJobs(db, disconnected.schedule, CONTEXT, ['youtube'])).toEqual([]);

    const noAdapter = seed(db, {});
    expect(enqueueDuePublicationJobs(db, noAdapter.schedule, CONTEXT, [])).toEqual([]);
    expect(listJobs(db.raw).items).toHaveLength(0);
  });

  it('melewati konten tanpa aset media valid', () => {
    const db = openMigrated();
    const noAsset = seed(db, { assetStatus: null });
    expect(enqueueDuePublicationJobs(db, noAsset.schedule, CONTEXT, ['youtube'])).toEqual([]);

    const invalid = seed(db, { assetStatus: 'invalid' });
    expect(enqueueDuePublicationJobs(db, invalid.schedule, CONTEXT, ['youtube'])).toEqual([]);
  });

  it('melewati platform yang tidak ada di campaign atau tanpa caption', () => {
    const db = openMigrated();
    const { schedule } = seed(db, { caption: { tiktok: { caption: 'caption tiktok' } } });

    expect(enqueueDuePublicationJobs(db, schedule, CONTEXT, ['youtube'])).toEqual([]);
  });
});
