import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  getCampaign,
  getJobByIdempotencyKey,
  hasActiveJobForCampaign,
  hasJobForContent,
  insertJobIdempotent,
  listContentByCampaign,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface ContentRoutesDeps {
  db: DatabaseHandle;
  now?: () => Date;
}

const planBodySchema = z.object({
  campaignId: z.string().min(1).max(100),
  notes: z.string().trim().max(2000).optional(),
  /** Kunci idempoten opsional; tanpa ini setiap permintaan membuat job baru. */
  requestId: z.string().trim().min(1).max(100).optional()
});

/**
 * Pemicu produksi manual: membuat job `PLAN_CONTENT` di luar jadwal. Aturan
 * kedalaman satu yang sama dengan scheduler ditegakkan di sini agar permintaan
 * berulang tidak menumpuk perencanaan atau konten yang belum terbit.
 */
export const contentRoutes: FastifyPluginAsync<ContentRoutesDeps> = async (app, deps) => {
  const now = deps.now ?? (() => new Date());

  app.post('/api/v1/content', async (request, reply) => {
    const body = planBodySchema.parse(request.body);
    const requestId = String(request.id);

    const campaign = getCampaign(deps.db.raw, body.campaignId);
    if (campaign === null) {
      return reply
        .status(404)
        .send(errorEnvelope('NOT_FOUND', `campaign ${body.campaignId} tidak ditemukan`, requestId));
    }

    // Idempotensi diperiksa sebelum penjaga pipeline: pengulangan permintaan yang
    // sama harus mendapat job yang sama, bukan 409 karena job itu masih aktif.
    const idempotencyKey = `plan:manual:${campaign.id}:${body.requestId ?? randomUUID()}`;
    const existing = getJobByIdempotencyKey(deps.db.raw, idempotencyKey);
    if (existing !== null) {
      return reply.status(202).send({ jobId: existing.id, status: 'duplicate' });
    }

    if (campaign.status !== 'active') {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'CAMPAIGN_INACTIVE',
            `campaign ${campaign.id} berstatus ${campaign.status}`,
            requestId
          )
        );
    }
    if (campaign.platforms.length === 0) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'CAMPAIGN_NO_PLATFORM',
            `campaign ${campaign.id} tidak punya platform target`,
            requestId
          )
        );
    }
    if (hasActiveJobForCampaign(deps.db.raw, { campaignId: campaign.id, jobType: 'PLAN_CONTENT' })) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'PLAN_IN_PROGRESS',
            `campaign ${campaign.id} masih punya PLAN_CONTENT non-terminal`,
            requestId
          )
        );
    }
    const newest = listContentByCampaign(deps.db.raw, campaign.id)[0];
    if (
      newest !== undefined &&
      !hasJobForContent(deps.db.raw, { contentId: newest.id, jobType: 'PUBLISH' })
    ) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'PIPELINE_BUSY',
            `konten ${newest.id} belum punya job PUBLISH; slot produksi berikutnya ditahan`,
            requestId
          )
        );
    }

    const job = insertJobIdempotent(
      deps.db.raw,
      {
        jobType: 'PLAN_CONTENT',
        idempotencyKey,
        campaignId: campaign.id,
        payload: { campaignId: campaign.id, ...(body.notes === undefined ? {} : { notes: body.notes }) }
      },
      now().toISOString()
    );
    return reply.status(202).send({ jobId: job.id, status: 'queued' });
  });
};
