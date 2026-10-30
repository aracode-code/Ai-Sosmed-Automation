import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppError, type AppErrorOptions, type ErrorClass } from '@saa/domain';
import { CredentialStoreError, type CredentialStore } from './credential-store';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** `youtube.upload` untuk unggah, `youtube.readonly` untuk verifikasi `videos.list` (ADR-0008 D1). */
export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
] as const;

const CALLBACK_PATH = '/oauth2/callback';
const LOOPBACK_HOST = '127.0.0.1';
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const MAX_TOKEN_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_MARGIN_MS = 60_000;

export type YouTubeAuthErrorCode =
  | 'reauth_required'
  | 'authorization_denied'
  | 'state_mismatch'
  | 'timeout'
  | 'cancelled'
  | 'provider_error'
  | 'invalid_response'
  | 'missing_refresh_token'
  | 'invalid_client_config';

const DEFAULT_ERROR_CLASS: Record<YouTubeAuthErrorCode, ErrorClass> = {
  reauth_required: 'AUTH',
  authorization_denied: 'AUTH',
  state_mismatch: 'SECURITY_CHALLENGE',
  timeout: 'TRANSIENT_NETWORK',
  cancelled: 'CANCELLED',
  provider_error: 'EXTERNAL_5XX',
  invalid_response: 'EXTERNAL_5XX',
  missing_refresh_token: 'AUTH',
  invalid_client_config: 'AUTH'
};

/**
 * Kegagalan OAuth yang dapat dipetakan ke kelas error dispatcher. `reauth_required`
 * berarti refresh token tidak lagi berlaku — satu-satunya jalan keluar adalah pairing ulang.
 */
export class YouTubeAuthError extends AppError {
  constructor(
    readonly code: YouTubeAuthErrorCode,
    message: string,
    options: AppErrorOptions & { errorClass?: ErrorClass } = {}
  ) {
    const { errorClass, ...rest } = options;
    super(errorClass ?? DEFAULT_ERROR_CLASS[code], message, rest);
    this.name = 'YouTubeAuthError';
  }
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/** Nama berkas kredensial DPAPI untuk satu akun; `accountId` wajib aman sebagai nama berkas. */
export function credentialNameFor(accountId: string): string {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new CredentialStoreError(
      'INVALID_NAME',
      `accountId tidak valid untuk nama kredensial: ${accountId}`
    );
  }
  return `youtube-${accountId}`;
}

export interface AuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  endpoint?: string;
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.endpoint ?? GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (input.scopes ?? YOUTUBE_OAUTH_SCOPES).join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface LoopbackReceiverOptions {
  state: string;
  port?: number;
  timeoutMs?: number;
}

export interface LoopbackReceiver {
  redirectUri: string;
  waitForCode(): Promise<string>;
  close(): Promise<void>;
}

const CALLBACK_PAGE = {
  ok: 'Akun berhasil diotorisasi. Tab ini boleh ditutup.',
  denied: 'Izin ditolak. Kembali ke aplikasi untuk mengulangi pairing.',
  invalid: 'Permintaan callback tidak valid.',
  notFound: 'Halaman tidak ditemukan.',
  already: 'Callback sudah diproses.'
} as const;

function respond(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'",
    connection: 'close'
  });
  res.end(
    `<!doctype html><html lang="id"><meta charset="utf-8"><title>Pairing YouTube</title>` +
      `<body><p>${message}</p></body></html>`
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sanitizeProviderError(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  return clean === '' ? 'unknown' : clean;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    const force = setTimeout(() => server.closeAllConnections(), 500);
    force.unref();
  });
}

/**
 * Menerima satu callback OAuth pada loopback `127.0.0.1`. `state` dibandingkan
 * konstan-waktu; receiver menutup dirinya setelah callback pertama, galat, atau timeout.
 */
