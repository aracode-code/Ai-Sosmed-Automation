import type { FastifyPluginAsync } from 'fastify';
import { JOB_STATUSES, transitionJob, type JobStatus } from '@saa/domain';
import {
  appendAudit,
  applyTransition,
  getJob,
  listJobs,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface JobRoutesDeps {
  db: DatabaseHandle;
  now?: () => Date;
}

const statusSchema = z
  .string()
  .refine((value) => (JOB_STATUSES as readonly string[]).includes(value), {
    message: 'status job tidak dikenal'
  })
  .transform((value) => value as JobStatus);

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional()
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export const jobRoutes: FastifyPluginAsync<JobRoutesDeps> = async (app, deps) => {
  app.get('/api/v1/jobs', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return listJobs(deps.db.raw, query);
  });

  app.get('/api/v1/jobs/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const job = getJob(deps.db.raw, id);
    if (job === null) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `job ${id} tidak ditemukan`,
          requestId: request.id,
          details: []
        }
      });
    }
    return job;
  });

  /**
   * Retry aman: hanya `NEEDS_ATTENTION` → `QUEUED`. Job yang masih berjalan atau
   * sudah selesai tidak diulang, dan percobaan direset agar kebijakan maxAttempts
   * berlaku lagi dari awal.
   */
  app.post('/api/v1/jobs/:id/retry', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const requestId = String(request.id);
    const job = getJob(deps.db.raw, id);
    if (job === null) {
      return reply
        .status(404)
        .send(errorEnvelope('NOT_FOUND', `job ${id} tidak ditemukan`, requestId));
    }
    if (job.status !== 'NEEDS_ATTENTION') {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'NOT_RETRYABLE',
            `job ${id} berstatus ${job.status}; hanya NEEDS_ATTENTION yang dapat diulang aman`,
            requestId
          )
        );
    }

    const transition = transitionJob(job.status, { type: 'RECOVER_REQUEUE' });
    if (!transition.ok) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'NOT_RETRYABLE',
            `transisi ${job.status} → QUEUED ditolak state machine`,
            requestId
          )
        );
    }

    const nowIso = (deps.now ?? (() => new Date()))().toISOString();
    const updated = applyTransition(deps.db.raw, {
      jobId: job.id,
      from: job.status,
      to: transition.status,
      now: nowIso,
      patch: { attempts: 0, lastErrorCode: null, runAt: nowIso, clearLease: true }
    });
    if (updated === null) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'CONCURRENT_UPDATE',
            'job berubah saat retry; muat ulang lalu coba lagi',
            requestId
          )
        );
    }

    appendAudit(
      deps.db.raw,
      {
        actorType: 'user',
        actorId: 'local-user',
        action: 'job.retry',
        resourceType: 'job',
        resourceId: job.id,
        result: 'success',
        metadata: { from: job.status, to: updated.status }
      },
      nowIso
    );

    return reply.status(202).send({ jobId: updated.id, status: 'queued' });
  });
};
