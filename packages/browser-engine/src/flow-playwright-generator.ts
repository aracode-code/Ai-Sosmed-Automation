import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@saa/domain';
import { generateFlowMedia, type FlowGenerateResult } from './flow-generator';
import { inspectFlowReady, type FlowReadiness } from './flow-readiness';
import type { GeneratedVideo, VideoGenerationRequest, VideoGenerator } from './types';

/**
 * Generator video nyata lewat studio Flow (tab `Video`, model default Veo).
 * Memakai browser yang sudah login dan di-attach via CDP; tidak menangani
 * CAPTCHA dan tidak mengubah setelan akun.
 */

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
    kind: 'video';
    outputDirectory: string;
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

export class FlowPlaywrightGenerator implements VideoGenerator {
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
          reason: 'komposer Flow tidak ditemukan; buka satu project dengan tab Video aktif'
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

  async generate(request: VideoGenerationRequest): Promise<GeneratedVideo> {
    const outputDirectory = join(this.outputRoot, request.correlationId);
    const result = await this.runGenerate({
      endpoint: this.endpoint,
      prompt: request.prompt,
      kind: 'video',
      outputDirectory,
      ...(this.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: this.renderTimeoutMs })
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
