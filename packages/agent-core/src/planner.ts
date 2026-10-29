import { AppError } from '@saa/domain';
import { ZodError } from 'zod';
import type { LlmClient, LlmUsage } from './llm';
import {
  checkPlanAgainstCampaign,
  enforceApproval,
  planDecisionSchema,
  plannerInputSchema,
  type PlanDecision,
  type PlannerInput
} from './plan';
import { buildPlannerMessages, buildRepairPrompt } from './prompts';

export class PlannerError extends AppError {
  constructor(
    message: string,
    readonly details: string[] = [],
    options: { cause?: unknown } = {}
  ) {
    super('VALIDATION', message, options);
    this.name = 'PlannerError';
  }
}

/**
 * Output model tidak lolos skema/kebijakan setelah batas perbaikan. Kelas ini
 * dipetakan retry policy ke `escalate` (NEEDS_ATTENTION), sesuai LLD §9.3 —
 * bukan FAILED seperti VALIDATION biasa.
 */
export class PlannerOutputError extends AppError {
  constructor(
    message: string,
    readonly details: string[] = [],
    options: { cause?: unknown } = {}
  ) {
    super('AI_OUTPUT_INVALID', message, options);
    this.name = 'PlannerOutputError';
  }
}

export interface PlannerOptions {
  llm: LlmClient;
  /** Percobaan perbaikan setelah output pertama (default 1, LLD §9.3). */
  maxRepairAttempts?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface PlannerResult {
  plan: PlanDecision;
  attempts: number;
  repaired: boolean;
  model: string;
  usage?: LlmUsage;
}

export interface Planner {
  plan(input: unknown): Promise<PlannerResult>;
}

function issuesOf(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function addUsage(total: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
  if (next === undefined) return total;
  if (total === undefined) return { ...next };
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens
  };
}

/**
 * Planner dengan loop perbaikan terbatas. Output model divalidasi skema lalu
 * kebijakan campaign; kegagalan setelah batas perbaikan menjadi `PlannerOutputError`
 * (kelas AI_OUTPUT_INVALID) yang oleh retry policy dipetakan ke NEEDS_ATTENTION (LLD §9.3).
 */
export function createPlanner(options: PlannerOptions): Planner {
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;

  return {
    async plan(rawInput: unknown): Promise<PlannerResult> {
      const parsedInput = plannerInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        throw new PlannerError('Input planner tidak valid', issuesOf(parsedInput.error));
      }

      const input: PlannerInput = parsedInput.data;
      const messages = buildPlannerMessages(input);
      const maxAttempts = 1 + maxRepairAttempts;
      let usage: LlmUsage | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await options.llm.complete({
          messages,
          temperature: options.temperature ?? 0.2,
          maxTokens: options.maxTokens ?? 1200,
          timeoutMs: options.timeoutMs,
          jsonMode: true
        });
        usage = addUsage(usage, response.usage);

        const issues: string[] = [];
        let plan: PlanDecision | null = null;

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(stripCodeFence(response.content));
        } catch (error) {
          issues.push(`JSON tidak dapat diparse: ${(error as Error).message}`);
        }

        if (issues.length === 0) {
          const parsedPlan = planDecisionSchema.safeParse(parsedJson);
          if (parsedPlan.success) {
            plan = parsedPlan.data;
            issues.push(...checkPlanAgainstCampaign(plan, input));
          } else {
            issues.push(...issuesOf(parsedPlan.error));
          }
        }

        if (plan !== null && issues.length === 0) {
          return {
            plan: enforceApproval(input, plan),
            attempts: attempt,
            repaired: attempt > 1,
            model: response.model,
            ...(usage === undefined ? {} : { usage })
          };
        }

        if (attempt === maxAttempts) {
          throw new PlannerOutputError(
            plan === null
              ? `Output planner bukan PlanDecision valid setelah ${attempt} percobaan`
              : `Rencana melanggar kebijakan campaign setelah ${attempt} percobaan`,
            issues
          );
        }

        messages.push(
          { role: 'assistant', content: response.content },
          { role: 'user', content: buildRepairPrompt(issues) }
        );
      }

      throw new PlannerOutputError('Planner tidak menghasilkan keputusan');
    }
  };
}
