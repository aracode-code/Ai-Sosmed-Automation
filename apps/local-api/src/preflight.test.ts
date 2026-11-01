import { describe, expect, it } from 'vitest';
import type { SocialAccount } from '@saa/domain';
import type { AppConfig, YouTubeCredentials } from './config';
import {
  collectPreflightChecks,
  preflightExitCode,
  summarizePreflight,
  type PreflightCheck,
  type PreflightInput
} from './preflight';

const baseConfig: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 4317,
  timezone: 'Asia/Jakarta',
  databasePath: ':memory:',
  logLevel: 'silent',
  jobMaxAttempts: 3,
  workerEnabled: false,
  workerIntervalMs: 1_000,
  mediaRoot: './data/media',
  schedulerEnabled: false,
  schedulerIntervalMs: 5_000,
  youtubeAdapter: 'api',
  youtubeUploadPrivacy: 'private',
  youtubeAppStatus: 'production',
  flowAdapter: 'mock',
  flowCdpEndpoint: 'http://127.0.0.1:9222'
};

const credentials: YouTubeCredentials = { clientId: 'client-id', clientSecret: 'client-secret' };

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'acc-1',
    platform: 'youtube',
    label: 'Utama',
    connectionStatus: 'connected',
    secretRef: 'dpapi:youtube:acc-1',
    profileKey: null,
    ...overrides
  };
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    config: baseConfig,
    credentials,
    database: 'ready',
    accounts: [account()],
    videoAssetCount: 2,
    platform: 'win32',
    probeSecret: async () => 'ok',
    ...overrides
  };
}

async function run(overrides: Partial<PreflightInput> = {}): Promise<PreflightCheck[]> {
  return collectPreflightChecks(input(overrides));
}

function find(checks: PreflightCheck[], id: string): PreflightCheck {
  const check = checks.find((entry) => entry.id === id);
  if (check === undefined) throw new Error(`check ${id} tidak ada`);
  return check;
}

