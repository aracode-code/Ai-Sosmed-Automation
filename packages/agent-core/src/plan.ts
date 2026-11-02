import { z } from 'zod';
import { ASPECT_RATIOS, PLATFORM_IDS, type AspectRatio, type PlatformId } from '@saa/domain';

/** Sumber tunggal tipe rasio ada di `@saa/domain` (ADR-0010 F17/F19). */
export type { AspectRatio } from '@saa/domain';

export const CAPABILITY_STATES = ['supported', 'unsupported', 'unknown'] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** LLD §6: kapabilitas yang belum terverifikasi wajib `unknown`, bukan diasumsikan didukung. */
export const platformCapabilitySchema = z.object({
  platform: z.enum(PLATFORM_IDS),
  video: z.enum(CAPABILITY_STATES).default('unknown'),
  directPost: z.enum(CAPABILITY_STATES).default('unknown'),
  captionMaxLength: z.number().int().positive().max(10_000).optional()
});
export type PlatformCapability = z.infer<typeof platformCapabilitySchema>;

export const approvalModeSchema = z.enum(['automatic', 'required']);
export type ApprovalMode = z.infer<typeof approvalModeSchema>;

export const plannerInputSchema = z.object({
  campaign: z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    niche: z.string().min(1).max(200),
    approvalMode: approvalModeSchema,
    platforms: z.array(z.enum(PLATFORM_IDS)).min(1).max(PLATFORM_IDS.length)
  }),
  capabilities: z.array(platformCapabilitySchema).default([]),
  availableAssets: z
    .array(
      z.object({
        id: z.string().min(1),
        aspectRatio: z.enum(ASPECT_RATIOS).optional(),
        durationMs: z.number().int().nonnegative().optional()
      })
    )
    .default([]),
  jobContext: z
    .object({
      jobId: z.string().min(1).optional(),
      notes: z.string().max(2000).optional()
    })
    .default({})
});
export type PlannerInput = z.infer<typeof plannerInputSchema>;

export const PLAN_DECISIONS = ['create_video', 'revise_metadata', 'wait', 'needs_human'] as const;
export type PlanDecisionType = (typeof PLAN_DECISIONS)[number];

export const planTargetSchema = z.object({
  platform: z.enum(PLATFORM_IDS),
  contentFormat: z.string().min(1).max(100),
  caption: z.string().min(1).max(2200),
  title: z.string().min(1).max(100).optional()
});
export type PlanTarget = z.infer<typeof planTargetSchema>;

export const MAX_PLAN_ITEMS = 5;

/** Satu video dalam rencana batch; rasio mengikuti policy target, bukan model. */
export const planItemSchema = z.object({
  topic: z.string().min(1).max(300),
  videoPrompt: z.string().min(1).max(4000),
  targets: z.array(planTargetSchema).min(1).max(PLATFORM_IDS.length)
});
export type PlanItem = z.infer<typeof planItemSchema>;

/**
 * Bentuk output planner — LLD §9.1. Output model diperlakukan sebagai data tidak tepercaya.
 * `items` (1–5 video) dan field tunggal (topic/videoPrompt/aspectRatio/targets) saling
 * eksklusif secara semantik; field tunggal dipertahankan untuk kompatibilitas output lama.
 */
export const planDecisionSchema = z.object({
  campaignId: z.string().min(1),
  decision: z.enum(PLAN_DECISIONS),
  items: z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS).optional(),
  topic: z.string().min(1).max(300).optional(),
  videoPrompt: z.string().min(1).max(4000).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  targets: z.array(planTargetSchema).min(1).max(PLATFORM_IDS.length).optional(),
  approvalRequired: z.boolean(),
  rationale: z.string().min(1).max(2000)
});
export type PlanDecision = z.infer<typeof planDecisionSchema>;

export interface ResolvedPlanItem {
  topic: string;
  videoPrompt: string;
  targets: PlanTarget[];
  /** Hanya terisi pada bentuk tunggal; bentuk batch memakai policy target. */
  aspectRatio?: AspectRatio;
}

