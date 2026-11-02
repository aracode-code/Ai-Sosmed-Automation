import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, type MediaKind } from '@saa/domain';
import { generateFlowMedia, type FlowGenerateResult } from './flow-generator';
import { inspectFlowReady, type FlowReadiness } from './flow-readiness';
import type { GeneratedMedia, MediaGenerationRequest, MediaGenerator } from './types';

/**
 * Generator media nyata lewat studio Flow (video: tab `Video`/Veo, gambar: tab
 * `Gambar`/Nano Banana). Memakai browser yang sudah login dan di-attach via CDP;
 * tidak menangani CAPTCHA dan tidak mengubah setelan akun.
 */

const DEFAULT_RENDER_TIMEOUT_MS: Record<MediaKind, number> = {
  video: 15 * 60_000,
  image: 5 * 60_000
};

export interface FlowPlaywrightGeneratorOptions {
  /** Endpoint CDP Chrome yang sudah login, mis. `http://127.0.0.1:9222`. */
  endpoint: string;
  /** Akar keluaran; berkas disimpan di `<outputRoot>/<correlationId>/`. */
  outputRoot: string;
  renderTimeoutMs?: number;
  /** Injeksi untuk test: menggantikan pemanggilan studio. */
  generateMedia?: (options: {
    endpoint: string;
    prompt: string;
    kind: MediaKind;
    outputDirectory: string;
    aspectRatio?: '9:16' | '16:9' | '1:1';
    renderTimeoutMs?: number;
  }) => Promise<FlowGenerateResult>;
  /** Injeksi untuk test: menggantikan pemeriksaan kesiapan. */
  readiness?: (endpoint: string) => Promise<FlowReadiness>;
}

function mimeTypeOf(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export class FlowPlaywrightGenerator implements MediaGenerator {
  private readonly endpoint: string;
  private readonly outputRoot: string;
  private readonly renderTimeoutMs: number | undefined;
  private readonly runGenerate: NonNullable<FlowPlaywrightGeneratorOptions['generateMedia']>;
  private readonly runReadiness: NonNullable<FlowPlaywrightGeneratorOptions['readiness']>;

  constructor(options: FlowPlaywrightGeneratorOptions) {
    this.endpoint = options.endpoint;
    this.outputRoot = options.outputRoot;
    this.renderTimeoutMs = options.renderTimeoutMs;
    this.runGenerate = options.generateMedia ?? generateFlowMedia;
    this.runReadiness = options.readiness ?? inspectFlowReady;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const ready = await this.runReadiness(this.endpoint);
      if (ready.challengeDetected) {
        return { available: false, reason: 'Flow menampilkan tantangan verifikasi' };
      }
      if (!ready.promptPresent || !ready.submitPresent) {
        return {
          available: false,
          reason: 'komposer Flow tidak ditemukan; buka satu project dengan tab Video atau Gambar aktif'
        };
      }
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : 'browser Flow tidak dapat dihubungi'
      };
    }
  }

  async generate(request: MediaGenerationRequest): Promise<GeneratedMedia> {
    const kind = request.kind ?? 'video';
    const outputDirectory = join(this.outputRoot, request.correlationId);
    const result = await this.runGenerate({
      endpoint: this.endpoint,
      prompt: request.prompt,
      kind,
      outputDirectory,
      aspectRatio: request.aspectRatio,
      renderTimeoutMs: this.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS[kind]
    });

    const stats = statSync(result.filePath);
    if (stats.size === 0) {
      throw new AppError('DISK', `berkas hasil Flow kosong: ${result.filePath}`);
    }
    const sha256 = createHash('sha256').update(readFileSync(result.filePath)).digest('hex');

    return {
      filePath: result.filePath,
      mimeType: mimeTypeOf(result.filePath),
      sizeBytes: stats.size,
      sha256
    };
  }
}
