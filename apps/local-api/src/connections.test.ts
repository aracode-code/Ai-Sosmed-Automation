import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertSocialAccount, openDatabase, runMigrations, type DatabaseHandle } from '@saa/database';
import { loadConfig } from './config';
import { connectionRoutes, type FlowProbeStatus } from './routes/connections';

interface ConnectionsPayload {
  generatedAt: string;
  flow: FlowProbeStatus & { adapter: string; cdpEndpoint: string; privacy: string };
  usage: { usedToday: number; day: string; guard: { maxPerDay: number } };
  accounts: { platform: string; connectionStatus: string; hasSecretRef: boolean }[];
  platforms: { id: string; supported: boolean; adapter: string; generator: string | null }[];
}

let app: FastifyInstance;
let db: DatabaseHandle;

const READY_PROBE: FlowProbeStatus = {
  reachable: true,
  pageOpen: true,
  promptPresent: true,
  submitPresent: true,
  challengeDetected: false,
  detail: 'https://flow.google.com/project/x'
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  runMigrations(db.raw);
  insertSocialAccount(db.raw, {
    platform: 'youtube',
    label: 'Kanal',
    connectionStatus: 'connected',
    secretRef: 'dpapi:youtube:acc-1'
  });
  insertSocialAccount(db.raw, { platform: 'tiktok', label: 'Kanal 2' });

  app = Fastify();
  await app.register(connectionRoutes, {
    db,
    config: loadConfig({ FLOW_ADAPTER: 'real', YOUTUBE_ADAPTER: 'api' }),
    probeFlow: async () => READY_PROBE,
    readUsage: () => ({
      guard: { maxPerDay: 2, requireConfirm: true, dryRun: false },
      usedToday: 1,
      day: '2026-11-01'
    }),
    now: () => new Date('2026-11-01T10:00:00.000Z')
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /api/v1/connections', () => {
  it('mengembalikan status Flow, pemakaian, akun, dan platform', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/connections' });

    expect(response.statusCode).toBe(200);
    const payload = response.json<ConnectionsPayload>();
    expect(payload.flow.adapter).toBe('real');
    expect(payload.flow.cdpEndpoint).toBe('http://127.0.0.1:9222');
    expect(payload.flow.reachable).toBe(true);
    expect(payload.flow.promptPresent).toBe(true);
    expect(payload.usage).toMatchObject({ usedToday: 1, day: '2026-11-01' });
    expect(payload.usage.guard.maxPerDay).toBe(2);

    const youtube = payload.accounts.find((account) => account.platform === 'youtube');
    expect(youtube).toMatchObject({ connectionStatus: 'connected', hasSecretRef: true });
    const tiktok = payload.accounts.find((account) => account.platform === 'tiktok');
    expect(tiktok).toMatchObject({ hasSecretRef: false });

    const youtubePlatform = payload.platforms.find((platform) => platform.id === 'youtube');
    expect(youtubePlatform).toMatchObject({ supported: true, adapter: 'api', generator: 'flow' });
    const otherPlatform = payload.platforms.find((platform) => platform.id === 'x');
    expect(otherPlatform).toMatchObject({ supported: false, adapter: 'none', generator: null });
  });

  it('tidak membocorkan referensi rahasia mentah', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/connections' });
    expect(response.body).not.toContain('dpapi:youtube');
  });

  it('meneruskan status tidak terjangkau dari probe', async () => {
    const offline = Fastify();
    await offline.register(connectionRoutes, {
      db,
      config: loadConfig({ FLOW_ADAPTER: 'real' }),
      probeFlow: async () => ({
        reachable: false,
        pageOpen: false,
        promptPresent: false,
        submitPresent: false,
        challengeDetected: false,
        detail: 'connect ECONNREFUSED 127.0.0.1:9222'
      }),
      readUsage: () => ({
        guard: { maxPerDay: 1, requireConfirm: true, dryRun: false },
        usedToday: 0,
        day: '2026-11-01'
      })
    });
    await offline.ready();

    const response = await offline.inject({ method: 'GET', url: '/api/v1/connections' });
    expect(response.json<ConnectionsPayload>().flow.reachable).toBe(false);
    await offline.close();
  });
});
