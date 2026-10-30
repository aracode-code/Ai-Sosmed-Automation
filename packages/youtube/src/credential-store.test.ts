import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CredentialStoreError, DpapiCredentialStore } from './credential-store';

const cleanups: (() => Promise<void>)[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'saa-cred-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const xor = (input: Buffer): Promise<Buffer> =>
  Promise.resolve(Buffer.from(input.map((byte) => byte ^ 0x5a)));

function fakeStore(rootDir: string): DpapiCredentialStore {
  return new DpapiCredentialStore({ rootDir, protect: xor, unprotect: xor });
}

describe('DpapiCredentialStore (transformasi palsu)', () => {
  it('menyimpan dan memuat payload JSON termasuk karakter non-ASCII', async () => {
    const store = fakeStore(await tempRoot());
    const payload = { refreshToken: 'token-uji-1', label: 'Kanal Edukasi — utama', expiresAt: 123 };

    await store.save('youtube-acc_1', payload);

    await expect(store.load('youtube-acc_1')).resolves.toEqual(payload);
  });

  it('menulis ciphertext, bukan plaintext, ke disk', async () => {
    const rootDir = await tempRoot();
    const store = fakeStore(rootDir);

    await store.save('youtube-acc_2', { refreshToken: 'rahasia-jangan-terbaca' });

    const raw = await readFile(join(rootDir, 'youtube-acc_2.bin'), 'utf8');
    expect(raw).not.toContain('rahasia-jangan-terbaca');
    expect(raw).not.toContain('refreshToken');
  });

  it('mengembalikan null untuk kredensial yang belum ada', async () => {
    const store = fakeStore(await tempRoot());
    await expect(store.load('youtube-belum-ada')).resolves.toBeNull();
  });

  it('remove mengembalikan true sekali lalu false', async () => {
    const store = fakeStore(await tempRoot());
    await store.save('youtube-acc_3', { refreshToken: 'x' });

    await expect(store.remove('youtube-acc_3')).resolves.toBe(true);
    await expect(store.remove('youtube-acc_3')).resolves.toBe(false);
    await expect(store.load('youtube-acc_3')).resolves.toBeNull();
  });

  it('menolak nama yang bisa keluar dari rootDir', async () => {
    const store = fakeStore(await tempRoot());

    for (const name of ['../evil', 'a/b', '', '.hidden', 'youtube:acc']) {
      await expect(store.save(name, {})).rejects.toBeInstanceOf(CredentialStoreError);
    }
  });

  it('melaporkan CORRUPT bila isi berkas bukan JSON valid', async () => {
    const rootDir = await tempRoot();
    const store = fakeStore(rootDir);
    await writeFile(join(rootDir, 'youtube-rusak.bin'), await xor(Buffer.from('bukan json')));

    await expect(store.load('youtube-rusak')).rejects.toMatchObject({ code: 'CORRUPT' });
  });
});

describe.skipIf(process.platform !== 'win32')('DpapiCredentialStore (DPAPI nyata)', () => {
  it('round-trip payload dengan DPAPI user scope', async () => {
    const rootDir = await tempRoot();
    const store = new DpapiCredentialStore({ rootDir });
    const payload = { refreshToken: 'token-dpapi-uji', expiresAt: 1_700_000_000 };

    await store.save('youtube-dpapi', payload);

    await expect(store.load('youtube-dpapi')).resolves.toEqual(payload);
    const raw = await readFile(join(rootDir, 'youtube-dpapi.bin'), 'utf8');
    expect(raw).not.toContain('token-dpapi-uji');
    await expect(store.remove('youtube-dpapi')).resolves.toBe(true);
  });

  it('gagal mendekripsi berkas yang bukan keluaran DPAPI', async () => {
    const rootDir = await tempRoot();
    const store = new DpapiCredentialStore({ rootDir });
    await writeFile(join(rootDir, 'youtube-palsu.bin'), 'bukan-ciphertext');

    await expect(store.load('youtube-palsu')).rejects.toMatchObject({
      code: 'UNPROTECT_FAILED'
    });
  });

  it('membatalkan DPAPI yang melewati batas waktu', async () => {
    const store = new DpapiCredentialStore({ rootDir: await tempRoot(), timeoutMs: 1 });

    await expect(store.save('youtube-timeout', { refreshToken: 'x' })).rejects.toMatchObject({
      code: 'PROTECT_FAILED'
    });
  });
});
