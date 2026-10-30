import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DpapiCredentialStore } from './credential-store';
import {
  buildAuthorizationUrl,
  createPkcePair,
  ensureFreshAccessToken,
  exchangeAuthorizationCode,
  pairYouTubeAccount,
  startLoopbackReceiver,
  YOUTUBE_OAUTH_SCOPES,
  YouTubeAuthError
} from './oauth-client';

const cleanups: (() => Promise<void>)[] = [];

async function tempStore(): Promise<DpapiCredentialStore> {
  const dir = await mkdtemp(join(tmpdir(), 'saa-oauth-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const xor = (input: Buffer): Promise<Buffer> =>
    Promise.resolve(Buffer.from(input.map((byte) => byte ^ 0x5a)));
  return new DpapiCredentialStore({ rootDir: dir, protect: xor, unprotect: xor });
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface FetchCall {
  url: string;
  body: string;
}

function fakeFetch(
  handler: (call: FetchCall, init?: RequestInit) => Response | Promise<Response>
): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = typeof init?.body === 'string' ? init.body : '';
    const call = { url, body };
    calls.push(call);
    return handler(call, init);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const TOKEN_BODY = {
  access_token: 'at-uji',
  refresh_token: 'rt-uji',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: `${YOUTUBE_OAUTH_SCOPES[0]} ${YOUTUBE_OAUTH_SCOPES[1]}`
};

/** Meniru browser pengguna: mengambil redirect URI dari URL otorisasi lalu memanggilnya. */
async function driveBrowser(
  authorizationUrl: string,
  mutate?: (params: URLSearchParams) => void
): Promise<void> {
  const url = new URL(authorizationUrl);
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  if (redirectUri === null || state === null) {
    throw new Error('authorization URL tidak lengkap');
  }
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', 'kode-uji');
  callback.searchParams.set('state', state);
  mutate?.(callback.searchParams);
  const response = await fetch(callback);
  await response.text();
}

describe('PKCE dan authorization URL', () => {
  it('menghasilkan verifier 43 karakter dan challenge S256 yang cocok', () => {
    const pkce = createPkcePair();

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.method).toBe('S256');
    expect(pkce.challenge).toBe(
      createHash('sha256').update(pkce.verifier).digest('base64url')
    );
  });

  it('menyusun URL otorisasi dengan offline consent dan dua scope YouTube', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: 'client-uji.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:12345/oauth2/callback',
        state: 'state-uji',
        codeChallenge: 'challenge-uji'
      })
    );

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-uji.apps.googleusercontent.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-uji');
    expect(url.searchParams.get('state')).toBe('state-uji');
    expect(url.searchParams.get('scope')).toBe(YOUTUBE_OAUTH_SCOPES.join(' '));
    expect(url.searchParams.has('client_secret')).toBe(false);
  });
});

