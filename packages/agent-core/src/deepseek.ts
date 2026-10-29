import { appError, AppError } from '@saa/domain';
import { z } from 'zod';
import type { LlmClient, LlmRequest, LlmResponse } from './llm';

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional()
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative()
    })
    .optional()
});

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function retryAfterMsOf(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

function statusError(status: number, retryAfterMs?: number): AppError {
  if (status === 401 || status === 403) {
    return appError('AUTH', `DeepSeek menolak kredensial (HTTP ${status})`);
  }
  if (status === 429) {
    return appError('RATE_LIMIT', 'DeepSeek membatasi laju request (HTTP 429)', { retryAfterMs });
  }
  if (status === 408 || status === 504) {
    return appError('TRANSIENT_NETWORK', `DeepSeek timeout (HTTP ${status})`, { retryAfterMs });
  }
  if (status >= 500) {
    return appError('EXTERNAL_5XX', `DeepSeek gagal memproses request (HTTP ${status})`, {
      retryAfterMs
    });
  }
  if (status >= 400) {
    return appError('VALIDATION', `Request ke DeepSeek tidak valid (HTTP ${status})`);
  }
  return appError('UNKNOWN', `Respons DeepSeek tidak dikenali (HTTP ${status})`);
}

/**
 * Adapter DeepSeek berbasis `fetch`. API key hanya hidup di closure; tidak pernah
 * dimasukkan ke pesan error, log, atau payload yang dikembalikan.
 */
export function createDeepSeekClient(options: DeepSeekClientOptions): LlmClient {
  const baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = options.model ?? 'deepseek-chat';
  const defaultTimeoutMs = options.timeoutMs ?? 60_000;
  const doFetch = options.fetchImpl ?? fetch;

  if (options.apiKey.trim() === '') {
    throw appError('AUTH', 'DeepSeek API key kosong');
  }

  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const body: Record<string, unknown> = {
        model,
        messages: request.messages,
        stream: false
      };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.jsonMode === true) body.response_format = { type: 'json_object' };

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw appError('TRANSIENT_NETWORK', `DeepSeek timeout setelah ${timeoutMs}ms`, {
            cause: error
          });
        }
        throw appError('TRANSIENT_NETWORK', 'Gagal menghubungi DeepSeek', { cause: error });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const retryAfterMs = retryAfterMsOf(response.headers.get('retry-after'));
        throw statusError(response.status, retryAfterMs);
      }

      const raw: unknown = await response.json().catch(() => null);
      const parsed = chatCompletionSchema.safeParse(raw);
      if (!parsed.success) {
        throw appError('EXTERNAL_5XX', 'Respons DeepSeek tidak sesuai skema');
      }

      const choice = parsed.data.choices[0];
      const content = choice?.message.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw appError('EXTERNAL_5XX', 'DeepSeek mengembalikan konten kosong');
      }

      return {
        content,
        model: parsed.data.model ?? model,
        ...(parsed.data.usage === undefined
          ? {}
          : {
              usage: {
                promptTokens: parsed.data.usage.prompt_tokens,
                completionTokens: parsed.data.usage.completion_tokens
              }
            }),
        ...(choice?.finish_reason == null ? {} : { finishReason: choice.finish_reason })
      };
    }
  };
}
