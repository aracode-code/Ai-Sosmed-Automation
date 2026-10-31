import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { AppError } from '@saa/domain';
import { acquireProfileLock, type ProfileLock } from './profile-lock';

/**
 * Sesi browser Flow: profil persisten yang di-login manual oleh pemilik akun.
 * Aplikasi tidak pernah mengisi kredensial, memecahkan CAPTCHA, atau menembus
 * verifikasi apa pun — bila Flow menantang, worker berhenti (NEEDS_ATTENTION).
 */
export const DEFAULT_FLOW_URL = 'https://labs.google/fx/tools/flow';

export interface FlowProfileOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

/** `FLOW_PROFILE_DIR` (absolut) menimpa lokasi default; default ada di LOCALAPPDATA. */
export function resolveFlowProfileDir(options: FlowProfileOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.FLOW_PROFILE_DIR?.trim();
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) {
      throw new AppError('VALIDATION', 'FLOW_PROFILE_DIR harus berupa path absolut');
    }
    return override;
  }

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA?.trim();
    if (base === undefined || base === '') {
      throw new AppError('VALIDATION', 'LOCALAPPDATA tidak tersedia untuk menyimpan profil Flow');
    }
    return join(base, 'saa', 'browser', 'flow-profile');
  }

  const home = options.homeDir ?? homedir();
  return join(home, '.local', 'share', 'saa', 'browser', 'flow-profile');
}

export interface FlowPage {
  goto(
    url: string,
    options?: { waitUntil?: 'domcontentloaded' | 'load'; timeout?: number }
  ): Promise<unknown>;
}

export interface FlowBrowserHandle {
  page: FlowPage;
  close(): Promise<void>;
  /** Resolve ketika jendela browser ditutup pengguna. */
  waitForClose(): Promise<void>;
}

export type FlowBrowserChannel = 'chrome' | 'msedge' | 'chromium';

export interface BrowserDetectionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

export interface InstalledBrowser {
  channel: 'chrome' | 'msedge';
  executablePath: string;
}

/**
 * Browser yang dipakai harus **build resmi** yang didukung Google. Chromium
 * bawaan Playwright ditolak Google pada alur sign-in ("browser may not be
 * secure"); memakai Chrome/Edge terpasang adalah saran resmi pesan tersebut.
 * DILARANG menambal deteksi otomasi (stealth/UA spoof/cookie copy).
 */
export function detectInstalledBrowser(
  options: BrowserDetectionOptions = {}
): InstalledBrowser | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  if (platform !== 'win32') return null;

  const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files';
  const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA ?? '';

  const chromeCandidates = [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ...(localAppData === ''
      ? []
      : [join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')])
  ];
  const chrome = chromeCandidates.find((candidate) => exists(candidate));
  if (chrome !== undefined) return { channel: 'chrome', executablePath: chrome };

  const edge = join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  if (exists(edge)) return { channel: 'msedge', executablePath: edge };

  return null;
}

/** `FLOW_BROWSER_CHANNEL` (chrome|msedge|chromium) menimpa deteksi otomatis. */
export function resolveFlowBrowserChannel(
  options: BrowserDetectionOptions = {}
): FlowBrowserChannel {
  const env = options.env ?? process.env;
  const requested = env.FLOW_BROWSER_CHANNEL?.trim().toLowerCase();
  if (requested === 'chrome' || requested === 'msedge' || requested === 'chromium') {
    return requested;
  }
  if (requested !== undefined && requested !== '') {
    throw new AppError('VALIDATION', `FLOW_BROWSER_CHANNEL tidak dikenal: ${requested}`);
  }
  return detectInstalledBrowser(options)?.channel ?? 'chromium';
}

export type FlowLauncher = (
  profileDir: string,
  channel: FlowBrowserChannel
) => Promise<FlowBrowserHandle>;

async function launchWithPlaywright(
  profileDir: string,
  channel: FlowBrowserChannel
): Promise<FlowBrowserHandle> {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
    ...(channel === 'chromium' ? {} : { channel })
  });
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  return {
    page: page as unknown as FlowPage,
    close: async () => {
      await context.close();
    },
    waitForClose: () =>
      new Promise<void>((resolve) => {
        context.once('close', () => resolve());
      })
  };
}

