import {
  checkApprovalBinding,
  hashCaption,
  resolveCaption,
  type PlatformId,
  type Schedule
} from '@saa/domain';
import {
  getCampaign,
  getJobByIdempotencyKey,
  getLatestApproval,
  insertJobIdempotent,
  listContentByCampaign,
  listMediaByContent,
  listSocialAccounts,
  type DatabaseHandle
} from '@saa/database';
import type { EnqueueContext, EnqueueFn } from './scheduler';

export interface PublicationEnqueuerOptions {
  db: DatabaseHandle;
  /** Platform yang adapter publikasinya terdaftar; platform lain tidak pernah di-enqueue. */
  platforms: readonly PlatformId[];
}

/**
 * Job PUBLISH dibuat di sini, bukan oleh handler sebelumnya: jadwal yang menentukan
 * kapan publikasi boleh terjadi, dan hanya konten terbaru yang sudah benar-benar siap
 * (media valid + approval terbinding) yang boleh masuk antrean.
 */
export function enqueueDuePublicationJobs(
  db: DatabaseHandle,
  schedule: Schedule,
  context: EnqueueContext,
  platforms: readonly PlatformId[]
): string[] {
  if (platforms.length === 0) return [];

  const campaign = getCampaign(db.raw, schedule.campaignId);
  if (campaign === null || campaign.status !== 'active') return [];

  const content = listContentByCampaign(db.raw, campaign.id)[0];
  if (content === undefined || content.approvalStatus === 'rejected') return [];

  const validAssets = listMediaByContent(db.raw, content.id).filter(
    (asset) => asset.validationStatus === 'valid'
  );
  const asset = validAssets[validAssets.length - 1];
  if (asset === undefined) return [];

  const accounts = listSocialAccounts(db.raw).filter(
    (account) =>
      account.connectionStatus === 'connected' &&
      campaign.platforms.includes(account.platform) &&
      platforms.includes(account.platform)
  );
  if (accounts.length === 0) return [];

  const captionHash = hashCaption(content.caption);
  const jobIds: string[] = [];

  for (const account of accounts) {
    const platform = account.platform;
    if (resolveCaption(content.caption, platform) === null) continue;

    if (campaign.approvalMode === 'required') {
      if (content.approvalStatus !== 'approved') continue;
      const approval = getLatestApproval(db.raw, {
        contentId: content.id,
        contentVersion: content.version,
        accountId: account.id,
        platform
      });
      if (approval === null) continue;
      const binding = checkApprovalBinding(approval, {
        contentId: content.id,
        contentVersion: content.version,
        assetSha256: asset.sha256,
        captionHash,
        accountId: account.id,
        platform
      });
      if (!binding.ok) continue;
    }

    const idempotencyKey = `publish:${content.id}:v${content.version}:${account.id}:${platform}`;
    if (getJobByIdempotencyKey(db.raw, idempotencyKey) !== null) continue;

    const job = insertJobIdempotent(
      db.raw,
      {
        jobType: 'PUBLISH',
        idempotencyKey,
        campaignId: campaign.id,
        contentId: content.id,
        payload: {
          contentId: content.id,
          campaignId: campaign.id,
          accountId: account.id,
          platform
        }
      },
      context.now.toISOString()
    );
    jobIds.push(job.id);
  }

  return jobIds;
}

export function createPublicationEnqueuer(options: PublicationEnqueuerOptions): EnqueueFn {
  return (schedule, context) =>
    enqueueDuePublicationJobs(options.db, schedule, context, options.platforms);
}
