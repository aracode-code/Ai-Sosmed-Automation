import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileBusyError } from './profile-lock';
import {
  DEFAULT_FLOW_URL,
  detectInstalledBrowser,
  openFlowSession,
  resolveFlowBrowserChannel,
  resolveFlowProfileDir,
  type FlowBrowserHandle,
  type FlowLauncher
} from './flow-session';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-flow-session-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function fakeBrowser(overrides: Partial<FlowBrowserHandle> = {}): {
  handle: FlowBrowserHandle;
  calls: { urls: string[]; closed: number };
} {
  const calls = { urls: [] as string[], closed: 0 };
  const handle: FlowBrowserHandle = {
    page: {
      async goto(url: string) {
        calls.urls.push(url);
      }
    },
    async close() {
      calls.closed += 1;
    },
    async waitForClose() {},
    ...overrides
  };
  return { handle, calls };
}

const launcherReturning =
  (handle: FlowBrowserHandle): FlowLauncher =>
  async () =>
    handle;

describe('resolveFlowProfileDir', () => {
  it('memakai LOCALAPPDATA pada Windows', () => {
    const dir = resolveFlowProfileDir({
      env: { LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' },
      platform: 'win32'
    });
    expect(dir).toBe(join('C:\\Users\\demo\\AppData\\Local', 'saa', 'browser', 'flow-profile'));
  });

  it('menghormati override absolut', () => {
    const dir = resolveFlowProfileDir({
      env: { FLOW_PROFILE_DIR: 'D:\\profil\\flow' },
      platform: 'win32'
    });
    expect(dir).toBe('D:\\profil\\flow');
  });

  it('menolak override relatif', () => {
    expect(() =>
      resolveFlowProfileDir({ env: { FLOW_PROFILE_DIR: 'profil/flow' }, platform: 'win32' })
    ).toThrow(/absolut/);
  });

  it('menolak bila LOCALAPPDATA tidak tersedia', () => {
    expect(() => resolveFlowProfileDir({ env: {}, platform: 'win32' })).toThrow(/LOCALAPPDATA/);
  });

  it('memakai direktori XDG-like pada platform lain', () => {
    const dir = resolveFlowProfileDir({
      env: {},
      platform: 'linux',
      homeDir: '/home/demo'
    });
    expect(dir).toBe(join('/home/demo', '.local', 'share', 'saa', 'browser', 'flow-profile'));
  });
});

describe('detectInstalledBrowser', () => {
  const chromePath = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const edgePath = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');

  it('memilih Chrome bila terpasang', () => {
    const found = detectInstalledBrowser({
      platform: 'win32',
      env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' },
      exists: (path) => path === chromePath
    });
    expect(found).toEqual({ channel: 'chrome', executablePath: chromePath });
  });

  it('jatuh ke Edge bila Chrome tidak ada', () => {
    const found = detectInstalledBrowser({
      platform: 'win32',
      env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' },
      exists: (path) => path === edgePath
    });
    expect(found).toEqual({ channel: 'msedge', executablePath: edgePath });
  });

  it('null bila tidak ada browser resmi atau bukan Windows', () => {
    expect(detectInstalledBrowser({ platform: 'win32', env: {}, exists: () => false })).toBeNull();
    expect(detectInstalledBrowser({ platform: 'linux', env: {}, exists: () => true })).toBeNull();
  });
});

describe('resolveFlowBrowserChannel', () => {
  it('menghormati override FLOW_BROWSER_CHANNEL', () => {
    expect(resolveFlowBrowserChannel({ env: { FLOW_BROWSER_CHANNEL: 'msedge' } })).toBe('msedge');
    expect(resolveFlowBrowserChannel({ env: { FLOW_BROWSER_CHANNEL: 'chromium' } })).toBe('chromium');
  });

  it('menolak nilai yang tidak dikenal', () => {
    expect(() => resolveFlowBrowserChannel({ env: { FLOW_BROWSER_CHANNEL: 'firefox' } })).toThrow(
      /tidak dikenal/
    );
  });

  it('memakai deteksi otomatis dan fallback ke chromium', () => {
    const chromePath = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(
      resolveFlowBrowserChannel({
        platform: 'win32',
        env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' },
        exists: (path) => path === chromePath
      })
    ).toBe('chrome');
    expect(resolveFlowBrowserChannel({ platform: 'linux', env: {}, exists: () => false })).toBe(
      'chromium'
    );
  });
});

describe('openFlowSession', () => {
  it('membuka halaman Flow dengan lock dipegang selama sesi', async () => {
    const { handle, calls } = fakeBrowser();
    const profileDir = join(workDir, 'profile');

    const session = await openFlowSession({
      profileDir,
      launcher: launcherReturning(handle)
    });

    expect(calls.urls).toEqual([DEFAULT_FLOW_URL]);
    expect(existsSync(session.lockPath)).toBe(true);
    expect(session.profileDir).toBe(profileDir);

    await session.close();
    expect(calls.closed).toBe(1);
    expect(existsSync(session.lockPath)).toBe(false);
  });

  it('memakai URL kustom bila diberikan', async () => {
    const { handle, calls } = fakeBrowser();
    const session = await openFlowSession({
      profileDir: join(workDir, 'profile'),
      url: 'https://example.test/flow',
      launcher: launcherReturning(handle)
    });

    expect(calls.urls).toEqual(['https://example.test/flow']);
    await session.close();
  });

  it('meneruskan channel ke launcher', async () => {
    const profileDir = join(workDir, 'profile');
    const channels: string[] = [];
    const { handle } = fakeBrowser();

    const session = await openFlowSession({
      profileDir,
      channel: 'chrome',
      launcher: async (_dir, channel) => {
        channels.push(channel);
        return handle;
      }
    });

    expect(channels).toEqual(['chrome']);
    expect(session.channel).toBe('chrome');
    await session.close();
  });

  it('menolak sesi kedua selama lock dipegang', async () => {
    const profileDir = join(workDir, 'profile');
    const first = fakeBrowser();
    const second = fakeBrowser();

    const session = await openFlowSession({
      profileDir,
      lockOwnerId: 'login-1',
      launcher: launcherReturning(first.handle)
    });

    await expect(
      openFlowSession({ profileDir, lockOwnerId: 'login-2', launcher: launcherReturning(second.handle) })
    ).rejects.toBeInstanceOf(ProfileBusyError);

    await session.close();
  });

  it('melepas lock bila launcher gagal', async () => {
    const profileDir = join(workDir, 'profile');

    await expect(
      openFlowSession({
        profileDir,
        launcher: async () => {
          throw new Error('chrome tidak ada');
        }
      })
    ).rejects.toThrow(/gagal membuka browser/);

    expect(existsSync(join(profileDir, '.worker-lock.json'))).toBe(false);
  });

  it('menutup browser dan melepas lock bila navigasi gagal', async () => {
    const profileDir = join(workDir, 'profile');
    const calls = { closed: 0 };
    const handle: FlowBrowserHandle = {
      page: {
        async goto() {
          throw new Error('net::ERR');
        }
      },
      async close() {
        calls.closed += 1;
      },
      async waitForClose() {}
    };

    await expect(
      openFlowSession({ profileDir, launcher: launcherReturning(handle) })
    ).rejects.toThrow(/gagal membuka halaman/);

    expect(calls.closed).toBe(1);
    expect(existsSync(join(profileDir, '.worker-lock.json'))).toBe(false);
  });

  it('mode toleran membiarkan jendela terbuka walau navigasi gagal', async () => {
    const profileDir = join(workDir, 'profile');
    const handle: FlowBrowserHandle = {
      page: {
        async goto() {
          throw new Error('Timeout 60000ms exceeded');
        }
      },
      async close() {},
      async waitForClose() {}
    };

    const session = await openFlowSession({
      profileDir,
      launcher: launcherReturning(handle),
      tolerateGotoFailure: true
    });

    expect(session.navigationError).toContain('Timeout');
    expect(existsSync(session.lockPath)).toBe(true);

    await session.close();
    expect(existsSync(session.lockPath)).toBe(false);
  });
});
