import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError } from '@saa/domain';
import { assertInsideRoot } from './storage';
import type { GeneratedVideo, VideoGenerationRequest, VideoGenerator } from './types';

const MIN_DURATION_MS = 8_000;
const MAX_DURATION_SPAN_MS = 12_000;
const MIN_PAYLOAD_BYTES = 4_096;
const PAYLOAD_SPAN_BYTES = 8_192;
const CHUNK_BYTES = 32;

interface Box {
  type: string;
  payload: Buffer;
}

function encodeBox(box: Box): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(box.payload.length + 8, 0);
  head.write(box.type, 4, 'ascii');
  return Buffer.concat([head, box.payload]);
}

function ftypBox(): Buffer {
  const payload = Buffer.alloc(24);
  payload.write('isom', 0, 'ascii');
  payload.writeUInt32BE(512, 4);
  payload.write('isom', 8, 'ascii');
  payload.write('iso2', 12, 'ascii');
  payload.write('avc1', 16, 'ascii');
  payload.write('mp41', 20, 'ascii');
  return encodeBox({ type: 'ftyp', payload });
}

/**
 * Byte "video" deterministik: sha256 berantai dari kunci permintaan.
 * Mock ini tidak memproduksi video nyata — hanya artefak MP4-shaped yang stabil
 * agar pipeline validasi, checksum, dan idempotensi bisa diuji tanpa Flow.
 */
function deterministicPayload(digest: Buffer): Buffer {
  const length = MIN_PAYLOAD_BYTES + (digest.readUInt16BE(0) % PAYLOAD_SPAN_BYTES);
  const chunks: Buffer[] = [];
  let seed = digest;
  let written = 0;
  while (written < length) {
    const chunk = createHash('sha256').update(seed).digest();
    chunks.push(chunk);
    seed = chunk;
    written += chunk.length;
  }
  return Buffer.concat(chunks).subarray(0, length);
}

function requestKey(request: VideoGenerationRequest): string {
  return `${request.aspectRatio}|${request.prompt}|${request.correlationId}`;
}

function safeFileName(correlationId: string): string {
  const cleaned = correlationId.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length === 0 ? 'video' : cleaned;
}

export interface MockVideoGeneratorOptions {
  /** Direktori akar; setiap `outputDirectory` permintaan wajib berada di dalamnya. */
  outputRoot: string;
}

export class MockVideoGenerator implements VideoGenerator {
  constructor(private readonly options: MockVideoGeneratorOptions) {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async generate(request: VideoGenerationRequest): Promise<GeneratedVideo> {
    const directory = assertInsideRoot(this.options.outputRoot, request.outputDirectory);
    const digest = createHash('sha256').update(requestKey(request)).digest();
    const payload = deterministicPayload(digest);
    const video = Buffer.concat([ftypBox(), encodeBox({ type: 'mdat', payload })]);
    // Nama memuat sidik permintaan agar prompt baru tidak menimpa artefak lama.
    const filePath = join(directory, `${safeFileName(request.correlationId)}_${digest.subarray(0, 6).toString('hex')}.mp4`);

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, video);
    } catch (error) {
      throw new AppError('DISK', `gagal menulis video mock ke ${filePath}`, { cause: error });
    }

    return {
      filePath,
      mimeType: 'video/mp4',
      sizeBytes: video.length,
      sha256: createHash('sha256').update(video).digest('hex'),
      durationMs: MIN_DURATION_MS + (digest.readUInt16BE(2) % MAX_DURATION_SPAN_MS)
    };
  }
}
