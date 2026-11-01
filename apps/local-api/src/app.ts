import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions
} from 'fastify';
import type { Logger } from '@saa/observability';
import type { DatabaseHandle } from '@saa/database';
import { ZodError } from 'zod';
import type { AppConfig } from './config';
import { errorEnvelope } from './errors';
import { accountRoutes } from './routes/accounts';
import { approvalRoutes } from './routes/approvals';
import { campaignRoutes } from './routes/campaigns';
import { contentRoutes } from './routes/content';
import { dashboardRoutes } from './routes/dashboard';
import { healthRoutes } from './routes/health';
import { jobRoutes } from './routes/jobs';
import { scheduleRoutes } from './routes/schedules';

export interface BuildAppOptions {
  db: DatabaseHandle;
  config: AppConfig;
  logger?: Logger;
  version?: string;
  now?: () => Date;
  /** Status worker nyata; tanpa callback, health melaporkan 0 worker aktif. */
  workerActive?: () => boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const {
    db,
    logger,
    version = '0.1.0',
    now = () => new Date(),
    workerActive
  } = options;

  const fastifyOptions: FastifyServerOptions =
    logger === undefined ? { logger: false } : { loggerInstance: logger };
  const app = Fastify({ ...fastifyOptions, genReqId: () => `req_${randomUUID()}` });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(
        errorEnvelope(
          'NOT_FOUND',
          `route ${request.method} ${request.url} tidak ditemukan`,
          String(request.id)
        )
      );
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const requestId = String(request.id);

    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            'VALIDATION_ERROR',
            'Request tidak valid',
            requestId,
            error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message
            }))
          )
        );
    }

    if (error.validation !== undefined) {
      return reply
        .status(400)
        .send(errorEnvelope('VALIDATION_ERROR', 'Request tidak valid', requestId, error.validation));
    }

    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, requestId }, 'request gagal');

    return reply.status(statusCode).send(
      errorEnvelope(
        statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        statusCode >= 500 ? 'Terjadi kesalahan internal' : error.message,
        requestId
      )
    );
  });

  void app.register(healthRoutes, {
    db,
    version,
    ...(workerActive === undefined ? {} : { workerActive })
  });
  void app.register(jobRoutes, { db });
  void app.register(campaignRoutes, { db });
  void app.register(contentRoutes, { db, now });
  void app.register(dashboardRoutes, { db, now });
  void app.register(approvalRoutes, { db });
  void app.register(scheduleRoutes, { db, now });
  void app.register(accountRoutes, { db });

  return app;
}
