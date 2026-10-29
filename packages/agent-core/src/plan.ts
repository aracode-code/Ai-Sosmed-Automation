import { z } from 'zod';
import { PLATFORM_IDS, type PlatformId } from '@saa/domain';

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

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

/** Bentuk output planner — LLD §9.1. Output model diperlakukan sebagai data tidak tepercaya. */
export const planDecisionSchema = z.object({
  campaignId: z.string().min(1),
  decision: z.enum(PLAN_DECISIONS),
  topic: z.string().min(1).max(300).optional(),
  videoPrompt: z.string().min(1).max(4000).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  targets: z.array(planTargetSchema).min(1).max(PLATFORM_IDS.length).optional(),
  approvalRequired: z.boolean(),
  rationale: z.string().min(1).max(2000)
});
export type PlanDecision = z.infer<typeof planDecisionSchema>;

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

/**
 * Aturan yang tidak dapat dipercayakan ke model: campaign harus cocok, target harus
 * termasuk platform campaign, kapabilitas `unsupported` menolak target, dan caption
 * tidak boleh melebihi batas yang diketahui.
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
    if (plan.topic === undefined) issues.push('decision create_video membutuhkan topic');
    if (plan.videoPrompt === undefined) issues.push('decision create_video membutuhkan videoPrompt');
    if (plan.aspectRatio === undefined) issues.push('decision create_video membutuhkan aspectRatio');
    if (plan.targets === undefined) issues.push('decision create_video membutuhkan targets');
  }

  if (plan.decision === 'revise_metadata' && plan.targets === undefined) {
    issues.push('decision revise_metadata membutuhkan targets');
  }

  const seen = new Set<string>();
  for (const target of plan.targets ?? []) {
    if (seen.has(target.platform)) {
      issues.push(`platform ${target.platform} muncul lebih dari sekali di targets`);
    }
    seen.add(target.platform);

    if (!input.campaign.platforms.includes(target.platform)) {
      issues.push(`platform ${target.platform} bukan target campaign`);
      continue;
    }

    const capability = capabilityFor(input.capabilities, target.platform);
    if (capability?.video === 'unsupported') {
      issues.push(`platform ${target.platform} tidak mendukung video menurut capability`);
    }

    const limit = capability?.captionMaxLength ?? DEFAULT_CAPTION_LIMIT;
    if (target.caption.length > limit) {
      issues.push(
        `caption ${target.platform} melebihi batas ${limit} karakter (${target.caption.length})`
      );
    }
  }

  return issues;
}

/** Approval campaign yang `required` tidak dapat diturunkan oleh model. */
export function enforceApproval(input: PlannerInput, plan: PlanDecision): PlanDecision {
  if (input.campaign.approvalMode !== 'required' || plan.approvalRequired) return plan;
  return { ...plan, approvalRequired: true };
}