describe('collectPreflightChecks', () => {
  it('melaporkan semua siap tanpa FAIL', async () => {
    const checks = await run();
    const summary = summarizePreflight(checks);

    expect(summary.fail).toBe(0);
    expect(preflightExitCode(checks)).toBe(0);
    expect(find(checks, 'adapter').status).toBe('pass');
    expect(find(checks, 'app_status').status).toBe('pass');
    expect(find(checks, 'privacy').status).toBe('pass');
    expect(find(checks, 'database').status).toBe('pass');
    expect(find(checks, 'akun:acc-1').status).toBe('pass');
    expect(find(checks, 'media').status).toBe('pass');
  });

  it('menandai adapter off sebagai FAIL', async () => {
    const checks = await run({ config: { ...baseConfig, youtubeAdapter: 'off' } });

    expect(find(checks, 'adapter').status).toBe('fail');
    expect(preflightExitCode(checks)).toBe(1);
  });

  it('menandai adapter mock sebagai WARN, bukan FAIL', async () => {
    const checks = await run({ config: { ...baseConfig, youtubeAdapter: 'mock' } });

    expect(find(checks, 'adapter').status).toBe('warn');
    expect(preflightExitCode(checks)).toBe(0);
  });

  it('menolak app status testing (refresh token 7 hari)', async () => {
    const checks = await run({ config: { ...baseConfig, youtubeAppStatus: 'testing' } });

    expect(find(checks, 'app_status').status).toBe('fail');
    expect(find(checks, 'app_status').detail).toContain('O3');
  });

  it('memperingatkan app status unknown', async () => {
    const checks = await run({ config: { ...baseConfig, youtubeAppStatus: 'unknown' } });

    expect(find(checks, 'app_status').status).toBe('warn');
  });

  it('gagal bila client id tidak ada dan tidak menuntut client secret', async () => {
    const checks = await run({ credentials: null });

    expect(find(checks, 'oauth_client_id').status).toBe('fail');
    expect(checks.some((check) => check.id === 'oauth_client_secret')).toBe(false);
  });

  it('memberi WARN bila client secret tidak di-set', async () => {
    const checks = await run({ credentials: { clientId: 'client-id', clientSecret: null } });

    expect(find(checks, 'oauth_client_secret').status).toBe('warn');
  });

  it('memberi WARN untuk privasi selain private', async () => {
    const checks = await run({ config: { ...baseConfig, youtubeUploadPrivacy: 'public' } });

    expect(find(checks, 'privacy').status).toBe('warn');
  });

  it('gagal bila berkas database tidak ada', async () => {
    const checks = await run({ database: 'missing', accounts: [], videoAssetCount: 0 });

    expect(find(checks, 'database').status).toBe('fail');
    expect(find(checks, 'database').detail).toContain('migrate');
  });

  it('gagal bila skema database belum siap', async () => {
    const checks = await run({ database: 'unmigrated', accounts: [], videoAssetCount: 0 });

    expect(find(checks, 'database').status).toBe('fail');
  });

  it('memperingatkan bila belum ada akun YouTube', async () => {
    const checks = await run({ accounts: [] });

    expect(find(checks, 'accounts').status).toBe('warn');
    expect(find(checks, 'accounts').detail).toContain('pair:youtube');
  });

  it('gagal bila akun butuh reauth dan menyebut perintah pairing', async () => {
    const checks = await run({
      accounts: [account({ connectionStatus: 'reauth_required' })],
      probeSecret: async () => 'missing'
    });

    expect(find(checks, 'akun:acc-1').status).toBe('fail');
    expect(find(checks, 'akun:acc-1').detail).toContain('pair:youtube --account acc-1');
  });

  it('gagal bila blob DPAPI tidak ada walau akun connected', async () => {
    const checks = await run({ probeSecret: async () => 'missing' });

    expect(find(checks, 'akun:acc-1').status).toBe('fail');
    expect(find(checks, 'akun:acc-1').detail).toContain('tidak ada');
  });

  it('gagal bila blob DPAPI tidak dapat didekripsi', async () => {
    const checks = await run({ probeSecret: async () => 'invalid' });

    expect(find(checks, 'akun:acc-1').status).toBe('fail');
    expect(find(checks, 'akun:acc-1').detail).toContain('didekripsi');
  });

  it('gagal bila secret_ref bukan referensi DPAPI YouTube', async () => {
    const checks = await run({ accounts: [account({ secretRef: 'dpapi:other:acc-1' })] });

    expect(find(checks, 'akun:acc-1').status).toBe('fail');
    expect(find(checks, 'akun:acc-1').detail).toContain('secret_ref');
  });

  it('memperingatkan akun disconnected yang tokennya masih terbaca', async () => {
    const checks = await run({ accounts: [account({ connectionStatus: 'disconnected' })] });

    expect(find(checks, 'akun:acc-1').status).toBe('warn');
  });

  it('memperingatkan bila belum ada aset media video', async () => {
    const checks = await run({ videoAssetCount: 0 });

    expect(find(checks, 'media').status).toBe('warn');
  });

  it('gagal pada platform non-Windows karena DPAPI tidak tersedia', async () => {
    const checks = await run({ platform: 'linux', probeSecret: async () => 'unsupported' });

    expect(find(checks, 'platform').status).toBe('fail');
    expect(find(checks, 'akun:acc-1').status).toBe('fail');
  });

  it('tidak pernah memuat nilai kredensial pada keluaran', async () => {
    const checks = await run({
      credentials: { clientId: 'CLIENT-ID-RAHASIA', clientSecret: 'CLIENT-SECRET-RAHASIA' }
    });
    const serialized = JSON.stringify(checks);

    expect(serialized).not.toContain('CLIENT-ID-RAHASIA');
    expect(serialized).not.toContain('CLIENT-SECRET-RAHASIA');
  });
});
