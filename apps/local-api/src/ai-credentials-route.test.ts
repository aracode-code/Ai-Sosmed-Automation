import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type DatabaseHandle } from '@saa/database';
import type { CredentialStore } from '@saa/youtube';
import { buildApp } from './app';
import {
  createAiCredentialManager,
  DEEPSEEK_CREDENTIAL_NAME,
  type AiCredentialManager
} from './ai-credentials';
import { loadConfig } from './config';

class MemoryStore implements CredentialStore {
  readonly saved = new Map<string, unknown>();

  async save(name: string, payload: unknown): Promise<void> {
    this.saved.set(name, payload);
  }

  async load<T = unknown>(name: string): Promise<T | null> {
    return (this.saved.get(name) as T | undefined) ?? null;
  }

  async remove(name: string): Promise<boolean> {
    return this.saved.delete(name);
  }
}

let workDir: string;
let db: DatabaseHandle;
let app: FastifyInstance;
let store: MemoryStore;
let credentials: AiCredentialManager;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-ai-credentials-'));
  db = openDatabase(join(workDir, 'app.sqlite'));
  runMigrations(db.raw);
  store = new MemoryStore();
  credentials = createAiCredentialManager({ store, env: {} });
  await credentials.refresh();
  app = buildApp({
    db,
    config: loadConfig({ DATABASE_PATH: join(workDir, 'app.sqlite') }),
    aiCredentials: credentials
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('GET /api/v1/ai/status', () => {
  it('melaporkan belum terkonfigurasi tanpa rahasia', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: false, source: 'none', storeError: false });
  });
});

describe('POST /api/v1/ai/credentials', () => {
  it('menyimpan kunci dan mengubah status tanpa mengembalikan nilai', async () => {
    const apiKey = 'deepseek-kunci-uji-123456';

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/credentials',
      payload: { apiKey }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: true, source: 'store' });
    expect(response.body).not.toContain(apiKey);
    expect(store.saved.get(DEEPSEEK_CREDENTIAL_NAME)).toEqual({ apiKey });

    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    expect(status.json()).toEqual({ configured: true, source: 'store', storeError: false });
  });

  it('menolak kunci terlalu pendek tanpa menyimpan apa pun', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/credentials',
      payload: { apiKey: 'pendek' }
    });

    expect(response.statusCode).toBe(400);
    expect(store.saved.size).toBe(0);
    expect(response.body).not.toContain('pendek');
  });

  it('menolak field tambahan (strict)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/credentials',
      payload: { apiKey: 'deepseek-kunci-uji-123456', source: 'env' }
    });

    expect(response.statusCode).toBe(400);
    expect(store.saved.size).toBe(0);
  });
});
