import { describe, expect, it } from 'vitest';
import {
  createPlanner,
  PlannerError,
  PlannerOutputError,
  type LlmClient,
  type LlmRequest,
  type PlannerInput
} from './index';

const input: PlannerInput = {
  campaign: {
    id: 'cmp_1',
    name: 'Edukasi AI',
    niche: 'edukasi teknologi',
    approvalMode: 'required',
    platforms: ['youtube']
  },
  capabilities: [{ platform: 'youtube', video: 'supported', directPost: 'unknown' }],
  availableAssets: [],
  jobContext: {}
};

const validResponse = JSON.stringify({
  campaignId: 'cmp_1',
  decision: 'create_video',
  topic: 'Tokenisasi',
  videoPrompt: 'Animasi memecah kalimat menjadi token',
  aspectRatio: '9:16',
  targets: [{ platform: 'youtube', contentFormat: 'short', caption: 'Apa itu token?' }],
  approvalRequired: false,
  rationale: 'Cocok untuk niche edukasi.'
});

function scriptedLlm(responses: string[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let index = 0;
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const content = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return {
        content,
        model: 'mock-model',
        usage: { promptTokens: 10, completionTokens: 5 }
      };
    }
  };
}

describe('planner', () => {
  it('mengembalikan rencana valid dan menaikkan approvalRequired', async () => {
    const llm = scriptedLlm([validResponse]);
    const planner = createPlanner({ llm });

    const result = await planner.plan(input);

    expect(result.plan.approvalRequired).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.repaired).toBe(false);
    expect(result.model).toBe('mock-model');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.jsonMode).toBe(true);
    expect(llm.calls[0]?.messages[0]?.role).toBe('system');
  });

  it('menerima output batch items dan tetap menegakkan approval campaign', async () => {
    const batch = JSON.stringify({
      campaignId: 'cmp_1',
      decision: 'create_video',
      items: [
        {
          topic: 'Tokenisasi',
          videoPrompt: 'Animasi memecah kalimat menjadi token',
          targets: [{ platform: 'youtube', contentFormat: 'short', caption: 'Apa itu token?' }]
        },
        {
          topic: 'Embedding',
          videoPrompt: 'Animasi vektor makna kata',
          targets: [{ platform: 'youtube', contentFormat: 'short', caption: 'Embedding itu apa?' }]
        }
      ],
      approvalRequired: false,
      rationale: 'Dua video pendek.'
    });
    const llm = scriptedLlm([batch]);

    const result = await createPlanner({ llm }).plan(input);

    expect(result.plan.items).toHaveLength(2);
    expect(result.plan.approvalRequired).toBe(true);
  });

  it('memperbaiki output JSON invalid dalam batas percobaan', async () => {
    const llm = scriptedLlm(['bukan json', validResponse]);
    const planner = createPlanner({ llm });

    const result = await planner.plan(input);

    expect(result.attempts).toBe(2);
    expect(result.repaired).toBe(true);
    expect(llm.calls).toHaveLength(2);
    const repairMessage = llm.calls[1]?.messages.at(-1);
    expect(repairMessage?.role).toBe('user');
    expect(repairMessage?.content).toContain('JSON tidak dapat diparse');
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10 });
  });

  it('memperbaiki pelanggaran kebijakan campaign', async () => {
    const offTarget = JSON.stringify({
      campaignId: 'cmp_1',
      decision: 'create_video',
      topic: 'Tokenisasi',
      videoPrompt: 'Animasi token',
      aspectRatio: '9:16',
      targets: [{ platform: 'tiktok', contentFormat: 'video', caption: 'Halo' }],
      approvalRequired: true,
      rationale: 'Salah platform.'
    });
    const llm = scriptedLlm([offTarget, validResponse]);
    const planner = createPlanner({ llm });

    const result = await planner.plan(input);

    expect(result.repaired).toBe(true);
    expect(llm.calls[1]?.messages.at(-1)?.content).toContain('bukan target campaign');
  });

  it('melempar PlannerOutputError setelah batas perbaikan habis', async () => {
    const llm = scriptedLlm(['{"campaignId":"cmp_1"}']);
    const planner = createPlanner({ llm, maxRepairAttempts: 1 });

    const error = await planner.plan(input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlannerOutputError);
    expect(error).toMatchObject({ errorClass: 'AI_OUTPUT_INVALID' });
    expect(llm.calls).toHaveLength(2);
  });

  it('tidak memanggil model bila input tidak valid', async () => {
    const llm = scriptedLlm([validResponse]);
    const planner = createPlanner({ llm });

    await expect(planner.plan({ campaign: { id: '' } })).rejects.toBeInstanceOf(PlannerError);
    expect(llm.calls).toHaveLength(0);
  });

  it('menerima output yang dibungkus code fence', async () => {
    const llm = scriptedLlm(['```json\n' + validResponse + '\n```']);
    const planner = createPlanner({ llm });

    const result = await planner.plan(input);
    expect(result.plan.campaignId).toBe('cmp_1');
  });
});