describe('startLoopbackReceiver', () => {
  it('menerima kode pada callback dengan state yang cocok lalu menutup server', async () => {
    const receiver = await startLoopbackReceiver({ state: 'state-benar', timeoutMs: 5_000 });

    const callback = new URL(receiver.redirectUri);
    callback.searchParams.set('code', 'kode-1');
    callback.searchParams.set('state', 'state-benar');
    const response = await fetch(callback);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('berhasil diotorisasi');
    await expect(receiver.waitForCode()).resolves.toBe('kode-1');
    await expect(fetch(receiver.redirectUri)).rejects.toThrow();
  });

  it('menolak state yang salah tanpa memakai kode', async () => {
    const receiver = await startLoopbackReceiver({ state: 'state-benar', timeoutMs: 5_000 });

    const callback = new URL(receiver.redirectUri);
    callback.searchParams.set('code', 'kode-palsu');
    callback.searchParams.set('state', 'state-palsu');
    const response = await fetch(callback);
    await response.text();

    await expect(receiver.waitForCode()).rejects.toMatchObject({
      code: 'state_mismatch',
      errorClass: 'SECURITY_CHALLENGE'
    });
  });

  it('melaporkan authorization_denied dan tidak meneruskan nilai provider ke halaman', async () => {
    const receiver = await startLoopbackReceiver({ state: 'state-benar', timeoutMs: 5_000 });

    const callback = new URL(receiver.redirectUri);
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('state', 'state-benar');
    const response = await fetch(callback);
    const html = await response.text();

    expect(html).not.toContain('access_denied');
    expect(html).toContain('Izin ditolak');
    await expect(receiver.waitForCode()).rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('berakhir timeout dan melepas port', async () => {
    const receiver = await startLoopbackReceiver({ state: 'state-benar', timeoutMs: 40 });

    await expect(receiver.waitForCode()).rejects.toMatchObject({ code: 'timeout' });
    await expect(fetch(receiver.redirectUri)).rejects.toThrow();
  });

  it('close() membatalkan pairing yang belum menerima callback', async () => {
    const receiver = await startLoopbackReceiver({ state: 'state-benar', timeoutMs: 5_000 });

    const pending = receiver.waitForCode();
    await receiver.close();

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('pairYouTubeAccount', () => {
  it('menukar kode dengan PKCE dan menyimpan token ke kredensial youtube-<accountId>', async () => {
    const store = await tempStore();
    const { impl, calls } = fakeFetch(() => jsonResponse(TOKEN_BODY));

    const result = await pairYouTubeAccount({
      accountId: 'acc_1',
      clientId: 'client-uji',
      store,
      openUrl: (url) => driveBrowser(url),
      fetchImpl: impl,
      timeoutMs: 5_000
    });

    expect(result.credentialName).toBe('youtube-acc_1');
    expect(result.token).toMatchObject({
      accessToken: 'at-uji',
      refreshToken: 'rt-uji',
      tokenType: 'Bearer',
      scope: [YOUTUBE_OAUTH_SCOPES[0], YOUTUBE_OAUTH_SCOPES[1]]
    });
    expect(result.token.expiresAt).toBeGreaterThan(Date.now());

    await expect(store.load('youtube-acc_1')).resolves.toMatchObject({ refreshToken: 'rt-uji' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('kode-uji');
    expect(params.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('client_id')).toBe('client-uji');
    expect(params.get('client_secret')).toBeNull();
  });

  it('mengirim client_secret bila dikonfigurasi', async () => {
    const store = await tempStore();
    const { impl, calls } = fakeFetch(() => jsonResponse(TOKEN_BODY));

    await pairYouTubeAccount({
      accountId: 'acc_2',
      clientId: 'client-uji',
      clientSecret: 'rahasia-client',
      store,
      openUrl: (url) => driveBrowser(url),
      fetchImpl: impl,
      timeoutMs: 5_000
    });

    expect(new URLSearchParams(calls[0].body).get('client_secret')).toBe('rahasia-client');
  });

  it('menolak token tanpa refresh token agar tidak ada sesi yang mati diam-diam', async () => {
    const store = await tempStore();
    const { impl } = fakeFetch(() =>
      jsonResponse({ access_token: 'at', expires_in: 3600, token_type: 'Bearer' })
    );

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_3',
        clientId: 'client-uji',
        store,
        openUrl: (url) => driveBrowser(url),
        fetchImpl: impl,
        timeoutMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'missing_refresh_token', errorClass: 'AUTH' });

    await expect(store.load('youtube-acc_3')).resolves.toBeNull();
  });

  it('memetakan invalid_grant menjadi reauth_required', async () => {
    const store = await tempStore();
    const { impl } = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_4',
        clientId: 'client-uji',
        store,
        openUrl: (url) => driveBrowser(url),
        fetchImpl: impl,
        timeoutMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'reauth_required' });
  });

  it('memetakan 5xx ke EXTERNAL_5XX dan 429 ke RATE_LIMIT', async () => {
    const store = await tempStore();
    const failWith = (status: number) =>
      fakeFetch(() => jsonResponse({ error: 'backend_error' }, status)).impl;

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_5',
        clientId: 'client-uji',
        store,
        openUrl: (url) => driveBrowser(url),
        fetchImpl: failWith(503),
        timeoutMs: 5_000
      })
    ).rejects.toMatchObject({ errorClass: 'EXTERNAL_5XX' });

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_5',
        clientId: 'client-uji',
        store,
        openUrl: (url) => driveBrowser(url),
        fetchImpl: failWith(429),
        timeoutMs: 5_000
      })
    ).rejects.toMatchObject({ errorClass: 'RATE_LIMIT' });
  });

  it('menolak respons token yang melebihi batas ukuran', async () => {
    const store = await tempStore();
    const { impl } = fakeFetch(() => new Response('x'.repeat(20_000)));

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_6',
        clientId: 'client-uji',
        store,
        openUrl: (url) => driveBrowser(url),
        fetchImpl: impl,
        timeoutMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('menolak accountId yang tidak aman sebagai nama berkas sebelum menyentuh jaringan', async () => {
    const store = await tempStore();
    const { impl, calls } = fakeFetch(() => jsonResponse(TOKEN_BODY));

    await expect(
      pairYouTubeAccount({
        accountId: '../acc',
        clientId: 'client-uji',
        store,
        openUrl: () => undefined,
        fetchImpl: impl
      })
    ).rejects.toMatchObject({ code: 'INVALID_NAME' });
    expect(calls).toHaveLength(0);
  });

  it('menolak client id kosong', async () => {
    const store = await tempStore();

    await expect(
      pairYouTubeAccount({
        accountId: 'acc_7',
        clientId: '  ',
        store,
        openUrl: () => undefined
      })
    ).rejects.toBeInstanceOf(YouTubeAuthError);
  });
});

