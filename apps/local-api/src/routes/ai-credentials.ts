import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AiCredentialManager } from '../ai-credentials';

const saveSchema = z
  .object({
    apiKey: z.string().trim().min(10).max(200)
  })
  .strict();

export interface AiCredentialRoutesDeps {
  credentials: AiCredentialManager;
}

/** Status baca-saja + penyimpanan kunci tulis-saja. Nilai kunci tidak pernah dikembalikan. */
export const aiCredentialRoutes: FastifyPluginAsync<AiCredentialRoutesDeps> = async (
  app,
  deps
) => {
  app.get('/api/v1/ai/status', async () => {
    // `resolve` memuat kunci bila belum pernah dibaca (mis. app dirakit tanpa server).
    await deps.credentials.resolve();
    return deps.credentials.status();
  });

  app.post('/api/v1/ai/credentials', async (request, reply) => {
    const body = saveSchema.parse(request.body);
    await deps.credentials.save(body.apiKey);
    return reply.status(200).send({ configured: true, source: 'store' });
  });
};
