import { AppError, type Campaign } from '@saa/domain';
import {
  PlannerOutputError,
  type AspectRatio,
  type PlanDecision,
  type Planner,
  type PlannerInput,
  type PlatformCapability
} from '@saa/agent-core';
import {
  getCampaign,
  insertJobIdempotent,
  upsertContentItem,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import type { JobHandler } from '../dispatcher';

const payloadSchema = z.object({
  campaignId: z.string().min(1).max(100),
  notes: z.string().max(2000).optional()
});

export interface PlanContentAsset {
  id: string;
  aspectRatio?: AspectRatio;
  durationMs?: number;
}

export interface PlanContentDeps {
  db: DatabaseHandle;
  /** Interface planner, bukan adapter vendor (LLD §3). */
  planner: Planner;
  /** Snapshot capability yang jujur; default kosong berarti semua `unknown`. */
  capabilities?: (campaign: Campaign) => PlatformCapability[];
  availableAssets?: (campaign: Campaign) => PlanContentAsset[];
  /** Jeda saat planner memutuskan `wait`; job kembali lewat RETRY_WAIT. */
  waitDelayMs?: number;
  now?: () => Date;
}

const DEFAULT_WAIT_DELAY_MS = 6 * 60 * 60 * 1000;

interface StoredTarget {
  caption: string;
  contentFormat: string;
  title?: string;
}

function captionMap(plan: PlanDecision): Record<string, StoredTarget> {
  const map: Record<string, StoredTarget> = {};
  for (const target of plan.targets ?? []) {
    map[target.platform] = {
      caption: target.caption,
      contentFormat: target.contentFormat,
      ...(target.title === undefined ? {} : { title: target.title })
    };
  }
  return map;
}

/**
 * Handler langkah PLAN_CONTENT: satu job = satu langkah workflow (LLD §4.1).
 * Panggilan model terjadi di luar transaksi SQLite (invariant lease, LLD §5.3).
 */
export function createPlanContentHandler(deps: PlanContentDeps): JobHandler {
  const now = deps.now ?? (() => new Date());
  const waitDelayMs = deps.waitDelayMs ?? DEFAULT_WAIT_DELAY_MS;

  return async (ctx) => {
    const parsed = payloadSchema.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'payload PLAN_CONTENT tidak valid', {
        cause: parsed.error
      });
    }

    const campaign = getCampaign(deps.db.raw, parsed.data.campaignId);
    if (campaign === null) {
      throw new AppError(
        'VALIDATION',
        `campaign ${parsed.data.campaignId} tidak ditemukan`
      );
    }
    if (campaign.platforms.length === 0) {
      throw new AppError('VALIDATION', `campaign ${campaign.id} tidak punya platform target`);
    }

    ctx.transition({ type: 'START_PLANNING' });

    const input: PlannerInput = {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        niche: campaign.niche,
        approvalMode: campaign.approvalMode,
        platforms: campaign.platforms
      },
      capabilities: deps.capabilities?.(campaign) ?? [],
      availableAssets: (deps.availableAssets?.(campaign) ?? []).map((asset) => ({
        id: asset.id,
        ...(asset.aspectRatio === undefined ? {} : { aspectRatio: asset.aspectRatio }),
        ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs })
      })),
      jobContext: {
        jobId: ctx.job.id,
        ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes })
      }
    };

    const result = await deps.planner.plan(input);
    const plan = result.plan;

    if (plan.decision === 'needs_human') {
      ctx.transition({ type: 'ESCALATE' }, { lastErrorCode: 'PLANNER_NEEDS_HUMAN' });
      return;
    }

    if (plan.decision === 'wait') {
      const runAt = new Date(now().getTime() + waitDelayMs).toISOString();
      ctx.transition({ type: 'RETRYABLE_FAILURE' }, { lastErrorCode: 'PLANNER_WAIT', runAt });
      return;
    }

    if (plan.decision === 'revise_metadata') {
      throw new PlannerOutputError(
        'revise_metadata tidak berlaku untuk langkah PLAN_CONTENT tanpa konten yang ada'
      );
    }

    const contentId = `cnt_${ctx.job.id}`;
    const content = upsertContentItem(deps.db.raw, {
      id: contentId,
      campaignId: campaign.id,
      version: 1,
      topic: plan.topic ?? campaign.name,
      prompt: {
        decision: plan.decision,
        videoPrompt: plan.videoPrompt,
        aspectRatio: plan.aspectRatio,
        rationale: plan.rationale
      },
      caption: captionMap(plan),
      approvalStatus: plan.approvalRequired ? 'pending' : 'not_required'
    });

    insertJobIdempotent(deps.db.raw, {
      jobType: 'GENERATE_VIDEO',
      idempotencyKey: `generate:${content.id}`,
      campaignId: campaign.id,
      contentId: content.id,
      parentJobId: ctx.job.id,
      payload: {
        contentId: content.id,
        campaignId: campaign.id,
        videoPrompt: plan.videoPrompt,
        aspectRatio: plan.aspectRatio,
        targets: plan.targets ?? []
      }
    });

    ctx.transition({ type: 'STEP_COMPLETED' }, { contentId: content.id, lastErrorCode: null });
  };
}
