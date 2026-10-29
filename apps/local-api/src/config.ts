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
    jobMaxAttempts: env.JOB_MAX_ATTEMPTS
  };
}
