import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  insertSocialAccount,
  openDatabase,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
import { buildApp } from './app';
import { loadConfig } from './config';
import {
  ConnectActionInProgressError,
  ConnectActionNotRunningError,
  type ConnectActionController,
  type ConnectActionKind,
  type ConnectActionSnapshot
} from './connect-runner';

interface ErrorBody {
  error: { code: string; message: string };
}

function idle(kind: ConnectActionKind): ConnectActionSnapshot {
  return {
    kind,
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    waitingFor: null,
    error: null,
    lines: []
  };
}

class FakeController implements ConnectActionController {
  readonly starts: { kind: ConnectActionKind; args: readonly string[] }[] = [];
  readonly cancels: ConnectActionKind[] = [];
  readonly states: Record<ConnectActionKind, ConnectActionSnapshot> = {
    'flow-login': idle('flow-login'),
    'youtube-pair': idle('youtube-pair')
  };
  busy = false;
  notRunning = false;

  start(kind: ConnectActionKind, args: readonly string[] = []): ConnectActionSnapshot {
    if (this.busy) throw new ConnectActionInProgressError(kind);
    this.starts.push({ kind, args: [...args] });
    this.states[kind] = {
      ...idle(kind),
      phase: 'running',
      startedAt: '2026-11-01T10:00:00.000Z',
      lines: ['proses dijalankan']
    };
    return { ...this.states[kind], lines: [...this.states[kind].lines] };
  }

  snapshot(kind: ConnectActionKind): ConnectActionSnapshot {
    return { ...this.states[kind], lines: [...this.states[kind].lines] };
  }

  cancel(kind: ConnectActionKind): ConnectActionSnapshot {
    if (this.notRunning) throw new ConnectActionNotRunningError(kind);
    this.cancels.push(kind);
    this.states[kind] = {
      ...this.states[kind],
      phase: 'cancelled',
      error: 'dihentikan dari UI',
      endedAt: '2026-11-01T10:01:00.000Z'
    };
    return this.snapshot(kind);
  }
}

let db: DatabaseHandle;
let app: FastifyInstance;
let controller: FakeController;
let youtubeAccountId: string;
let tiktokAccountId: string;

beforeEach(async () => {
  db = openDatabase(':memory:');
  runMigrations(db.raw);
  youtubeAccountId = insertSocialAccount(db.raw, { platform: 'youtube', label: 'Kanal' }).id;
  tiktokAccountId = insertSocialAccount(db.raw, { platform: 'tiktok', label: 'TikTok' }).id;
  controller = new FakeController();

  app = buildApp({
    db,
    config: loadConfig({ FLOW_ADAPTER: 'real', YOUTUBE_ADAPTER: 'api' }),
    now: () => new Date('2026-11-01T10:00:00.000Z'),
    connectRunner: controller,
    connectPreflight: async () => ({ ok: true, detail: null }),
    hasYouTubeCredentials: () => true
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /api/v1/connections/actions', () => {
  it('mengembalikan status idle untuk kedua aksi', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/connections/actions' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      generatedAt: string;
      actions: { flowLogin: ConnectActionSnapshot; youtubePair: ConnectActionSnapshot };
    }>();
    expect(body.generatedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(body.actions.flowLogin).toMatchObject({ kind: 'flow-login', phase: 'idle' });
    expect(body.actions.youtubePair).toMatchObject({ kind: 'youtube-pair', phase: 'idle' });
  });
});

describe('POST /api/v1/connections/flow/login', () => {
  it('menjalankan aksi login Flow tanpa argumen', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/flow/login',
      headers: { 'content-type': 'application/json' },
      payload: {}
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ action: ConnectActionSnapshot }>().action.phase).toBe('running');
    expect(controller.starts).toEqual([{ kind: 'flow-login', args: [] }]);
  });

  it('menolak dengan 412 saat browser tidak siap, tanpa menjalankan proses', async () => {
    const offline = buildApp({
      db,
      config: loadConfig({ FLOW_ADAPTER: 'real' }),
      connectRunner: controller,
      connectPreflight: async () => ({ ok: false, detail: 'Chrome tidak ditemukan' })
    });
    await offline.ready();

    const response = await offline.inject({ method: 'POST', url: '/api/v1/connections/flow/login' });

    expect(response.statusCode).toBe(412);
    expect(response.json<ErrorBody>().error.code).toBe('CONNECT_PREFLIGHT_FAILED');
    expect(response.body).toContain('Chrome tidak ditemukan');
    expect(controller.starts).toHaveLength(0);

    await offline.close();
  });

  it('menolak aksi ganda dengan 409', async () => {
    controller.busy = true;
    const response = await app.inject({ method: 'POST', url: '/api/v1/connections/flow/login' });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONNECT_ACTION_IN_PROGRESS');
  });
});

describe('POST /api/v1/connections/youtube/pair', () => {
  it('meneruskan label akun baru ke CLI', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { label: '  Kanal Baru  ' }
    });

    expect(response.statusCode).toBe(202);
    expect(controller.starts).toEqual([
      { kind: 'youtube-pair', args: ['--label', 'Kanal Baru'] }
    ]);
  });

  it('meneruskan accountId akun youtube yang ada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { accountId: youtubeAccountId }
    });

    expect(response.statusCode).toBe(202);
    expect(controller.starts).toEqual([
      { kind: 'youtube-pair', args: ['--account', youtubeAccountId] }
    ]);
  });

  it('menolak body tanpa pilihan atau dengan dua pilihan', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: {}
    });
    const both = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { label: 'Kanal', accountId: youtubeAccountId }
    });

    expect(empty.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
    expect(controller.starts).toHaveLength(0);
  });

  it('menolak field asing agar kredensial tidak pernah masuk lewat UI', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { label: 'Kanal', clientSecret: 'rahasia-uji' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('rahasia-uji');
    expect(controller.starts).toHaveLength(0);
  });

  it('menolak akun yang tidak ada atau bukan youtube', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { accountId: 'acc-tidak-ada' }
    });
    const wrongPlatform = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { accountId: tiktokAccountId }
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json<ErrorBody>().error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(wrongPlatform.statusCode).toBe(400);
    expect(wrongPlatform.json<ErrorBody>().error.code).toBe('ACCOUNT_UNSUPPORTED');
  });

  it('menolak dengan 412 saat kredensial OAuth belum di-set', async () => {
    const tanpaKredensial = buildApp({
      db,
      config: loadConfig({ FLOW_ADAPTER: 'real' }),
      connectRunner: controller,
      hasYouTubeCredentials: () => false
    });
    await tanpaKredensial.ready();

    const response = await tanpaKredensial.inject({
      method: 'POST',
      url: '/api/v1/connections/youtube/pair',
      payload: { label: 'Kanal' }
    });

    expect(response.statusCode).toBe(412);
    expect(response.json<ErrorBody>().error.code).toBe('MISSING_CREDENTIALS');
    expect(controller.starts).toHaveLength(0);

    await tanpaKredensial.close();
  });
});

describe('POST /api/v1/connections/actions/:kind/stop', () => {
  it('menghentikan aksi yang berjalan', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/actions/flow-login/stop'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ action: ConnectActionSnapshot }>().action.phase).toBe('cancelled');
    expect(controller.cancels).toEqual(['flow-login']);
  });

  it('menolak stop bila tidak ada aksi berjalan', async () => {
    controller.notRunning = true;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/actions/youtube-pair/stop'
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONNECT_ACTION_NOT_RUNNING');
  });

  it('menolak kind yang tidak dikenal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections/actions/unknown/stop'
    });

    expect(response.statusCode).toBe(400);
  });
});
