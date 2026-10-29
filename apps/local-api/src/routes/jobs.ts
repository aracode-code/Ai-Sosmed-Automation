import type { FastifyPluginAsync } from 'fastify';
import { JOB_STATUSES, type JobStatus } from '@saa/domain';
import { getJob, listJobs, type DatabaseHandle } from '@saa/database';
import { z } from 'zod';

export interface JobRoutesDeps {
  db: DatabaseHandle;
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
};
