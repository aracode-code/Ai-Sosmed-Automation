import { join } from 'node:path';
import { AppError } from '@saa/domain';
import {
  unavailableProbe,
  validateMediaFile,
  type MediaProbe,
  type VideoGenerator
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

export interface GenerateVideoDeps {
  db: DatabaseHandle;
  /** Kontrak LLD §10.1; adapter Flow asli belum aktif (OD-1). */
  generator: VideoGenerator;
  /** Akar penyimpanan media; berkas di luar akar ditolak. */
  outputRoot: string;
  probe?: MediaProbe;
  now?: () => Date;
}

/**
 * Handler langkah GENERATE_VIDEO: satu job = satu langkah workflow (LLD §4.1).
 * Hasil generator dimaterialkan ke disk lebih dulu, baru dicatat sebagai aset.
 */
export function createGenerateVideoHandler(deps: GenerateVideoDeps): JobHandler {
  const probe = deps.probe ?? unavailableProbe;

  return async (ctx) => {
    const parsed = payloadSchema.safeParse(ctx.job.payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'payload GENERATE_VIDEO tidak valid', {
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
        availability.reason ?? 'generator video sedang tidak tersedia'
      );
    }

    const generated = await deps.generator.generate({
      prompt: parsed.data.videoPrompt,
      aspectRatio: parsed.data.aspectRatio,
      outputDirectory: join('content', content.id),
      correlationId: ctx.job.id
    });

    const media = await validateMediaFile({
      root: deps.outputRoot,
      path: generated.filePath,
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
      // Probe absen → durasi yang dilaporkan generator, bukan hasil ukur.
      durationMs: media.durationMs ?? generated.durationMs ?? null,
      validationStatus: 'valid'
    });

    ctx.transition({ type: 'STEP_COMPLETED' }, { contentId: content.id, lastErrorCode: null });
  };
}