describe('exchangeAuthorizationCode', () => {
  it('mengirim form-urlencoded dan menolak permintaan yang tidak valid', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ error: 'invalid_request' }, 400));

    await expect(
      exchangeAuthorizationCode({
        code: 'k',
        codeVerifier: 'v',
        redirectUri: 'http://127.0.0.1:1/oauth2/callback',
        clientId: 'client-uji',
        fetchImpl: impl
      })
    ).rejects.toMatchObject({ code: 'provider_error', errorClass: 'VALIDATION' });

    expect(new URLSearchParams(calls[0].body).get('grant_type')).toBe('authorization_code');
  });
});

describe('ensureFreshAccessToken', () => {
  const fixedNow = (): Date => new Date('2026-10-30T00:00:00.000Z');

  function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      accessToken: 'at-lama',
      refreshToken: 'rt-lama',
      tokenType: 'Bearer',
      scope: [YOUTUBE_OAUTH_SCOPES[0]],
      expiresAt: Date.parse('2026-10-30T01:00:00.000Z'),
      clientId: 'client-uji',
      pairedAt: '2026-10-29T00:00:00.000Z',
      ...overrides
    };
  }

  it('mengembalikan null bila akun belum dipasangkan', async () => {
    const store = await tempStore();
    await expect(
      ensureFreshAccessToken({ accountId: 'acc_1', clientId: 'client-uji', store, now: fixedNow })
    ).resolves.toBeNull();
  });

  it('tidak menyegarkan token yang masih berlaku', async () => {
    const store = await tempStore();
    await store.save('youtube-acc_1', record());
    const { impl, calls } = fakeFetch(() => jsonResponse(TOKEN_BODY));

    const ensured = await ensureFreshAccessToken({
      accountId: 'acc_1',
      clientId: 'client-uji',
      store,
      now: fixedNow,
      fetchImpl: impl
    });

    expect(ensured).toMatchObject({ refreshed: false, record: { accessToken: 'at-lama' } });
    expect(calls).toHaveLength(0);
  });

  it('menyegarkan token yang hampir kedaluwarsa dan menyimpannya kembali', async () => {
    const store = await tempStore();
    await store.save('youtube-acc_1', record({ expiresAt: Date.parse('2026-10-30T00:00:30.000Z') }));
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'at-baru', expires_in: 3600, token_type: 'Bearer' })
    );

    const ensured = await ensureFreshAccessToken({
      accountId: 'acc_1',
      clientId: 'client-uji',
      store,
      now: fixedNow,
      fetchImpl: impl
    });

    expect(ensured).toMatchObject({
      refreshed: true,
      record: { accessToken: 'at-baru', refreshToken: 'rt-lama', pairedAt: '2026-10-29T00:00:00.000Z' }
    });
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('rt-lama');
    await expect(store.load('youtube-acc_1')).resolves.toMatchObject({ accessToken: 'at-baru' });
  });

  it('meminta pairing ulang bila token kedaluwarsa tanpa refresh token', async () => {
    const store = await tempStore();
    await store.save(
      'youtube-acc_1',
      record({ refreshToken: null, expiresAt: Date.parse('2026-10-29T23:00:00.000Z') })
    );
    const { impl, calls } = fakeFetch(() => jsonResponse(TOKEN_BODY));

    await expect(
      ensureFreshAccessToken({
        accountId: 'acc_1',
        clientId: 'client-uji',
        store,
        now: fixedNow,
        fetchImpl: impl
      })
    ).rejects.toMatchObject({ code: 'reauth_required' });
    expect(calls).toHaveLength(0);
  });

  it('memetakan invalid_grant saat refresh menjadi reauth_required', async () => {
    const store = await tempStore();
    await store.save('youtube-acc_1', record({ expiresAt: Date.parse('2026-10-29T23:00:00.000Z') }));
    const { impl } = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(
      ensureFreshAccessToken({
        accountId: 'acc_1',
        clientId: 'client-uji',
        store,
        now: fixedNow,
        fetchImpl: impl
      })
    ).rejects.toMatchObject({ code: 'reauth_required', errorClass: 'AUTH' });
  });
});
