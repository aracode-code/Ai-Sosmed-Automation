import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AppError, type AspectRatio, type MediaKind } from '@saa/domain';
import { assertInsideRoot } from './storage';
import type { GeneratedMedia, MediaGenerationRequest, MediaGenerator } from './types';

const MIN_DURATION_MS = 8_000;
const MAX_DURATION_SPAN_MS = 12_000;
const MIN_PAYLOAD_BYTES = 4_096;
const PAYLOAD_SPAN_BYTES = 8_192;

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
 * Byte deterministik berantai dari digest permintaan. Dipakai baik untuk payload
 * MP4 maupun piksel PNG agar artefak mock stabil tanpa RNG global.
 */
function deterministicBytes(digest: Buffer, length: number): Buffer {
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

function videoBytes(digest: Buffer): Buffer {
  const length = MIN_PAYLOAD_BYTES + (digest.readUInt16BE(0) % PAYLOAD_SPAN_BYTES);
  return Buffer.concat([ftypBox(), encodeBox({ type: 'mdat', payload: deterministicBytes(digest, length) })]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function imageDimensions(aspectRatio: AspectRatio): { width: number; height: number } {
  if (aspectRatio === '9:16') return { width: 72, height: 128 };
  if (aspectRatio === '16:9') return { width: 128, height: 72 };
  return { width: 96, height: 96 };
}

/** PNG RGB 8-bit yang benar-benar dapat dibuka; ukuran mengikuti rasio permintaan. */
function imageBytes(digest: Buffer, aspectRatio: AspectRatio): Buffer {
  const { width, height } = imageDimensions(aspectRatio);
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  const pixels = deterministicBytes(digest, width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * width * 3, (y + 1) * width * 3);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function requestKey(request: MediaGenerationRequest): string {
  return `${request.kind ?? 'video'}|${request.aspectRatio}|${request.prompt}|${request.correlationId}`;
}

function safeFileName(correlationId: string): string {
  const cleaned = correlationId.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length === 0 ? 'media' : cleaned;
}

export interface MockMediaGeneratorOptions {
  /** Direktori akar; setiap `outputDirectory` permintaan wajib berada di dalamnya. */
  outputRoot: string;
}

/**
 * Mock deterministik untuk dua jenis media: MP4-shaped untuk video dan PNG valid
 * untuk gambar. Tidak memproduksi karya nyata — hanya artefak stabil agar pipeline
 * validasi, checksum, idempotensi, dan UI dapat diuji tanpa Flow.
 */
export class MockMediaGenerator implements MediaGenerator {
  constructor(private readonly options: MockMediaGeneratorOptions) {}

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async generate(request: MediaGenerationRequest): Promise<GeneratedMedia> {
    const kind: MediaKind = request.kind ?? 'video';
    const directory = assertInsideRoot(this.options.outputRoot, request.outputDirectory);
    const digest = createHash('sha256').update(requestKey(request)).digest();

    const bytes = kind === 'image' ? imageBytes(digest, request.aspectRatio) : videoBytes(digest);
    const fileName = `${safeFileName(request.correlationId)}_${digest.subarray(0, 6).toString('hex')}.${
      kind === 'image' ? 'png' : 'mp4'
    }`;
    const filePath = join(directory, fileName);

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, bytes);
    } catch (error) {
      throw new AppError('DISK', `gagal menulis ${kind} mock ke ${filePath}`, { cause: error });
    }

    return {
      filePath,
      mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(kind === 'video'
        ? { durationMs: MIN_DURATION_MS + (digest.readUInt16BE(2) % MAX_DURATION_SPAN_MS) }
        : {})
    };
  }
}
