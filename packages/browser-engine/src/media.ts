import { createHash } from 'node:crypto';
import { createReadStream, openSync, closeSync, readSync, statSync } from 'node:fs';
import { AppError } from '@saa/domain';
import type { MediaProbe } from './types';
import { assertInsideRoot } from './storage';

const DEFAULT_MIN_BYTES = 1_024;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MP4_FTYP_OFFSET = 4;

export interface ValidateMediaOptions {
  root: string;
  path: string;
  /** Checksum yang dijanjikan generator; bila diisi wajib cocok. */
  expectedSha256?: string;
  minBytes?: number;
  maxBytes?: number;
  probe?: MediaProbe;
}

export interface ValidMedia {
  filePath: string;
  mimeType: 'video/mp4';
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

function hasFtypHeader(filePath: string): boolean {
  const fd = openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    const read = readSync(fd, head, 0, head.length, 0);
    if (read < head.length) return false;
    return head.toString('ascii', MP4_FTYP_OFFSET, MP4_FTYP_OFFSET + 4) === 'ftyp';
  } finally {
    closeSync(fd);
  }
}

/**
 * Validasi berkas media sebelum disimpan sebagai aset.
 * Urutan: containment → keberadaan/ukuran → magic MP4 → checksum → probe opsional.
 */
export async function validateMediaFile(options: ValidateMediaOptions): Promise<ValidMedia> {
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

  if (!hasFtypHeader(filePath)) {
    throw new AppError('VALIDATION', `media ${filePath} bukan berkas MP4 (header ftyp tidak ada)`);
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
  if (options.probe !== undefined) {
    const result = await options.probe.probe(filePath);
    probeAvailable = result.available;
    durationMs = result.available ? result.durationMs : null;
    if (durationMs !== null && durationMs <= 0) {
      throw new AppError('VALIDATION', `durasi media tidak valid: ${durationMs} ms`);
    }
  }

  return { filePath, mimeType: 'video/mp4', sizeBytes, sha256, durationMs, probeAvailable };
}
