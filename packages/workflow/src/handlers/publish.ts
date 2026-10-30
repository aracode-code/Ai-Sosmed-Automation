import {
  AppError,
  checkApprovalBinding,
  errorClassOf,
  hashCaption,
  PLATFORM_IDS,
  resolveCaption,
  type MediaAsset,
  type PublishRequest,
  type PublishResult,
  type SocialAdapter
} from '@saa/domain';
import {
  appendAudit,
  getCampaign,
  getContentItem,
  getLatestApproval,
  getPublishAttemptByKey,
  getSocialAccount,
  insertPublishAttempt,
  listMediaByContent,
  updatePublishAttempt,
  type DatabaseHandle,
  type TransitionPatch
} from '@saa/database';
import { z } from 'zod';
import type { HandlerContext, JobHandler } from '../dispatcher';
import { computeBackoffMs, classify, type BackoffConfig } from '../retry';

const payloadSchema = z.object({
  contentId: z.string().min(1).max(100),
  campaignId: z.string().min(1).max(100),
  accountId: z.string().min(1).max(100),
  platform: z.enum(PLATFORM_IDS)
});

export interface PublishDeps {
  db: DatabaseHandle;
  /** Kontrak LLD §11.1; adapter asli belum aktif (OD-2/OD-5). */
  adapter: SocialAdapter;
  now?: () => Date;
  backoff?: Partial<BackoffConfig>;
}

function pickValidAsset(assets: MediaAsset[]): MediaAsset | null {
  const valid = assets.filter((asset) => asset.validationStatus === 'valid');
  return valid.length === 0 ? null : valid[valid.length - 1];
}

function evidenceOf(result: PublishResult, verifiedAt: string) {
  const hasIdentity =
    (result.externalPostId?.trim() ?? '') !== '' || (result.permalink?.trim() ?? '') !== '';
  if (!hasIdentity) return null;
  return {
    ...(result.externalPostId === undefined ? {} : { externalPostId: result.externalPostId }),
    ...(result.permalink === undefined ? {} : { permalink: result.permalink }),
    verifiedAt
  };
}

/**
 * Handler langkah PUBLISH: satu job = satu publikasi ke satu akun/platform.
 * Attempt dicatat SEBELUM aksi eksternal; hasil akhir selalu lewat rekonsiliasi
 * `getStatus`, bukan asumsi bahwa `publish()` berarti posting sudah tayang.
 */
