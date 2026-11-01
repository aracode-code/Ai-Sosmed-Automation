import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkFlowBrowser, resolveFlowBrowserChannel } from '@saa/browser-engine';
import { getSocialAccount, type DatabaseHandle } from '@saa/database';
import { loadYouTubeCredentials } from '../config';
import {
  ConnectActionInProgressError,
  ConnectActionNotRunningError,
  type ConnectActionController,
  type ConnectActionKind
} from '../connect-runner';
import { errorEnvelope } from '../errors';

export interface ConnectPreflight {
  ok: boolean;
  detail: string | null;
}

export interface ConnectActionRoutesDeps {
  runner: ConnectActionController;
  db: DatabaseHandle;
  preflightFlow?: () => Promise<ConnectPreflight>;
  hasYouTubeCredentials?: () => boolean;
  now?: () => Date;
}

const pairBodySchema = z
  .object({
    accountId: z.string().trim().min(1).max(64).optional(),
    label: z.string().trim().min(1).max(80).optional()
  })
  .strict()
  .refine((value) => (value.accountId === undefined) !== (value.label === undefined), {
    message: 'isi tepat satu: accountId atau label'
  });

const stopParamsSchema = z.object({ kind: z.enum(['flow-login', 'youtube-pair']) });

/**
 * Aksi connect dari UI. Proses dijalankan di mesin lokal dengan CLI yang sama
 * seperti terminal; endpoint ini tidak menerima kredensial dan tidak menembus
 * login/CAPTCHA. Semua aksi single-flight dan dibatasi waktu.
 */
export const connectActionRoutes: FastifyPluginAsync<ConnectActionRoutesDeps> = async (app, deps) => {
  const now = deps.now ?? (() => new Date());
  const preflightFlow = deps.preflightFlow ?? defaultFlowPreflight();
  const hasYouTubeCredentials = deps.hasYouTubeCredentials ?? (() => loadYouTubeCredentials() !== null);

  app.get('/api/v1/connections/actions', async () => ({
    generatedAt: now().toISOString(),
    actions: {
      flowLogin: deps.runner.snapshot('flow-login'),
      youtubePair: deps.runner.snapshot('youtube-pair')
    }
  }));

  app.post('/api/v1/connections/flow/login', async (request, reply) => {
    const preflight = await preflightFlow();
    if (!preflight.ok) {
      return reply
        .status(412)
        .send(
          errorEnvelope(
            'CONNECT_PREFLIGHT_FAILED',
            `browser tidak siap: ${preflight.detail ?? 'tidak diketahui'}`,
            String(request.id)
          )
        );
    }

    return startAction(deps.runner, 'flow-login', [], request, reply);
  });

  app.post('/api/v1/connections/youtube/pair', async (request, reply) => {
    const body = pairBodySchema.parse(request.body ?? {});

    if (body.accountId !== undefined) {
      const account = getSocialAccount(deps.db.raw, body.accountId);
      if (account === null) {
        return reply
          .status(400)
          .send(errorEnvelope('ACCOUNT_NOT_FOUND', `akun ${body.accountId} tidak ditemukan`, String(request.id)));
      }
      if (account.platform !== 'youtube') {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              'ACCOUNT_UNSUPPORTED',
              `akun ${account.id} bukan platform youtube (${account.platform})`,
              String(request.id)
            )
          );
      }
    }

    if (!hasYouTubeCredentials()) {
      return reply
        .status(412)
        .send(
          errorEnvelope(
            'MISSING_CREDENTIALS',
            'GOOGLE_OAUTH_CLIENT_ID belum di-set di environment; pairing tidak dapat dimulai dari UI',
            String(request.id)
          )
        );
    }

    const args =
      body.accountId !== undefined
        ? ['--account', body.accountId]
        : ['--label', body.label ?? ''];
    return startAction(deps.runner, 'youtube-pair', args, request, reply);
  });

  app.post('/api/v1/connections/actions/:kind/stop', async (request, reply) => {
    const { kind } = stopParamsSchema.parse(request.params);
    try {
      return { action: deps.runner.cancel(kind) };
    } catch (error) {
      if (error instanceof ConnectActionNotRunningError) {
        return reply
          .status(409)
          .send(
            errorEnvelope('CONNECT_ACTION_NOT_RUNNING', error.message, String(request.id))
          );
      }
      throw error;
    }
  });
};

function startAction(
  runner: ConnectActionController,
  kind: ConnectActionKind,
  args: readonly string[],
  request: FastifyRequest,
  reply: FastifyReply
): FastifyReply {
  try {
    return reply.status(202).send({ action: runner.start(kind, args) });
  } catch (error) {
    if (error instanceof ConnectActionInProgressError) {
      return reply
        .status(409)
        .send(errorEnvelope('CONNECT_ACTION_IN_PROGRESS', error.message, String(request.id)));
    }
    throw error;
  }
}

function defaultFlowPreflight(): () => Promise<ConnectPreflight> {
  return async () => {
    try {
      const channel = resolveFlowBrowserChannel();
      const browser = await checkFlowBrowser(channel);
      return browser.available
        ? { ok: true, detail: null }
        : { ok: false, detail: browser.reason ?? `browser ${channel} tidak tersedia` };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'pemeriksaan browser gagal'
      };
    }
  };
}
