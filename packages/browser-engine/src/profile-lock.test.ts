import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireProfileLock, ProfileBusyError } from './index';

const cleanups: (() => void)[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saa-profile-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('profile lock', () => {
  it('hanya satu worker yang boleh memegang profil', () => {
    const directory = tempDir();
    const first = acquireProfileLock({ directory, ownerId: 'worker-1' });

    expect(() => acquireProfileLock({ directory, ownerId: 'worker-2' })).toThrow(
      ProfileBusyError
    );

    expect(first.release()).toBe(true);
    const second = acquireProfileLock({ directory, ownerId: 'worker-2' });
    expect(second.ownerId).toBe('worker-2');
    expect(second.release()).toBe(true);
  });

  it('lock kedaluwarsa boleh diambil alih', () => {
    const directory = tempDir();
    const start = new Date('2026-01-01T00:00:00.000Z');
    acquireProfileLock({ directory, ownerId: 'worker-mati', ttlMs: 1_000, now: () => start });

    const later = new Date('2026-01-01T00:01:00.000Z');
    const takeover = acquireProfileLock({
      directory,
      ownerId: 'worker-baru',
      ttlMs: 60_000,
      now: () => later
    });

    expect(takeover.ownerId).toBe('worker-baru');
    expect(takeover.release()).toBe(true);
  });

  it('worker lain tidak dapat melepas lock milik pemiliknya', async () => {
    const directory = tempDir();
    const holder = acquireProfileLock({ directory, ownerId: 'worker-1' });
    const lockPath = join(directory, '.worker-lock.json');
    const { readFileSync, writeFileSync } = await import('node:fs');
    writeFileSync(
      lockPath,
      JSON.stringify({
        ownerId: 'worker-2',
        token: 'token-lain',
        acquiredAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:10:00.000Z'
      })
    );

    expect(holder.release()).toBe(false);
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({ token: 'token-lain' });
  });

  it('lock rusak dianggap tidak valid dan boleh diambil alih', async () => {
    const directory = tempDir();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(directory, '.worker-lock.json'), 'bukan json');

    const lock = acquireProfileLock({ directory, ownerId: 'worker-1' });
    expect(lock.ownerId).toBe('worker-1');
    expect(lock.release()).toBe(true);
  });
});