export function createPublishHandler(deps: PublishDeps): JobHandler {
  const now = deps.now ?? (() => new Date());
  const backoff = deps.backoff;

  return async (ctx) => {
    const parsed = payloadSchema.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'payload PUBLISH tidak valid', { cause: parsed.error });
    }
    const { contentId, campaignId, accountId, platform } = parsed.data;

    if (deps.adapter.platform !== platform) {
      throw new AppError(
        'VALIDATION',
        `adapter ${deps.adapter.platform} tidak dapat mempublikasikan ke ${platform}`
      );
    }

    const campaign = getCampaign(deps.db.raw, campaignId);
    if (campaign === null) {
      throw new AppError('VALIDATION', `campaign ${campaignId} tidak ditemukan`);
    }

    const content = getContentItem(deps.db.raw, contentId);
    if (content === null) {
      throw new AppError('VALIDATION', `konten ${contentId} tidak ditemukan`);
    }
    if (content.campaignId !== campaign.id) {
      throw new AppError('VALIDATION', `konten ${content.id} bukan milik campaign ${campaign.id}`);
    }

    const account = getSocialAccount(deps.db.raw, accountId);
    if (account === null) {
      throw new AppError('VALIDATION', `akun ${accountId} tidak ditemukan`);
    }
    if (account.platform !== platform) {
      throw new AppError('VALIDATION', `akun ${account.id} terdaftar sebagai ${account.platform}`);
    }
    if (account.connectionStatus !== 'connected') {
      throw new AppError('AUTH', `akun ${account.id} berstatus ${account.connectionStatus}`);
    }

    const asset = pickValidAsset(listMediaByContent(deps.db.raw, content.id));
    if (asset === null) {
      throw new AppError('VALIDATION', `konten ${content.id} belum punya aset media valid`);
    }

    const target = resolveCaption(content.caption, platform);
    if (target === null) {
      throw new AppError('VALIDATION', `caption untuk platform ${platform} tidak tersedia`);
    }

    if (campaign.approvalMode === 'required') {
      if (content.approvalStatus !== 'approved') {
        throw new AppError(
          'VALIDATION',
          `konten ${content.id} v${content.version} belum disetujui (${content.approvalStatus})`
        );
      }

      const approval = getLatestApproval(deps.db.raw, {
        contentId: content.id,
        contentVersion: content.version,
        accountId: account.id,
        platform
      });
      if (approval === null) {
        throw new AppError(
          'VALIDATION',
          `tidak ada approval untuk ${content.id} v${content.version} → ${account.id}/${platform}`
        );
      }

      // Approval terikat pada 6 elemen; salah satu berubah = wajib review ulang.
      const binding = checkApprovalBinding(approval, {
        contentId: content.id,
        contentVersion: content.version,
        assetSha256: asset.sha256,
        captionHash: hashCaption(content.caption),
        accountId: account.id,
        platform
      });
      if (!binding.ok) {
        throw new AppError(
          'VALIDATION',
          `approval tidak lagi mengikat: ${binding.mismatches.join(', ')}`
        );
      }
    } else if (content.approvalStatus === 'rejected') {
      throw new AppError('VALIDATION', `konten ${content.id} ditolak reviewer`);
    }

    ctx.transition({ type: 'PUBLISH_STARTED' });

    const idempotencyKey = `publish:${ctx.job.id}`;
    const existing = getPublishAttemptByKey(deps.db.raw, idempotencyKey);
    const attempt =
      existing ??
      insertPublishAttempt(
        deps.db.raw,
        { jobId: ctx.job.id, accountId: account.id, platform, idempotencyKey },
        now().toISOString()
      );

    const request: PublishRequest = {
      accountId: account.id,
      assetId: asset.id,
      caption: target.caption,
      ...(target.title === undefined ? {} : { title: target.title }),
      idempotencyKey
    };

    const validation = await deps.adapter.validate(request);
    if (!validation.ok) {
      updatePublishAttempt(deps.db.raw, {
        id: attempt.id,
        status: 'failed',
        errorCode: 'PUBLISH_VALIDATION'
      });
      throw new AppError(
        'VALIDATION',
        `adapter menolak request publikasi: ${validation.issues.join('; ')}`
      );
    }

    let published: PublishResult;
    try {
      published = await deps.adapter.publish(request);
    } catch (error) {
      await handleAdapterError(ctx, error, attempt.id);
      return;
    }

    if (published.status === 'failed') {
      if (published.retryable) {
        retryLater(ctx, attempt.id, published.errorCode ?? 'PUBLISH_FAILED_RETRYABLE');
        return;
      }
      updatePublishAttempt(deps.db.raw, {
        id: attempt.id,
        status: 'failed',
        errorCode: published.errorCode ?? 'PUBLISH_FAILED'
      });
      ctx.transition({ type: 'PERMANENT_FAILURE' }, {
        attempts: ctx.job.attempts + 1,
        lastErrorCode: published.errorCode ?? 'PUBLISH_FAILED',
        clearLease: true
      });
      recordAudit(ctx, 'failed', attempt.id, published.errorCode ?? 'PUBLISH_FAILED');
      return;
    }

    // Publikasi dikirim; status final hanya boleh dari rekonsiliasi.
    ctx.transition({ type: 'PUBLISH_SUBMITTED' });

    // Identitas video dicatat begitu diketahui. Bila proses berhenti sebelum verifikasi,
    // rekonsiliasi setelah restart tetap punya videoId sehingga tidak mengunggah ulang.
    const submittedId = published.externalPostId?.trim() ?? '';
    if (submittedId !== '') {
      updatePublishAttempt(deps.db.raw, {
        id: attempt.id,
        status: published.status,
        externalPostId: submittedId,
        ...(published.permalink === undefined ? {} : { permalink: published.permalink })
      });
    }

    let status: PublishResult;
    try {
      status = await deps.adapter.getStatus(idempotencyKey);
    } catch (error) {
      await handleAdapterError(ctx, error, attempt.id);
      return;
    }

    if (status.status === 'published') {
      const verifiedAt = now().toISOString();
      const evidence = evidenceOf(status, verifiedAt);
      if (evidence === null) {
        escalateUnverified(ctx, attempt.id, 'PUBLISH_EVIDENCE_INCOMPLETE', 'unknown');
        return;
      }
      updatePublishAttempt(deps.db.raw, {
        id: attempt.id,
        status: 'published',
        externalPostId: evidence.externalPostId ?? null,
        permalink: evidence.permalink ?? null,
        verifiedAt,
        errorCode: null
      });
      ctx.transition({ type: 'VERIFICATION_SUCCEEDED', evidence }, { lastErrorCode: null });
      recordAudit(ctx, 'published', attempt.id, null);
      return;
    }

    if (status.status === 'failed') {
      if (status.retryable) {
        retryLater(ctx, attempt.id, status.errorCode ?? 'PUBLISH_FAILED_RETRYABLE');
        return;
      }
      updatePublishAttempt(deps.db.raw, {
        id: attempt.id,
        status: 'failed',
        errorCode: status.errorCode ?? 'PUBLISH_FAILED'
      });
      ctx.transition({ type: 'PERMANENT_FAILURE' }, {
        attempts: ctx.job.attempts + 1,
        lastErrorCode: status.errorCode ?? 'PUBLISH_FAILED',
        clearLease: true
      });
      recordAudit(ctx, 'failed', attempt.id, status.errorCode ?? 'PUBLISH_FAILED');
      return;
    }

    escalateUnverified(ctx, attempt.id, status.errorCode ?? 'PUBLISH_UNVERIFIED', status.status);
  };

  async function handleAdapterError(
    ctx: HandlerContext,
    error: unknown,
    attemptId: string
  ): Promise<void> {
    const decision = classify(error);
    if (decision === 'retry') {
      retryLater(ctx, attemptId, errorClassOf(error));
      return;
    }

    updatePublishAttempt(deps.db.raw, {
      id: attemptId,
      status: 'unknown',
      errorCode: errorClassOf(error)
    });
    // Jalur eskalasi (AUTH/kuota/DISK) tidak pernah melewati escalateUnverified, jadi tanpa
    // baris audit di sini kejadian yang menahan job tidak terlacak sama sekali.
    if (decision === 'escalate') {
      recordAudit(ctx, 'needs_attention', attemptId, errorClassOf(error));
    }
    throw error;
  }

  function retryLater(ctx: HandlerContext, attemptId: string, errorCode: string): void {
    const attempts = ctx.job.attempts + 1;
    updatePublishAttempt(deps.db.raw, { id: attemptId, status: 'failed', errorCode });

    if (attempts >= ctx.job.maxAttempts) {
      ctx.transition({ type: 'PERMANENT_FAILURE' }, {
        attempts,
        lastErrorCode: errorCode,
        clearLease: true
      });
      recordAudit(ctx, 'failed', attemptId, errorCode);
      return;
    }

    const delay = computeBackoffMs(attempts, backoff);
    const patch: TransitionPatch = {
      attempts,
      lastErrorCode: errorCode,
      runAt: new Date(now().getTime() + delay).toISOString(),
      clearLease: true
    };

    // PUBLISHING tidak dapat langsung ke RETRY_WAIT; VERIFYING adalah jalur resminya.
    if (ctx.job.status === 'PUBLISHING') ctx.transition({ type: 'PUBLISH_SUBMITTED' });
    ctx.transition({ type: 'VERIFICATION_FAILED' }, patch);
  }

  function escalateUnverified(
    ctx: HandlerContext,
    attemptId: string,
    errorCode: string,
    status: 'processing' | 'unknown'
  ): void {
    updatePublishAttempt(deps.db.raw, { id: attemptId, status, errorCode });
    ctx.transition({ type: 'AMBIGUOUS_RESULT' }, { lastErrorCode: errorCode, clearLease: true });
    recordAudit(ctx, 'needs_attention', attemptId, errorCode);
  }

  function recordAudit(
    ctx: HandlerContext,
    result: 'published' | 'failed' | 'needs_attention',
    attemptId: string,
    errorCode: string | null
  ): void {
    appendAudit(
      deps.db.raw,
      {
        actorType: 'system',
        action: 'content.publish',
        resourceType: 'publish_attempt',
        resourceId: attemptId,
        result,
        metadata: { jobId: ctx.job.id, errorCode }
      },
      now().toISOString()
    );
  }
}
