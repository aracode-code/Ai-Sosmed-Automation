import type { FastifyPluginAsync } from 'fastify';
import { PLATFORM_IDS, type PlatformId } from '@saa/domain';
import {
  getCampaign,
  insertCampaign,
  listCampaigns,
  listContentByCampaign,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface CampaignRoutesDeps {
  db: DatabaseHandle;
}

const platformSchema = z
  .string()
  .refine((value) => (PLATFORM_IDS as readonly string[]).includes(value), {
    message: 'platform tidak dikenal'
  })
  .transform((value) => value as PlatformId);

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  niche: z.string().trim().min(1).max(120),
  approvalMode: z.enum(['automatic', 'required']).default('required'),
  platforms: z.array(platformSchema).min(1).max(PLATFORM_IDS.length)
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export const campaignRoutes: FastifyPluginAsync<CampaignRoutesDeps> = async (app, deps) => {
  app.post('/api/v1/campaigns', async (request, reply) => {
    const body = createCampaignSchema.parse(request.body);
    const campaign = insertCampaign(deps.db.raw, {
      name: body.name,
      niche: body.niche,
      approvalMode: body.approvalMode,
      platforms: [...new Set(body.platforms)]
    });
    return reply.status(202).send({ campaignId: campaign.id, status: 'created' });
  });

  app.get('/api/v1/campaigns', async () => ({
    items: listCampaigns(deps.db.raw),
    nextCursor: null
  }));

  app.get('/api/v1/campaigns/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const campaign = getCampaign(deps.db.raw, id);
    if (campaign === null) {
      return reply
        .status(404)
        .send(errorEnvelope('NOT_FOUND', `campaign ${id} tidak ditemukan`, String(request.id)));
    }
    return { campaign, content: listContentByCampaign(deps.db.raw, id) };
  });
};
