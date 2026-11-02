import { join } from 'node:path';
import { AppError, type MediaKind } from '@saa/domain';
import {
  unavailableProbe,
  validateMediaFile,
  type MediaGenerator,
  type MediaProbe
} from '@saa/browser-engine';
import {
  getContentItem,
  upsertMediaAsset,
  type DatabaseHandle
} from '@saa/database';
import { z } from 'zod';
import type { JobHandler } from '../dispatcher';

const payloadSchema = z.object({
  contentId: z.string().min(1).max(100),
  campaignId: z.string().min(1).max(100),
  videoPrompt: z.string().min(1).max(4000),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16'),
  targets: z.array(z.unknown()).optional()
});

export interface GenerateMediaDeps {
  db: DatabaseHandle;
  generator: MediaGenerator;
  /** Akar penyimpanan media; berkas di luar akar ditolak. */
  outputRoot: string;
  probe?: MediaProbe;
}

const JOB_TYPE_BY_KIND: Record<MediaKind, 'GENERATE_VIDEO' | 'GENERATE_IMAGE'> = {
  video: 'GENERATE_VIDEO',
  image: 'GENERATE_IMAGE'
};

/**
 * Handler langkah produksi media: satu job = satu langkah workflow (LLD §4.1).
 * Jenis artefak ditentukan oleh campaign (ADR-0012), bukan oleh payload job.
 * Hasil generator dimaterialkan ke disk lebih dulu, baru dicatat sebagai aset.
 */
export function createGenerateMediaHandler(
  deps: GenerateMediaDeps,
  kind: MediaKind
): JobHandler {
  const probe = deps.probe ?? unavailableProbe;
  const jobType = JOB_TYPE_BY_KIND[kind];

  return async (ctx) => {
    const parsed = payloadSchema.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION', `payload ${jobType} tidak valid`, {
        cause: parsed.error
      });
    }

    const content = getContentItem(deps.db.raw, parsed.data.contentId);
    if (content === null) {
      throw new AppError('VALIDATION', `konten ${parsed.data.contentId} tidak ditemukan`);
    }
    if (content.campaignId !== parsed.data.campaignId) {
      throw new AppError(
        'VALIDATION',
        `konten ${content.id} bukan milik campaign ${parsed.data.campaignId}`
      );
    }

    ctx.transition({ type: 'START_GENERATION' });

    const availability = await deps.generator.checkAvailability();
    if (!availability.available) {
      throw new AppError(
        'RESOURCE_BUSY',
        availability.reason ?? `generator ${kind} sedang tidak tersedia`
      );
    }

    const generated = await deps.generator.generate({
      kind,
      prompt: parsed.data.videoPrompt,
      aspectRatio: parsed.data.aspectRatio,
      outputDirectory: join('content', content.id),
      correlationId: ctx.job.id
    });

    const media = await validateMediaFile({
      root: deps.outputRoot,
      path: generated.filePath,
      kind,
      expectedSha256: generated.sha256,
      probe
    });

    upsertMediaAsset(deps.db.raw, {
      id: `med_${content.id}`,
      contentId: content.id,
      path: media.filePath,
      sha256: media.sha256,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      // Probe absen → durasi yang dilaporkan generator, bukan hasil ukur. Gambar tanpa durasi.
      durationMs: kind === 'video' ? (media.durationMs ?? generated.durationMs ?? null) : null,
      validationStatus: 'valid'
    });

    ctx.transition({ type: 'STEP_COMPLETED' }, { contentId: content.id, lastErrorCode: null });
  };
}