/** Normalisasi bentuk batch (`items`) dan bentuk tunggal menjadi daftar item yang sama. */
export function planItemsOf(plan: PlanDecision): ResolvedPlanItem[] {
  if (plan.items !== undefined) {
    return plan.items.map((item) => ({
      topic: item.topic,
      videoPrompt: item.videoPrompt,
      targets: item.targets
    }));
  }

  if (plan.topic === undefined || plan.videoPrompt === undefined) return [];

  return [
    {
      topic: plan.topic,
      videoPrompt: plan.videoPrompt,
      targets: plan.targets ?? [],
      ...(plan.aspectRatio === undefined ? {} : { aspectRatio: plan.aspectRatio })
    }
  ];
}

/**
 * Batas token caption default per platform; dipakai hanya bila capability belum
 * menyatakan batasnya. Angka konservatif, bukan klaim kapabilitas.
 */
export const DEFAULT_CAPTION_LIMIT = 2200;

export function capabilityFor(
  capabilities: readonly PlatformCapability[],
  platform: PlatformId
): PlatformCapability | undefined {
  return capabilities.find((capability) => capability.platform === platform);
}

function checkTargets(
  targets: readonly PlanTarget[],
  input: PlannerInput,
  prefix: string,
  issues: string[]
): void {
  const seen = new Set<string>();

  for (const target of targets) {
    if (seen.has(target.platform)) {
      issues.push(`${prefix}platform ${target.platform} muncul lebih dari sekali di targets`);
    }
    seen.add(target.platform);

    if (!input.campaign.platforms.includes(target.platform)) {
      issues.push(`${prefix}platform ${target.platform} bukan target campaign`);
      continue;
    }

    const capability = capabilityFor(input.capabilities, target.platform);
    if (capability?.video === 'unsupported') {
      issues.push(`${prefix}platform ${target.platform} tidak mendukung video menurut capability`);
    }

    const limit = capability?.captionMaxLength ?? DEFAULT_CAPTION_LIMIT;
    if (target.caption.length > limit) {
      issues.push(
        `${prefix}caption ${target.platform} melebihi batas ${limit} karakter (${target.caption.length})`
      );
    }
  }
}

/**
 * Aturan yang tidak dapat dipercayakan ke model: campaign harus cocok, target harus
 * termasuk platform campaign, kapabilitas `unsupported` menolak target, dan caption
 * tidak boleh melebihi batas yang diketahui. Rencana batch divalidasi per item.
 */
export function checkPlanAgainstCampaign(
  plan: PlanDecision,
  input: PlannerInput
): string[] {
  const issues: string[] = [];

  if (plan.campaignId !== input.campaign.id) {
    issues.push(`campaignId ${plan.campaignId} tidak cocok dengan campaign ${input.campaign.id}`);
  }

  if (plan.decision === 'create_video') {
    if (plan.items !== undefined) {
      plan.items.forEach((item, index) => {
        checkTargets(item.targets, input, `items[${index}].`, issues);
      });
    } else {
      if (plan.topic === undefined) issues.push('decision create_video membutuhkan topic');
      if (plan.videoPrompt === undefined) {
        issues.push('decision create_video membutuhkan videoPrompt');
      }
      if (plan.aspectRatio === undefined) {
        issues.push('decision create_video membutuhkan aspectRatio');
      }
      if (plan.targets === undefined) issues.push('decision create_video membutuhkan targets');

      checkTargets(plan.targets ?? [], input, '', issues);
    }
  } else if (plan.decision === 'revise_metadata') {
    if (plan.targets === undefined) {
      issues.push('decision revise_metadata membutuhkan targets');
    } else {
      checkTargets(plan.targets, input, '', issues);
    }
  }

  return issues;
}

/** Approval campaign yang `required` tidak dapat diturunkan oleh model. */
export function enforceApproval(input: PlannerInput, plan: PlanDecision): PlanDecision {
  if (input.campaign.approvalMode !== 'required' || plan.approvalRequired) return plan;
  return { ...plan, approvalRequired: true };
}
