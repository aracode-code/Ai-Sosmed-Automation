import { describe, expect, it } from 'vitest';
import {
  checkPlanAgainstCampaign,
  enforceApproval,
  planDecisionSchema,
  plannerInputSchema,
  type PlanDecision,
  type PlannerInput
} from './index';

const baseInput: PlannerInput = {
  campaign: {
    id: 'cmp_1',
    name: 'Edukasi AI',
    niche: 'edukasi teknologi',
    approvalMode: 'required',
    platforms: ['youtube', 'tiktok']
  },
  capabilities: [
    { platform: 'youtube', video: 'supported', directPost: 'unknown' },
    { platform: 'tiktok', video: 'supported', directPost: 'unknown', captionMaxLength: 100 }
  ],
  availableAssets: [],
  jobContext: {}
};

const validPlan: PlanDecision = {
  campaignId: 'cmp_1',
  decision: 'create_video',
  topic: 'Cara kerja model bahasa',
  videoPrompt: 'Animasi sederhana menjelaskan token dan prediksi kata',
  aspectRatio: '9:16',
  targets: [
    { platform: 'youtube', contentFormat: 'short', caption: 'Kenapa model bisa menebak kata?' },
    { platform: 'tiktok', contentFormat: 'video', caption: 'Model bahasa itu nebak kata' }
  ],
  approvalRequired: false,
  rationale: 'Niche edukasi cocok dengan format video pendek.'
};

describe('skema planner', () => {
  it('menerima PlanDecision sesuai LLD §9.1', () => {
    expect(planDecisionSchema.safeParse(validPlan).success).toBe(true);
  });

  it('menolak aspect ratio dan decision yang tidak dikenal', () => {
    expect(planDecisionSchema.safeParse({ ...validPlan, aspectRatio: '4:3' }).success).toBe(false);
    expect(planDecisionSchema.safeParse({ ...validPlan, decision: 'publish_now' }).success).toBe(
      false
    );
  });

  it('menerapkan default capability menjadi unknown', () => {
    const parsed = plannerInputSchema.parse({
      campaign: baseInput.campaign,
      capabilities: [{ platform: 'x' }]
    });
    expect(parsed.capabilities[0]).toMatchObject({ video: 'unknown', directPost: 'unknown' });
    expect(parsed.jobContext).toEqual({});
  });
});

describe('kebijakan campaign', () => {
  it('lolos untuk rencana yang sesuai campaign dan capability', () => {
    expect(checkPlanAgainstCampaign(validPlan, baseInput)).toEqual([]);
  });

  it('menolak campaignId yang berbeda', () => {
    const issues = checkPlanAgainstCampaign({ ...validPlan, campaignId: 'cmp_lain' }, baseInput);
    expect(issues.some((issue) => issue.includes('campaignId'))).toBe(true);
  });

  it('menolak platform di luar campaign dan duplikat target', () => {
    const issues = checkPlanAgainstCampaign(
      {
        ...validPlan,
        targets: [
          { platform: 'x', contentFormat: 'post', caption: 'halo' },
          { platform: 'youtube', contentFormat: 'short', caption: 'a' },
          { platform: 'youtube', contentFormat: 'short', caption: 'b' }
        ]
      },
      baseInput
    );
    expect(issues.some((issue) => issue.includes('bukan target campaign'))).toBe(true);
    expect(issues.some((issue) => issue.includes('lebih dari sekali'))).toBe(true);
  });

  it('menolak target video pada platform yang capability-nya unsupported', () => {
    const input: PlannerInput = {
      ...baseInput,
      capabilities: [{ platform: 'youtube', video: 'unsupported', directPost: 'unknown' }]
    };
    const issues = checkPlanAgainstCampaign(
      { ...validPlan, targets: [{ platform: 'youtube', contentFormat: 'short', caption: 'ok' }] },
      input
    );
    expect(issues.some((issue) => issue.includes('tidak mendukung video'))).toBe(true);
  });

  it('mengizinkan capability unknown tetapi menegakkan batas caption yang diketahui', () => {
    const unknownInput: PlannerInput = {
      ...baseInput,
      capabilities: [{ platform: 'youtube', video: 'unknown', directPost: 'unknown' }]
    };
    const base = {
      ...validPlan,
      targets: [{ platform: 'youtube' as const, contentFormat: 'short', caption: 'ok' }]
    };
    expect(checkPlanAgainstCampaign(base, unknownInput)).toEqual([]);

    const issues = checkPlanAgainstCampaign(
      { ...base, targets: [{ platform: 'tiktok', contentFormat: 'video', caption: 'x'.repeat(101) }] },
      baseInput
    );
    expect(issues.some((issue) => issue.includes('melebihi batas'))).toBe(true);
  });

  it('mewajibkan field create_video', () => {
    const issues = checkPlanAgainstCampaign(
      {
        campaignId: 'cmp_1',
        decision: 'create_video',
        approvalRequired: true,
        rationale: 'kosong'
      },
      baseInput
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'decision create_video membutuhkan topic',
        'decision create_video membutuhkan videoPrompt',
        'decision create_video membutuhkan aspectRatio',
        'decision create_video membutuhkan targets'
      ])
    );
  });

  it('tidak menurunkan approval saat campaign mewajibkannya', () => {
    expect(enforceApproval(baseInput, validPlan).approvalRequired).toBe(true);

    const automatic: PlannerInput = {
      ...baseInput,
      campaign: { ...baseInput.campaign, approvalMode: 'automatic' }
    };
    expect(enforceApproval(automatic, validPlan).approvalRequired).toBe(false);
  });
});