export interface FlowBrowserAvailability {
  available: boolean;
  channel: FlowBrowserChannel;
  executablePath: string | null;
  reason?: string;
}

/** Cek lokal tanpa membuka browser: paket playwright dapat dimuat dan browser tersedia. */
export async function checkFlowBrowser(
  channel: FlowBrowserChannel = 'chromium',
  detection: BrowserDetectionOptions = {}
): Promise<FlowBrowserAvailability> {
  if (channel !== 'chromium') {
    const installed = detectInstalledBrowser(detection);
    if (installed !== null && installed.channel === channel) {
      return { available: true, channel, executablePath: installed.executablePath };
    }
    return {
      available: false,
      channel,
      executablePath: null,
      reason: `channel ${channel} tidak ditemukan di mesin ini`
    };
  }

  try {
    const { chromium } = await import('playwright');
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      return {
        available: false,
        channel,
        executablePath,
        reason:
          'Chromium belum diunduh — jalankan: corepack pnpm --filter @saa/browser-engine exec playwright install chromium'
      };
    }
    return { available: true, channel, executablePath };
  } catch (error) {
    return {
      available: false,
      channel,
      executablePath: null,
      reason: error instanceof Error ? error.message : 'paket playwright tidak dapat dimuat'
    };
  }
}

export interface OpenFlowSessionOptions {
  profileDir: string;
  url?: string;
  lockOwnerId?: string;
  lockTtlMs?: number;
  launcher?: FlowLauncher;
  now?: () => Date;
  /** Default 60 s; Flow adalah SPA dan `load` penuh bisa lama. */
  gotoTimeoutMs?: number;
  /** Default `chromium` (bawaan Playwright); login wajib memakai build resmi. */
  channel?: FlowBrowserChannel;
  /**
   * Login manual: kegagalan/kelambatan navigasi tidak menutup jendela,
   * pengguna tetap bisa login. Untuk adapter generasi, biarkan `false`.
   */
  tolerateGotoFailure?: boolean;
}

export interface FlowSession extends FlowBrowserHandle {
  profileDir: string;
  lockPath: string;
  startedAt: string;
  channel: FlowBrowserChannel;
  /** Terisi bila navigasi gagal tetapi sesi tetap dibuka (mode toleran). */
  navigationError: string | null;
  /** Melepas lock tanpa menutup browser (dipakai hanya bila browser sudah tertutup). */
  releaseLock(): boolean;
}

/**
 * Satu profil hanya boleh dipakai satu proses: lock diambil sebelum browser
 * dibuka dan dilepas setelah browser ditutup, termasuk saat launch/goto gagal.
 */
export async function openFlowSession(
  options: OpenFlowSessionOptions
): Promise<FlowSession> {
  const now = options.now ?? (() => new Date());
  mkdirSync(options.profileDir, { recursive: true });

  const lock: ProfileLock = acquireProfileLock({
    directory: options.profileDir,
    ownerId: options.lockOwnerId ?? 'flow-session',
    ...(options.lockTtlMs === undefined ? {} : { ttlMs: options.lockTtlMs }),
    now
  });

  const channel = options.channel ?? 'chromium';
  let handle: FlowBrowserHandle;
  try {
    handle = await (options.launcher ?? launchWithPlaywright)(options.profileDir, channel);
  } catch (error) {
    lock.release();
    throw new AppError('UNKNOWN', 'gagal membuka browser Flow', { cause: error });
  }

  let navigationError: string | null = null;
  try {
    await handle.page.goto(options.url ?? DEFAULT_FLOW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.gotoTimeoutMs ?? 60_000
    });
  } catch (error) {
    if (options.tolerateGotoFailure !== true) {
      await handle.close().catch(() => undefined);
      lock.release();
      throw new AppError('TRANSIENT_NETWORK', 'gagal membuka halaman Flow', { cause: error });
    }
    navigationError = error instanceof Error ? error.message : 'navigasi tidak selesai';
  }

  return {
    profileDir: options.profileDir,
    lockPath: lock.path,
    startedAt: now().toISOString(),
    channel,
    navigationError,
    page: handle.page,
    waitForClose: handle.waitForClose,
    releaseLock: () => lock.release(),
    async close(): Promise<void> {
      try {
        await handle.close();
      } finally {
        lock.release();
      }
    }
  };
}
