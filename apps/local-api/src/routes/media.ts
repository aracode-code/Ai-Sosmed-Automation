import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { assertInsideRoot } from '@saa/browser-engine';
import { getMediaAsset, type DatabaseHandle } from '@saa/database';
import { z } from 'zod';
import { errorEnvelope } from '../errors';

export interface MediaRoutesDeps {
  db: DatabaseHandle;
  /** Akar penyimpanan media; berkas di luar akar tidak pernah dikirim. */
  mediaRoot: string;
}

const paramsSchema = z.object({ id: z.string().min(1).max(200) });

const SERVED_MIME_TYPES = new Set(['video/mp4', 'image/png', 'image/jpeg']);

function safeFileName(value: string, fallback: string): string {
  const name = basename(value).replace(/[^A-Za-z0-9._-]+/g, '_');
  return name === '' || name === '.' || name === '..' ? fallback : name;
}

/**
 * Berkas hasil generasi (video/gambar) untuk ditinjau di UI. Path diambil dari
 * `media_assets` tetapi tetap divalidasi terhadap `MEDIA_ROOT` agar baris DB yang
 * rusak tidak dapat dipakai membaca berkas sembarang.
 */
export const mediaRoutes: FastifyPluginAsync<MediaRoutesDeps> = async (app, deps) => {
  app.get('/api/v1/media/:id/file', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const requestId = String(request.id);

    const asset = getMediaAsset(deps.db.raw, id);
    if (asset === null) {
      return reply
        .status(404)
        .send(errorEnvelope('NOT_FOUND', `aset media ${id} tidak ditemukan`, requestId));
    }

    if (!SERVED_MIME_TYPES.has(asset.mimeType)) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'MEDIA_UNSUPPORTED',
            `aset ${id} bertipe ${asset.mimeType}; hanya video/mp4 dan gambar PNG/JPEG yang disajikan`,
            requestId
          )
        );
    }

    let filePath: string;
    try {
      filePath = assertInsideRoot(deps.mediaRoot, asset.path);
    } catch {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            'MEDIA_OUTSIDE_ROOT',
            `aset ${id} menunjuk berkas di luar MEDIA_ROOT`,
            requestId
          )
        );
    }

    let sizeBytes: number;
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) throw new Error('bukan berkas biasa');
      sizeBytes = stat.size;
    } catch {
      return reply
        .status(404)
        .send(
          errorEnvelope('MEDIA_MISSING', `berkas aset ${id} tidak ada di disk`, requestId)
        );
    }

    const fileName = safeFileName(filePath, `media-${id}`);

    return reply
      .header('content-type', asset.mimeType)
      .header('content-length', String(sizeBytes))
      .header('content-disposition', `inline; filename="${fileName}"`)
      .header('x-media-sha256', asset.sha256)
      .send(createReadStream(filePath));
  });
};
