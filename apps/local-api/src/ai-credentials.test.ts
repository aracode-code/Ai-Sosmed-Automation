import { describe, expect, it } from 'vitest';
import type { CredentialStore } from '@saa/youtube';
import {
  createAiCredentialManager,
  DEEPSEEK_CREDENTIAL_NAME
} from './ai-credentials';

class MemoryStore implements CredentialStore {
  readonly saved = new Map<string, unknown>();
  failLoad = false;

  async save(name: string, payload: unknown): Promise<void> {
    this.saved.set(name, payload);
  }

  async load<T = unknown>(name: string): Promise<T | null> {
    if (this.failLoad) throw new Error('berkas rusak');
    return (this.saved.get(name) as T | undefined) ?? null;
  }

  async remove(name: string): Promise<boolean> {
    return this.saved.delete(name);
  }
}

const ENV_KEY = 'env-deepseek-key-123456';

describe('createAiCredentialManager', () => {
  it('memakai environment bila DPAPI kosong', async () => {
    const manager = createAiCredentialManager({
      store: new MemoryStore(),
      env: { DEEPSEEK_API_KEY: ENV_KEY }
    });

    await manager.refresh();
    const credential = await manager.resolve();

    expect(credential).toEqual({ apiKey: ENV_KEY, source: 'env' });
    expect(manager.status()).toEqual({ configured: true, source: 'env', storeError: false });
  });

  it('kunci tersimpan DPAPI menang atas environment', async () => {
    const store = new MemoryStore();
    await store.save(DEEPSEEK_CREDENTIAL_NAME, { apiKey: 'stored-deepseek-key-999' });
    const manager = createAiCredentialManager({
      store,
      env: { DEEPSEEK_API_KEY: ENV_KEY }
    });

    await manager.refresh();

    await expect(manager.resolve()).resolves.toEqual({
      apiKey: 'stored-deepseek-key-999',
      source: 'store'
    });
  });

  it('mengabaikan isi tersimpan yang tidak valid lalu jatuh ke environment', async () => {
    const store = new MemoryStore();
    await store.save(DEEPSEEK_CREDENTIAL_NAME, { apiKey: '   ' });
    const manager = createAiCredentialManager({
      store,
      env: { DEEPSEEK_API_KEY: ENV_KEY }
    });

    await manager.refresh();

    expect((await manager.resolve())?.source).toBe('env');
  });

  it('melaporkan storeError tanpa menjatuhkan fallback environment', async () => {
    const store = new MemoryStore();
    store.failLoad = true;
    const manager = createAiCredentialManager({
      store,
      env: { DEEPSEEK_API_KEY: ENV_KEY }
    });

    await manager.refresh();

    expect((await manager.resolve())?.apiKey).toBe(ENV_KEY);
    expect(manager.status()).toEqual({ configured: true, source: 'env', storeError: true });
  });

  it('tidak terkonfigurasi bila DPAPI kosong dan environment tidak ada', async () => {
    const manager = createAiCredentialManager({ store: new MemoryStore(), env: {} });

    await manager.refresh();

    await expect(manager.resolve()).resolves.toBeNull();
    expect(manager.isConfigured()).toBe(false);
    expect(manager.status()).toEqual({ configured: false, source: 'none', storeError: false });
  });

  it('menyimpan kunci terpangkas dan langsung terpakai tanpa refresh', async () => {
    const store = new MemoryStore();
    const manager = createAiCredentialManager({ store, env: {} });
    await manager.refresh();

    await manager.save('  kunci-baru-deepseek-123  ');

    expect(store.saved.get(DEEPSEEK_CREDENTIAL_NAME)).toEqual({
      apiKey: 'kunci-baru-deepseek-123'
    });
    expect(manager.isConfigured()).toBe(true);
    await expect(manager.resolve()).resolves.toEqual({
      apiKey: 'kunci-baru-deepseek-123',
      source: 'store'
    });
  });

  it('status tidak pernah memuat nilai kunci', async () => {
    const manager = createAiCredentialManager({
      store: new MemoryStore(),
      env: { DEEPSEEK_API_KEY: ENV_KEY }
    });
    await manager.refresh();

    expect(JSON.stringify(manager.status())).not.toContain(ENV_KEY);
  });
});
