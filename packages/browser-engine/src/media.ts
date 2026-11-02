import { createHash } from 'node:crypto';
import { createReadStream, openSync, closeSync, readSync, statSync } from 'node:fs';
import { AppError, type MediaKind } from '@saa/domain';
import type { MediaProbe } from './types';
import { assertInsideRoot } from './storage';

const DEFAULT_MIN_BYTES = 1_024;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MP4_FTYP_OFFSET = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export interface ValidateMediaOptions {
  root: string;
  path: string;
  /** Default `video` agar pemanggil lama tidak perlu berubah (ADR-0012). */
  kind?: MediaKind;
  /** Checksum yang dijanjikan generator; bila diisi wajib cocok. */
  expectedSha256?: string;
  minBytes?: number;
  maxBytes?: number;
  probe?: MediaProbe;
}

export interface ValidMedia {
  filePath: string;
  mimeType: 'video/mp4' | 'image/png' | 'image/jpeg';
  kind: MediaKind;
  sizeBytes: number;
  sha256: string;
  durationMs: number | null;
  probeAvailable: boolean;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function readHead(filePath: string, length: number): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(length);
    const read = readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function hasFtypHeader(filePath: string): boolean {
  const head = readHead(filePath, MP4_FTYP_OFFSET + 4);
  if (head.length < MP4_FTYP_OFFSET + 4) return false;
  return head.toString('ascii', MP4_FTYP_OFFSET, MP4_FTYP_OFFSET + 4) === 'ftyp';
}

function imageMimeType(filePath: string): 'image/png' | 'image/jpeg' | null {
  const head = readHead(filePath, PNG_SIGNATURE.length);
  if (head.length >= PNG_SIGNATURE.length && head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (head.length >= JPEG_SIGNATURE.length && head.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  return null;
}

/**
 * Validasi berkas media sebelum disimpan sebagai aset.
 * Urutan: containment → keberadaan/ukuran → magic (MP4 ftyp / PNG / JPEG) →
 * checksum → probe (hanya video).
 */
export async function validateMediaFile(options: ValidateMediaOptions): Promise<ValidMedia> {
  const kind = options.kind ?? 'video';
  const filePath = assertInsideRoot(options.root, options.path);
  const minBytes = options.minBytes ?? DEFAULT_MIN_BYTES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let sizeBytes: number;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      throw new AppError('VALIDATION', `media ${filePath} bukan berkas biasa`);
    }
    sizeBytes = stat.size;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION', `media ${filePath} tidak dapat dibaca`, { cause: error });
  }

  if (sizeBytes < minBytes || sizeBytes > maxBytes) {
    throw new AppError(
      'VALIDATION',
      `ukuran media ${sizeBytes} byte di luar batas ${minBytes}..${maxBytes}`
    );
  }

  let mimeType: ValidMedia['mimeType'];
  if (kind === 'video') {
    if (!hasFtypHeader(filePath)) {
      throw new AppError('VALIDATION', `media ${filePath} bukan berkas MP4 (header ftyp tidak ada)`);
    }
    mimeType = 'video/mp4';
  } else {
    const detected = imageMimeType(filePath);
    if (detected === null) {
      throw new AppError(
        'VALIDATION',
        `media ${filePath} bukan berkas gambar PNG/JPEG (signature tidak cocok)`
      );
    }
    mimeType = detected;
  }

  const sha256 = await sha256File(filePath);
  if (options.expectedSha256 !== undefined && options.expectedSha256.toLowerCase() !== sha256) {
    throw new AppError(
      'VALIDATION',
      `checksum media tidak cocok: diharapkan ${options.expectedSha256}, aktual ${sha256}`
    );
  }

  let durationMs: number | null = null;
  let probeAvailable = false;
  if (kind === 'video' && options.probe !== undefined) {
    const result = await options.probe.probe(filePath);
    probeAvailable = result.available;
    durationMs = result.available ? result.durationMs : null;
    if (durationMs !== null && durationMs <= 0) {
      throw new AppError('VALIDATION', `durasi media tidak valid: ${durationMs} ms`);
    }
  }

  return { filePath, mimeType, kind, sizeBytes, sha256, durationMs, probeAvailable };
}
