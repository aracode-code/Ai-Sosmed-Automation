import type { Planner } from '@saa/agent-core';
import { AppError } from '@saa/domain';
import type { AiCredentialManager } from './ai-credentials';

export interface LazyPlannerOptions {
  credentials: Pick<AiCredentialManager, 'resolve'>;
  create: (apiKey: string) => Planner;
}

/**
 * Planner yang membaca kunci saat job berjalan, bukan saat API start, supaya
 * kunci yang baru diisi di UI langsung berlaku. Planner di-cache per nilai kunci.
 */
export function createLazyPlanner(options: LazyPlannerOptions): Planner {
  let cached: { apiKey: string; planner: Planner } | null = null;

  return {
    async plan(input) {
      const credential = await options.credentials.resolve();
      if (credential === null) {
        throw new AppError(
          'AUTH',
          'kunci DeepSeek belum dikonfigurasi; isi lewat Connections sebelum menjalankan PLAN_CONTENT'
        );
      }

      if (cached === null || cached.apiKey !== credential.apiKey) {
        cached = { apiKey: credential.apiKey, planner: options.create(credential.apiKey) };
      }
      return cached.planner.plan(input);
    }
  };
}
