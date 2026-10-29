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
import { healthRoutes } from './routes/health';
import { jobRoutes } from './routes/jobs';

export interface BuildAppOptions {
  db: DatabaseHandle;
  config: AppConfig;
  logger?: Logger;
  version?: string;
}

function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: unknown[] = []
) {
  return { error: { code, message, requestId, details } };
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { db, logger, version = '0.1.0' } = options;

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
          request.id
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

  void app.register(healthRoutes, { db, version });
  void app.register(jobRoutes, { db });

  return app;
}
