import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_HOST: z.string().min(1).default('127.0.0.1'),
    APP_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
    APP_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),
    DATABASE_PATH: z.string().min(1).default('./data/database/app.sqlite'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
    WORKER_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
    MEDIA_ROOT: z.string().min(1).default('./data/media'),
    /** Dispatch jadwal → job PUBLISH; hanya berjalan bila adapter publikasi aktif. */
    SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
    /** `mock` hanya untuk uji alur; `api` memakai adapter YouTube Data API v3 (ADR-0008). */
    YOUTUBE_ADAPTER: z.enum(['off', 'mock', 'api']).default('off'),
    /** Privasi default unggahan; hasil diverifikasi lewat `videos.list` (ADR-0008 D4). */
    YOUTUBE_UPLOAD_PRIVACY: z.enum(['private', 'unlisted', 'public']).default('private'),
    /**
     * Status publikasi OAuth app (Google Cloud Console). Tidak dapat dibaca lewat API;
     * dilaporkan owner agar status Testing (refresh token 7 hari) terlihat saat boot.
     */
    YOUTUBE_APP_STATUS: z.enum(['testing', 'production', 'unknown']).default('unknown'),
    APP_ALLOW_NETWORK: z.enum(['true', 'false']).default('false')
  })
  .superRefine((env, ctx) => {
    if (!LOOPBACK_HOSTS.has(env.APP_HOST) && env.APP_ALLOW_NETWORK !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_HOST'],
        message: `host non-loopback (${env.APP_HOST}) ditolak; set APP_ALLOW_NETWORK=true secara eksplisit`
      });
    }
  });

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  timezone: string;
  databasePath: string;
  logLevel: string;
  jobMaxAttempts: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
  mediaRoot: string;
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  youtubeAdapter: 'off' | 'mock' | 'api';
  youtubeUploadPrivacy: 'private' | 'unlisted' | 'public';
  youtubeAppStatus: 'testing' | 'production' | 'unknown';
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`konfigurasi tidak valid: ${issues.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    );
  }

  const env = parsed.data;
  return {
    env: env.APP_ENV,
    host: env.APP_HOST,
    port: env.APP_PORT,
    timezone: env.APP_TIMEZONE,
    databasePath: env.DATABASE_PATH,
    logLevel: env.LOG_LEVEL,
    jobMaxAttempts: env.JOB_MAX_ATTEMPTS,
    workerEnabled: env.WORKER_ENABLED === 'true',
    workerIntervalMs: env.WORKER_INTERVAL_MS,
    mediaRoot: env.MEDIA_ROOT,
    schedulerEnabled: env.SCHEDULER_ENABLED === 'true',
    schedulerIntervalMs: env.SCHEDULER_INTERVAL_MS,
    youtubeAdapter: env.YOUTUBE_ADAPTER,
    youtubeUploadPrivacy: env.YOUTUBE_UPLOAD_PRIVACY,
    youtubeAppStatus: env.YOUTUBE_APP_STATUS
  };
}

export interface AiCredentials {
  apiKey: string;
}

/**
 * Kredensial AI hanya dari environment. Nilai tidak pernah masuk `AppConfig`,
 * log, atau state — sengaja dipisah agar objek konfigurasi aman dicatat.
 */
export function loadAiCredentials(
  source: NodeJS.ProcessEnv = process.env
): AiCredentials | null {
  const apiKey = source.DEEPSEEK_API_KEY?.trim();
  return apiKey === undefined || apiKey === '' ? null : { apiKey };
}

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string | null;
}

/**
 * Kredensial OAuth YouTube hanya dari environment dan tidak masuk `AppConfig`.
 * Refresh token tidak dibaca dari sini — disimpan di credential store DPAPI.
 */
export function loadYouTubeCredentials(
  source: NodeJS.ProcessEnv = process.env
): YouTubeCredentials | null {
  const clientId = source.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (clientId === undefined || clientId === '') return null;

  const clientSecret = source.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return {
    clientId,
    clientSecret: clientSecret === undefined || clientSecret === '' ? null : clientSecret
  };
}
