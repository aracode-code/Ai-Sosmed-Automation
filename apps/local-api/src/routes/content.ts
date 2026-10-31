import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { hashCaption } from '@saa/domain';
import {
  getCampaign,
  getContentItem,
  getJobByIdempotencyKey,
  hasActiveJobForCampaign,
  hasJobForContent,
  insertJobIdempotent,
  listContentByCampaign,
  listMediaByContent,
  listSocialAccounts,
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

const detailParamsSchema = z.object({ id: z.string().min(1) });

const detailQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional()
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

  /**
   * Bahan tinjauan approval: konten versi tertentu (default terbaru), ringkasan aset
   * tanpa path filesystem, hash caption yang dihitung server, dan akun kandidat
   * sesuai platform campaign. UI hanya memantulkan nilai ini ke route approve/reject.
   */
  app.get('/api/v1/content/:id', async (request, reply) => {
    const { id } = detailParamsSchema.parse(request.params);
    const { version } = detailQuerySchema.parse(request.query);
    const requestId = String(request.id);

    const content = getContentItem(deps.db.raw, id, version);
    if (content === null) {
      return reply
        .status(404)
        .send(
          errorEnvelope(
            'NOT_FOUND',
            version === undefined ? `konten ${id} tidak ditemukan` : `konten ${id} v${version} tidak ditemukan`,
            requestId
          )
        );
    }

    const campaign = getCampaign(deps.db.raw, content.campaignId);
    if (campaign === null) {
      return reply
        .status(404)
        .send(
          errorEnvelope('NOT_FOUND', `campaign ${content.campaignId} tidak ditemukan`, requestId)
        );
    }

    const assets = listMediaByContent(deps.db.raw, content.id).map((asset) => ({
      id: asset.id,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
      validationStatus: asset.validationStatus
    }));

    const accounts = listSocialAccounts(deps.db.raw)
      .filter((account) => campaign.platforms.includes(account.platform))
      .map((account) => ({
        id: account.id,
        platform: account.platform,
        label: account.label,
        connectionStatus: account.connectionStatus
      }));

    return {
      content,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        platforms: campaign.platforms,
        approvalMode: campaign.approvalMode,
        status: campaign.status
      },
      assets,
      captionHash: hashCaption(content.caption),
      accounts
    };
  });
};
