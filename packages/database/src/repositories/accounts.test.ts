import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSocialAccount,
  insertSocialAccount,
  openDatabase,
  runMigrations,
  updateAccountConnection,
  type DatabaseHandle
} from '../index';

const cleanups: (() => void)[] = [];

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-accounts-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  runMigrations(handle.raw);
  cleanups.push(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('updateAccountConnection', () => {
  it('menulis status dan referensi kredensial tanpa mengubah platform/label', () => {
    const db = tempDb();
    const account = insertSocialAccount(db.raw, {
      platform: 'youtube',
      label: 'kanal utama',
      profileKey: 'yt-main'
    });
    expect(account.connectionStatus).toBe('disconnected');
    expect(account.secretRef).toBeNull();

    const updated = updateAccountConnection(db.raw, account.id, {
      connectionStatus: 'connected',
      secretRef: `dpapi:youtube:${account.id}`
    });

    expect(updated).toMatchObject({
      id: account.id,
      platform: 'youtube',
      label: 'kanal utama',
      profileKey: 'yt-main',
      connectionStatus: 'connected',
      secretRef: `dpapi:youtube:${account.id}`
    });
  });

  it('mempertahankan secret_ref bila tidak disebutkan', () => {
    const db = tempDb();
    const account = insertSocialAccount(db.raw, {
      platform: 'youtube',
      label: 'kanal utama',
      connectionStatus: 'connected'
    });

    const paired = updateAccountConnection(db.raw, account.id, {
      connectionStatus: 'connected',
      secretRef: `dpapi:youtube:${account.id}`
    });
    expect(paired?.secretRef).toBe(`dpapi:youtube:${account.id}`);

    const updated = updateAccountConnection(db.raw, account.id, {
      connectionStatus: 'reauth_required'
    });

    expect(updated?.secretRef).toBe(`dpapi:youtube:${account.id}`);
    expect(updated?.connectionStatus).toBe('reauth_required');
  });

  it('mengembalikan null untuk akun yang tidak ada', () => {
    const db = tempDb();
    expect(updateAccountConnection(db.raw, 'acc_tidak_ada', { connectionStatus: 'connected' }))
      .toBeNull();
    expect(getSocialAccount(db.raw, 'acc_tidak_ada')).toBeNull();
  });
});
