import { existsSync } from 'node:fs';
import {
  listSocialAccounts,
  openDatabase,
  resolveWorkspacePath,
  type DatabaseHandle
} from '@saa/database';
import type { SocialAccount } from '@saa/domain';
import {
  CredentialStoreError,
  DpapiCredentialStore,
  credentialNameFor,
  type YouTubeTokenRecord
} from '@saa/youtube';
import { ConfigError, loadConfig, loadYouTubeCredentials, type AppConfig } from './config';
import {
  collectPreflightChecks,
  preflightExitCode,
  summarizePreflight,
  type DatabaseProbe,
  type PreflightCheck,
  type PreflightStatus,
  type SecretProbe
} from './preflight';

/**
 * CLI kesiapan uji live YouTube (ADR-0008): memeriksa konfigurasi, database,
 * akun, dan blob DPAPI tanpa memanggil Google dan tanpa mencetak rahasia.
 */

class UsageError extends Error {}

interface DatabaseSnapshot {
  database: DatabaseProbe;
  accounts: SocialAccount[];
  videoAssetCount: number;
}

function probeDatabase(config: AppConfig): DatabaseSnapshot {
  const file = resolveWorkspacePath(config.databasePath);
  if (!existsSync(file)) {
    return { database: 'missing', accounts: [], videoAssetCount: 0 };
  }

  let db: DatabaseHandle | null = null;
  try {
    db = openDatabase(file);
    const accounts = listSocialAccounts(db.raw).filter(
      (account) => account.platform === 'youtube'
    );
    const row = db.raw
      .prepare("SELECT COUNT(*) AS count FROM media_assets WHERE mime_type LIKE 'video/%'")
      .get() as { count?: number } | undefined;
    return {
      database: 'ready',
      accounts,
      videoAssetCount: Number(row?.count ?? 0)
    };
  } catch {
    return { database: 'unmigrated', accounts: [], videoAssetCount: 0 };
  } finally {
    db?.close();
  }
}

function makeSecretProbe(store: DpapiCredentialStore): (accountId: string) => Promise<SecretProbe> {
  return async (accountId) => {
    try {
      const record = await store.load<YouTubeTokenRecord>(credentialNameFor(accountId));
      if (record === null) return 'missing';
      const refreshToken = (record as { refreshToken?: unknown }).refreshToken;
      return typeof refreshToken === 'string' && refreshToken !== '' ? 'ok' : 'invalid';
    } catch (error) {
      if (error instanceof CredentialStoreError && error.code === 'NOT_SUPPORTED') {
        return 'unsupported';
      }
      return 'invalid';
    }
  };
}

const LABELS: Record<PreflightStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };

function formatCheck(check: PreflightCheck): string {
  return `[${LABELS[check.status]}] ${check.id.padEnd(16)} ${check.detail}`;
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new UsageError(`argumen tidak dikenal: ${process.argv.slice(2).join(' ')}`);
  }

  const config = loadConfig();
  const snapshot = probeDatabase(config);
  const checks = await collectPreflightChecks({
    config,
    credentials: loadYouTubeCredentials(),
    database: snapshot.database,
    accounts: snapshot.accounts,
    videoAssetCount: snapshot.videoAssetCount,
    platform: process.platform,
    probeSecret: makeSecretProbe(new DpapiCredentialStore())
  });

  console.log('Preflight YouTube — tanpa akses jaringan\n');
  for (const check of checks) console.log(formatCheck(check));

  const summary = summarizePreflight(checks);
  console.log(
    `\nRingkasan: ${summary.pass} lulus · ${summary.warn} peringatan · ${summary.fail} gagal`
  );
  if (summary.fail > 0) {
    console.log('Perbaiki item FAIL sebelum uji live; prosedur lengkap ada di docs/runbook.md.');
  }
  process.exitCode = preflightExitCode(checks);
}

void main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Gagal: ${error.message}`);
    console.error('Pemakaian: preflight:youtube (tanpa argumen)');
    process.exitCode = 2;
    return;
  }
  if (error instanceof ConfigError) {
    console.error(`Gagal: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (error instanceof Error) {
    console.error(`Gagal: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error('Gagal: kesalahan tidak dikenal');
  process.exitCode = 1;
});
