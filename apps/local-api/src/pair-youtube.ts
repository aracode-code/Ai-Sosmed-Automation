import { spawn } from 'node:child_process';
import {
  getSocialAccount,
  insertSocialAccount,
  listSocialAccounts,
  openDatabase,
  resolveWorkspacePath,
  runMigrations,
  updateAccountConnection,
  type DatabaseHandle
} from '@saa/database';
import type { SocialAccount } from '@saa/domain';
import { DpapiCredentialStore, pairYouTubeAccount } from '@saa/youtube';
import { loadConfig, loadYouTubeCredentials } from './config';
import { youtubeSecretRef } from './publisher';

/**
 * Onboarding akun YouTube (ADR-0008 A4): pairing satu kali lewat loopback + PKCE,
 * token disimpan DPAPI, lalu `social_accounts` ditandai `connected` dengan `secret_ref`.
 * Tidak pernah mencetak access/refresh token.
 */

interface PairArgs {
  accountId?: string;
  label?: string;
  port?: number;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): PairArgs {
  const args: PairArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--account' || flag === '--label' || flag === '--port') {
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${flag} membutuhkan nilai`);
      }
      index += 1;
      if (flag === '--account') args.accountId = value.trim();
      else if (flag === '--label') args.label = value.trim();
      else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new UsageError(`--port ${value} bukan port valid`);
        }
        args.port = port;
      }
      continue;
    }
    throw new UsageError(`argumen tidak dikenal: ${flag}`);
  }
  if (args.accountId === '') throw new UsageError('--account tidak boleh kosong');
  if (args.label === '') throw new UsageError('--label tidak boleh kosong');
  return args;
}

function youtubeAccounts(db: DatabaseHandle): SocialAccount[] {
  return listSocialAccounts(db.raw).filter((account) => account.platform === 'youtube');
}

function resolveAccount(db: DatabaseHandle, args: PairArgs): SocialAccount {
  if (args.accountId !== undefined) {
    const account = getSocialAccount(db.raw, args.accountId);
    if (account === null) throw new UsageError(`akun ${args.accountId} tidak ditemukan`);
    if (account.platform !== 'youtube') {
      throw new UsageError(`akun ${account.id} bukan platform youtube (${account.platform})`);
    }
    return account;
  }
  if (args.label !== undefined) {
    const existing = youtubeAccounts(db).find((account) => account.label === args.label);
    if (existing !== undefined) return existing;
    return insertSocialAccount(db.raw, { platform: 'youtube', label: args.label });
  }
  throw new UsageError('sebutkan --account <id> atau --label "<label>"');
}

function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('pembukaan browser otomatis hanya didukung di Windows; buka URL manual'));
      return;
    }
    // rundll32 dipakai agar URL tidak melewati parsing shell (karakter `&` pada query).
    const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = openDatabase(resolveWorkspacePath(config.databasePath));
  runMigrations(db.raw);

  try {
    const account = resolveAccount(db, args);

    const credentials = loadYouTubeCredentials();
    if (credentials === null) {
      throw new UsageError(
        'GOOGLE_OAUTH_CLIENT_ID belum di-set; kredensial OAuth hanya dibaca dari environment'
      );
    }

    console.log(`Akun      : ${account.id} (${account.label})`);
    console.log('Membuka browser untuk consent Google…');

    const store = new DpapiCredentialStore();
    const result = await pairYouTubeAccount({
      accountId: account.id,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      store,
      openUrl,
      ...(args.port === undefined ? {} : { port: args.port })
    });

    updateAccountConnection(db.raw, account.id, {
      connectionStatus: 'connected',
      secretRef: youtubeSecretRef(account.id)
    });

    console.log(`Kredensial : ${result.credentialName} (DPAPI, tersimpan)`);
    console.log(`Pairing    : ${result.token.pairedAt}`);
    console.log(
      `Kedaluwarsa: ${new Date(result.token.expiresAt).toISOString()} (refresh otomatis)`
    );
    console.log('Status     : connected');
  } finally {
    db.close();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Gagal: ${error.message}`);
    console.error(
      'Pemakaian: pair:youtube --account <id> | --label "<label>" [--port <n>]'
    );
    process.exitCode = 2;
    return;
  }
  if (error instanceof Error) {
    const code = 'code' in error ? ` [${String((error as { code?: unknown }).code)}]` : '';
    console.error(`Gagal${code}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error('Gagal: kesalahan tidak dikenal');
  process.exitCode = 1;
});