export async function startLoopbackReceiver(
  options: LoopbackReceiverOptions
): Promise<LoopbackReceiver> {
  const server = createServer();
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | null = null;
  let outcome: { code: string } | { error: Error } | null = null;
  let timer: NodeJS.Timeout | undefined;

  const finish = async (error: Error | null, code?: string): Promise<void> => {
    if (outcome !== null) return;
    outcome = error === null ? { code: code ?? '' } : { error };
    if (timer !== undefined) clearTimeout(timer);
    await closeServer(server);
    const pending = settle;
    settle = null;
    if (pending === null) return;
    if ('error' in outcome) pending.reject(outcome.error);
    else pending.resolve(outcome.code);
  };

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
      respond(res, 404, CALLBACK_PAGE.notFound);
      return;
    }
    if (outcome !== null) {
      respond(res, 409, CALLBACK_PAGE.already);
      return;
    }

    const providerError = requestUrl.searchParams.get('error');
    if (providerError !== null) {
      respond(res, 200, CALLBACK_PAGE.denied);
      void finish(
        new YouTubeAuthError(
          'authorization_denied',
          `otorisasi ditolak (${sanitizeProviderError(providerError)})`
        )
      );
      return;
    }

    const receivedState = requestUrl.searchParams.get('state') ?? '';
    if (!safeEqual(receivedState, options.state)) {
      respond(res, 400, CALLBACK_PAGE.invalid);
      void finish(new YouTubeAuthError('state_mismatch', 'parameter state tidak cocok'));
      return;
    }

    const code = requestUrl.searchParams.get('code') ?? '';
    if (code.trim() === '') {
      respond(res, 400, CALLBACK_PAGE.invalid);
      void finish(new YouTubeAuthError('invalid_response', 'callback tanpa authorization code'));
      return;
    }

    respond(res, 200, CALLBACK_PAGE.ok);
    void finish(null, code);
  };

  server.on('request', handleRequest);

  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: Error): void => reject(error);
    server.once('error', onListenError);
    server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
      server.off('error', onListenError);
      resolve();
    });
  }).catch((error: unknown) => {
    throw new YouTubeAuthError(
      'provider_error',
      `server loopback gagal mendengarkan di ${LOOPBACK_HOST}:${options.port ?? 0}`,
      { errorClass: 'TRANSIENT_NETWORK', cause: error }
    );
  });

  server.on('error', () => {
    void finish(
      new YouTubeAuthError('provider_error', 'server loopback gagal setelah aktif', {
        errorClass: 'TRANSIENT_NETWORK'
      })
    );
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new YouTubeAuthError('provider_error', 'alamat server loopback tidak tersedia');
  }

  const redirectUri = `http://${LOOPBACK_HOST}:${(address as AddressInfo).port}${CALLBACK_PATH}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  timer = setTimeout(() => {
    void finish(
      new YouTubeAuthError('timeout', `authorisasi tidak selesai dalam ${timeoutMs} ms`)
    );
  }, timeoutMs);
  timer.unref();

  return {
    redirectUri,
    waitForCode(): Promise<string> {
      if (outcome !== null) {
        return 'error' in outcome ? Promise.reject(outcome.error) : Promise.resolve(outcome.code);
      }
      return new Promise<string>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    async close(): Promise<void> {
      if (outcome === null) {
        await finish(new YouTubeAuthError('cancelled', 'pairing dibatalkan sebelum kode diterima'));
      }
    }
  };
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string[];
  expiresInSeconds: number;
}

interface TokenRequestOptions {
  fetchImpl: typeof fetch;
  endpoint: string;
  timeoutMs: number;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

async function postTokenRequest(
  params: URLSearchParams,
  options: TokenRequestOptions
): Promise<OAuthTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref();

  let response: Response;
  try {
    response = await options.fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: params.toString(),
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new YouTubeAuthError(
        'timeout',
        `token endpoint tidak merespons dalam ${options.timeoutMs} ms`,
        { cause: error }
      );
    }
    throw new YouTubeAuthError('provider_error', 'gagal menghubungi token endpoint Google', {
      errorClass: 'TRANSIENT_NETWORK',
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TOKEN_RESPONSE_BYTES) {
    throw new YouTubeAuthError('invalid_response', 'respons token melebihi batas ukuran');
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new YouTubeAuthError('provider_error', 'gagal membaca respons token', {
      errorClass: 'TRANSIENT_NETWORK',
      cause: error
    });
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_TOKEN_RESPONSE_BYTES) {
    throw new YouTubeAuthError('invalid_response', 'respons token melebihi batas ukuran');
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const fields =
      parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const providerCode = stringField(fields, 'error');
    if (providerCode === 'invalid_grant') {
      throw new YouTubeAuthError(
        'reauth_required',
        'otorisasi Google dicabut atau kedaluwarsa; pairing ulang diperlukan'
      );
    }
    if (providerCode === 'invalid_client' || providerCode === 'unauthorized_client') {
      throw new YouTubeAuthError(
        'provider_error',
        `OAuth client ditolak Google (${providerCode})`,
        { errorClass: 'AUTH' }
      );
    }
    if (response.status === 429) {
      throw new YouTubeAuthError('provider_error', 'token endpoint membatasi laju request', {
        errorClass: 'RATE_LIMIT'
      });
    }
    if (response.status >= 500) {
      throw new YouTubeAuthError(
        'provider_error',
        `token endpoint gagal (HTTP ${response.status})`,
        { errorClass: 'EXTERNAL_5XX' }
      );
    }
    throw new YouTubeAuthError(
      'provider_error',
      `permintaan token ditolak (HTTP ${response.status})`,
      { errorClass: 'VALIDATION' }
    );
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new YouTubeAuthError('invalid_response', 'respons token bukan JSON objek');
  }
  const body = parsed as Record<string, unknown>;
  const accessToken = stringField(body, 'access_token');
  const expiresIn = body.expires_in;
  if (
    accessToken === null ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new YouTubeAuthError('invalid_response', 'respons token tidak memuat access_token/expires_in');
  }

  const scopeText = stringField(body, 'scope');
  return {
    accessToken,
    refreshToken: stringField(body, 'refresh_token'),
    tokenType: stringField(body, 'token_type') ?? 'Bearer',
    scope: scopeText === null ? [] : scopeText.split(' ').filter((item) => item !== ''),
    expiresInSeconds: expiresIn
  };
}

export interface ExchangeAuthorizationCodeOptions {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string | null;
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  timeoutMs?: number;
}

export async function exchangeAuthorizationCode(
  options: ExchangeAuthorizationCodeOptions
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
    client_id: options.clientId
  });
  if (options.clientSecret !== undefined && options.clientSecret !== null) {
    params.set('client_secret', options.clientSecret);
  }
  return postTokenRequest(params, {
    fetchImpl: options.fetchImpl ?? fetch,
    endpoint: options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT,
    timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  });
}

export interface RefreshAccessTokenOptions {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  timeoutMs?: number;
}

export async function refreshAccessToken(
  options: RefreshAccessTokenOptions
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
    client_id: options.clientId
  });
  if (options.clientSecret !== undefined && options.clientSecret !== null) {
    params.set('client_secret', options.clientSecret);
  }
  return postTokenRequest(params, {
    fetchImpl: options.fetchImpl ?? fetch,
    endpoint: options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT,
    timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  });
}

export interface YouTubeTokenRecord {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string[];
  /** Epoch milidetik; token dianggap kedaluwarsa 60 detik sebelum waktu ini. */
  expiresAt: number;
  clientId: string;
  pairedAt: string;
}

interface TokenRecordInput {
  clientId: string;
  now: () => Date;
  previous?: YouTubeTokenRecord;
}

function toTokenRecord(payload: OAuthTokenResponse, input: TokenRecordInput): YouTubeTokenRecord {
  const now = input.now();
  const refreshToken = payload.refreshToken ?? input.previous?.refreshToken ?? null;
  if (refreshToken === null) {
    throw new YouTubeAuthError(
      'missing_refresh_token',
      'Google tidak menerbitkan refresh token; pairing ulang dengan prompt=consent diperlukan'
    );
  }
  return {
    accessToken: payload.accessToken,
    refreshToken,
    tokenType: payload.tokenType,
    scope: payload.scope.length > 0 ? payload.scope : (input.previous?.scope ?? []),
    expiresAt: now.getTime() + payload.expiresInSeconds * 1000,
    clientId: input.clientId,
    pairedAt: input.previous?.pairedAt ?? now.toISOString()
  };
}

function assertClientId(clientId: string): void {
  if (clientId.trim() === '') {
    throw new YouTubeAuthError('invalid_client_config', 'GOOGLE_OAUTH_CLIENT_ID kosong');
  }
}

export interface PairYouTubeAccountOptions {
  accountId: string;
  clientId: string;
  clientSecret?: string | null;
  store: CredentialStore;
  /** Membuka browser pengguna. Wajib disuntikkan agar modul tidak memanggil shell sendiri. */
  openUrl: (url: string) => void | Promise<void>;
  scopes?: readonly string[];
  port?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  now?: () => Date;
}

export interface PairYouTubeAccountResult {
  credentialName: string;
  token: YouTubeTokenRecord;
}

/**
 * Pairing satu kali: browser → loopback → tukar kode → simpan token DPAPI.
 * Tidak mencetak atau mengembalikan nilai rahasia ke log; token hanya hidup di memori
 * dan di blob DPAPI.
 */
export async function pairYouTubeAccount(
  options: PairYouTubeAccountOptions
): Promise<PairYouTubeAccountResult> {
  assertClientId(options.clientId);
  const credentialName = credentialNameFor(options.accountId);
  const state = createOAuthState();
  const pkce = createPkcePair();
  const receiver = await startLoopbackReceiver({
    state,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });

  let code: string;
  try {
    const authorizationUrl = buildAuthorizationUrl({
      clientId: options.clientId,
      redirectUri: receiver.redirectUri,
      state,
      codeChallenge: pkce.challenge,
      ...(options.scopes === undefined ? {} : { scopes: options.scopes }),
      ...(options.authorizationEndpoint === undefined
        ? {}
        : { endpoint: options.authorizationEndpoint })
    });
    await options.openUrl(authorizationUrl);
    code = await receiver.waitForCode();
  } catch (error) {
    await receiver.close();
    throw error;
  }

  const payload = await exchangeAuthorizationCode({
    code,
    codeVerifier: pkce.verifier,
    redirectUri: receiver.redirectUri,
    clientId: options.clientId,
    ...(options.clientSecret === undefined ? {} : { clientSecret: options.clientSecret }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.requestTimeoutMs === undefined ? {} : { timeoutMs: options.requestTimeoutMs }),
    ...(options.tokenEndpoint === undefined ? {} : { tokenEndpoint: options.tokenEndpoint })
  });

  const now = options.now ?? (() => new Date());
  const token = toTokenRecord(payload, { clientId: options.clientId, now });
  await options.store.save(credentialName, token);
  return { credentialName, token };
}

export interface EnsureFreshAccessTokenOptions {
  accountId: string;
  clientId: string;
  clientSecret?: string | null;
  store: CredentialStore;
  refreshMarginMs?: number;
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export interface EnsuredAccessToken {
  record: YouTubeTokenRecord;
  refreshed: boolean;
}

/**
 * Memuat token akun dan memperbaruinya bila sisa usia < margin (default 60 s).
 * Mengembalikan `null` bila akun belum dipasangkan; melempar `reauth_required`
 * bila refresh token tidak ada atau sudah dicabut.
 */
export async function ensureFreshAccessToken(
  options: EnsureFreshAccessTokenOptions
): Promise<EnsuredAccessToken | null> {
  assertClientId(options.clientId);
  const credentialName = credentialNameFor(options.accountId);
  const stored = await options.store.load<YouTubeTokenRecord>(credentialName);
  if (stored === null) return null;

  const now = options.now ?? (() => new Date());
  const margin = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  if (stored.accessToken !== '' && stored.expiresAt - margin > now().getTime()) {
    return { record: stored, refreshed: false };
  }

  if (stored.refreshToken === null || stored.refreshToken === '') {
    throw new YouTubeAuthError(
      'reauth_required',
      `akses ${credentialName} kedaluwarsa dan tidak ada refresh token; pairing ulang diperlukan`
    );
  }

  const payload = await refreshAccessToken({
    refreshToken: stored.refreshToken,
    clientId: options.clientId,
    ...(options.clientSecret === undefined ? {} : { clientSecret: options.clientSecret }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.tokenEndpoint === undefined ? {} : { tokenEndpoint: options.tokenEndpoint }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });

  const record = toTokenRecord(payload, {
    clientId: options.clientId,
    previous: stored,
    now
  });
  await options.store.save(credentialName, record);
  return { record, refreshed: true };
}
