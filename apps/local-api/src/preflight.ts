import type { SocialAccount } from '@saa/domain';
import { credentialNameFor } from '@saa/youtube';
import type { AppConfig, YouTubeCredentials } from './config';
import { youtubeSecretRef } from './publisher';

/**
 * Pemeriksaan kesiapan uji live YouTube tanpa akses jaringan (ADR-0008).
 * Nilai rahasia tidak pernah muncul di detail: hanya status ada/tidak dan hasil probe.
 */

export type PreflightStatus = 'pass' | 'warn' | 'fail';
export type DatabaseProbe = 'ready' | 'missing' | 'unmigrated';
export type SecretProbe = 'ok' | 'missing' | 'invalid' | 'unsupported';

export interface PreflightCheck {
  id: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightInput {
  config: AppConfig;
  credentials: YouTubeCredentials | null;
  database: DatabaseProbe;
  accounts: SocialAccount[];
  videoAssetCount: number;
  platform: NodeJS.Platform;
  probeSecret: (accountId: string) => Promise<SecretProbe>;
}

function adapterCheck(config: AppConfig): PreflightCheck {
  if (config.youtubeAdapter === 'api') {
    return { id: 'adapter', status: 'pass', detail: 'YOUTUBE_ADAPTER=api (unggahan nyata)' };
  }
  if (config.youtubeAdapter === 'mock') {
    return {
      id: 'adapter',
      status: 'warn',
      detail: 'YOUTUBE_ADAPTER=mock — publikasi palsu, tidak membuktikan unggahan nyata'
    };
  }
  return {
    id: 'adapter',
    status: 'fail',
    detail: 'YOUTUBE_ADAPTER=off — set ke api untuk uji live'
  };
}

function credentialsChecks(credentials: YouTubeCredentials | null): PreflightCheck[] {
  if (credentials === null) {
    return [
      {
        id: 'oauth_client_id',
        status: 'fail',
        detail: 'GOOGLE_OAUTH_CLIENT_ID belum di-set (hanya dibaca dari environment)'
      }
    ];
  }
  return [
    { id: 'oauth_client_id', status: 'pass', detail: 'GOOGLE_OAUTH_CLIENT_ID tersedia' },
    credentials.clientSecret === null
      ? {
          id: 'oauth_client_secret',
          status: 'warn',
          detail: 'GOOGLE_OAUTH_CLIENT_SECRET tidak di-set (opsional untuk Desktop app)'
        }
      : { id: 'oauth_client_secret', status: 'pass', detail: 'GOOGLE_OAUTH_CLIENT_SECRET tersedia' }
  ];
}

function appStatusCheck(config: AppConfig): PreflightCheck {
  if (config.youtubeAppStatus === 'production') {
    return { id: 'app_status', status: 'pass', detail: 'YOUTUBE_APP_STATUS=production' };
  }
  if (config.youtubeAppStatus === 'testing') {
    return {
      id: 'app_status',
      status: 'fail',
      detail: 'YOUTUBE_APP_STATUS=testing — refresh token kedaluwarsa 7 hari (ADR-0008 O3)'
    };
  }
  return {
    id: 'app_status',
    status: 'warn',
    detail: 'YOUTUBE_APP_STATUS=unknown — set production (berlaku untuk app Internal maupun In production)'
  };
}

function privacyCheck(config: AppConfig): PreflightCheck {
  if (config.youtubeUploadPrivacy === 'private') {
    return { id: 'privacy', status: 'pass', detail: 'YOUTUBE_UPLOAD_PRIVACY=private' };
  }
  return {
    id: 'privacy',
    status: 'warn',
    detail: `YOUTUBE_UPLOAD_PRIVACY=${config.youtubeUploadPrivacy} — uji pertama disarankan private (ADR-0008 D4)`
  };
}

function databaseCheck(config: AppConfig, database: DatabaseProbe): PreflightCheck {
  if (database === 'ready') {
    return { id: 'database', status: 'pass', detail: 'database terbuka dan skema siap' };
  }
  if (database === 'missing') {
    return {
      id: 'database',
      status: 'fail',
      detail: `berkas database tidak ada (${config.databasePath}) — jalankan corepack pnpm migrate`
    };
  }
  return {
    id: 'database',
    status: 'fail',
    detail: 'skema database belum siap — jalankan corepack pnpm migrate'
  };
}

async function accountChecks(input: PreflightInput): Promise<PreflightCheck[]> {
  if (input.accounts.length === 0) {
    return [
      {
        id: 'accounts',
        status: 'warn',
        detail: 'belum ada akun YouTube — jalankan pair:youtube --label "<label>"'
      }
    ];
  }

  const checks: PreflightCheck[] = [
    {
      id: 'accounts',
      status: 'pass',
      detail: `${input.accounts.length} akun YouTube terdaftar`
    }
  ];

  for (const account of input.accounts) {
    const id = `akun:${account.id}`;
    const name = credentialNameFor(account.id);
    const expectedRef = youtubeSecretRef(account.id);
    const probe = await input.probeSecret(account.id);

    if (input.platform !== 'win32' || probe === 'unsupported') {
      checks.push({
        id,
        status: 'fail',
        detail: `akun ${account.label}: DPAPI tidak tersedia pada platform ini`
      });
      continue;
    }
    if (account.connectionStatus === 'reauth_required') {
      checks.push({
        id,
        status: 'fail',
        detail: `akun ${account.label}: reauth_required — jalankan pair:youtube --account ${account.id}`
      });
      continue;
    }
    if (probe === 'missing') {
      checks.push({
        id,
        status: 'fail',
        detail: `akun ${account.label}: blob DPAPI ${name} tidak ada — pairing ulang`
      });
      continue;
    }
    if (probe === 'invalid') {
      checks.push({
        id,
        status: 'fail',
        detail: `akun ${account.label}: blob DPAPI ${name} tidak dapat didekripsi — pairing ulang`
      });
      continue;
    }
    if (account.connectionStatus === 'disconnected') {
      checks.push({
        id,
        status: 'warn',
        detail: `akun ${account.label}: disconnected — jalankan pair:youtube --account ${account.id}`
      });
      continue;
    }
    if (account.secretRef !== expectedRef) {
      checks.push({
        id,
        status: 'fail',
        detail: `akun ${account.label}: secret_ref tidak sesuai (harus ${expectedRef})`
      });
      continue;
    }
    checks.push({
      id,
      status: 'pass',
      detail: `akun ${account.label}: connected, token DPAPI terbaca`
    });
  }

  return checks;
}

export async function collectPreflightChecks(input: PreflightInput): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [
    input.platform === 'win32'
      ? { id: 'platform', status: 'pass', detail: 'Windows — DPAPI tersedia' }
      : {
          id: 'platform',
          status: 'fail',
          detail: `platform ${input.platform} — DPAPI hanya tersedia di Windows`
        },
    adapterCheck(input.config),
    ...credentialsChecks(input.credentials),
    appStatusCheck(input.config),
    privacyCheck(input.config),
    databaseCheck(input.config, input.database)
  ];

  checks.push(...(await accountChecks(input)));

  checks.push(
    input.videoAssetCount > 0
      ? {
          id: 'media',
          status: 'pass',
          detail: `${input.videoAssetCount} aset media video tersedia`
        }
      : {
          id: 'media',
          status: 'warn',
          detail: 'belum ada aset media video — unggahan uji memerlukan satu berkas video'
        }
  );

  return checks;
}

export interface PreflightSummary {
  pass: number;
  warn: number;
  fail: number;
}

export function summarizePreflight(checks: PreflightCheck[]): PreflightSummary {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length
  };
}

export function preflightExitCode(checks: PreflightCheck[]): 0 | 1 {
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}
