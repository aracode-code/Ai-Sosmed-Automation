import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import {
  inspectFlowReady,
  parseFlowGuard,
  parseLedger,
  countUsageOn,
  dayOf,
  type FlowGuard,
  type UsageLedger
} from '@saa/browser-engine';
import { PLATFORM_IDS, type PlatformId } from '@saa/domain';
import { listSocialAccounts, type DatabaseHandle } from '@saa/database';
import type { AppConfig } from '../config';

export interface FlowProbeStatus {
  reachable: boolean;
  pageOpen: boolean;
  promptPresent: boolean;
  submitPresent: boolean;
  challengeDetected: boolean;
  detail: string | null;
}

export interface FlowUsageSnapshot {
  guard: FlowGuard;
  usedToday: number;
  day: string;
}

export interface ConnectionRoutesDeps {
  db: DatabaseHandle;
  config: AppConfig;
  probeFlow?: () => Promise<FlowProbeStatus>;
  readUsage?: () => FlowUsageSnapshot;
  now?: () => Date;
}

/** Read-only: status koneksi, tanpa kredensial dan tanpa aksi apa pun. */
export const connectionRoutes: FastifyPluginAsync<ConnectionRoutesDeps> = async (app, deps) => {
  const now = deps.now ?? (() => new Date());

  app.get('/api/v1/connections', async () => {
    const nowIso = now().toISOString();

    const probe: FlowProbeStatus = await (deps.probeFlow ?? defaultProbe(deps.config))();
    const usage: FlowUsageSnapshot = (deps.readUsage ?? defaultUsage)(nowIso);

    const accounts = listSocialAccounts(deps.db.raw).map((account) => ({
      id: account.id,
      platform: account.platform,
      label: account.label,
      connectionStatus: account.connectionStatus,
      hasSecretRef: account.secretRef !== null
    }));

    const flowSupported = deps.config.flowAdapter === 'real';
    const platforms = PLATFORM_IDS.map((platform: PlatformId) => ({
      id: platform,
      supported: platform === 'youtube',
      adapter:
        platform === 'youtube'
          ? deps.config.youtubeAdapter === 'off'
            ? 'off'
            : deps.config.youtubeAdapter
          : 'none',
      generator: platform === 'youtube' && flowSupported ? 'flow' : null
    }));

    return {
      generatedAt: nowIso,
      flow: {
        adapter: deps.config.flowAdapter,
        cdpEndpoint: deps.config.flowCdpEndpoint,
        privacy: deps.config.youtubeUploadPrivacy,
        appStatus: deps.config.youtubeAppStatus,
        ...probe
      },
      usage,
      accounts,
      platforms
    };
  });
};

function defaultProbe(config: AppConfig): () => Promise<FlowProbeStatus> {
  return async () => {
    try {
      const ready = await inspectFlowReady(config.flowCdpEndpoint);
      return {
        reachable: true,
        pageOpen: true,
        promptPresent: ready.promptPresent,
        submitPresent: ready.submitPresent,
        challengeDetected: ready.challengeDetected,
        detail: ready.url
      };
    } catch (error) {
      return {
        reachable: false,
        pageOpen: false,
        promptPresent: false,
        submitPresent: false,
        challengeDetected: false,
        detail: error instanceof Error ? error.message : 'CDP tidak dapat dihubungi'
      };
    }
  };
}

function defaultUsage(nowIso: string): FlowUsageSnapshot {
  const guard = parseFlowGuard();
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), 'data', 'flow-usage.json');
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const ledger: UsageLedger = parseLedger({ raw });
  return { guard, usedToday: countUsageOn(ledger, nowIso), day: dayOf(nowIso) };
}
