import { describe, expect, it } from 'vitest';
import { createDeepSeekClient, type LlmRequest } from './index';

const request: LlmRequest = {
  messages: [{ role: 'user', content: 'halo' }],
  temperature: 0.1,
  maxTokens: 64,
  jsonMode: true
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (captured: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const impl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const captured = { url: String(url), init: init ?? {} };
    calls.push(captured);
    return handler(captured);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function completion(content: string) {
  return new Response(
    JSON.stringify({
      model: 'deepseek-chat',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 34 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('createDeepSeekClient', () => {
  it('mengirim request JSON-mode dengan bearer token tanpa membocorkannya ke hasil', async () => {
    const { impl, calls } = fakeFetch(() => completion('{"ok":true}'));
    const client = createDeepSeekClient({ apiKey: 'sk-rahasia', fetchImpl: impl });

    const response = await client.complete(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-rahasia');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      stream: false,
      temperature: 0.1,
      max_tokens: 64,
      response_format: { type: 'json_object' }
    });

    expect(response).toMatchObject({
      content: '{"ok":true}',
      model: 'deepseek-chat',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 34 }
    });
    expect(JSON.stringify(response)).not.toContain('sk-rahasia');
  });

  it('memetakan 429 menjadi RATE_LIMIT dengan Retry-After', async () => {
    const { impl } = fakeFetch(
      () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
    );
    const client = createDeepSeekClient({ apiKey: 'sk', fetchImpl: impl });

    const error = await client.complete(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ errorClass: 'RATE_LIMIT', options: { retryAfterMs: 2000 } });
  });

  it('memetakan 401/403 menjadi AUTH dan 5xx menjadi EXTERNAL_5XX', async () => {
    const unauthorized = createDeepSeekClient({
      apiKey: 'sk',
      fetchImpl: fakeFetch(() => new Response('', { status: 401 })).impl
    });
    const failing = createDeepSeekClient({
      apiKey: 'sk',
      fetchImpl: fakeFetch(() => new Response('', { status: 502 })).impl
    });

    await expect(unauthorized.complete(request)).rejects.toMatchObject({ errorClass: 'AUTH' });
    await expect(failing.complete(request)).rejects.toMatchObject({
      errorClass: 'EXTERNAL_5XX'
    });
  });

  it('menolak body yang tidak sesuai skema dan konten kosong', async () => {
    const badBody = createDeepSeekClient({
      apiKey: 'sk',
      fetchImpl: fakeFetch(() => new Response('{"choices":[]}', { status: 200 })).impl
    });
    const empty = createDeepSeekClient({
      apiKey: 'sk',
      fetchImpl: fakeFetch(() => completion('   ')).impl
    });

    await expect(badBody.complete(request)).rejects.toMatchObject({
      errorClass: 'EXTERNAL_5XX'
    });
    await expect(empty.complete(request)).rejects.toMatchObject({
      errorClass: 'EXTERNAL_5XX'
    });
  });

  it('memetakan kegagalan jaringan dan timeout tanpa menyebut API key', async () => {
    const network = createDeepSeekClient({
      apiKey: 'sk-rahasia',
      fetchImpl: fakeFetch(() => Promise.reject(new Error('ECONNRESET'))).impl
    });
    const networkError = await network.complete(request).catch((caught: unknown) => caught);
    expect(networkError).toMatchObject({ errorClass: 'TRANSIENT_NETWORK' });
    expect((networkError as Error).message).not.toContain('sk-rahasia');

    const hanging = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      })) as unknown as typeof fetch;
    const timeout = createDeepSeekClient({ apiKey: 'sk-rahasia', fetchImpl: hanging });

    const timeoutError = await timeout
      .complete({ ...request, timeoutMs: 20 })
      .catch((caught: unknown) => caught);
    expect(timeoutError).toMatchObject({ errorClass: 'TRANSIENT_NETWORK' });
    expect((timeoutError as Error).message).toContain('timeout');
    expect((timeoutError as Error).message).not.toContain('sk-rahasia');
  });

  it('menolak API key kosong saat pembuatan client', () => {
    expect(() => createDeepSeekClient({ apiKey: '  ' })).toThrow(/API key kosong/);
  });
});
