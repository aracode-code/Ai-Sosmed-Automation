import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@saa/domain';

const LOCK_FILE_NAME = '.worker-lock.json';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface LockPayload {
  ownerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
}

export class ProfileBusyError extends AppError {
  constructor(
    readonly ownerId: string,
    readonly expiresAt: string
  ) {
    super('RESOURCE_BUSY', `profil browser dipakai worker ${ownerId} sampai ${expiresAt}`);
    this.name = 'ProfileBusyError';
  }
}

export interface AcquireProfileLockOptions {
  /** Direktori profil browser; satu profil hanya boleh dipakai satu worker. */
  directory: string;
  ownerId: string;
  ttlMs?: number;
  now?: () => Date;
}

export interface ProfileLock {
  readonly ownerId: string;
  readonly token: string;
  readonly path: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  /** Hanya pemilik token yang boleh melepas; lock milik worker lain dibiarkan. */
  release(): boolean;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readLock(path: string): LockPayload | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockPayload>;
    if (
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.acquiredAt !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      token: parsed.token,
      acquiredAt: parsed.acquiredAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}

/**
 * Lock eksklusif berbasis berkas (`wx`). Lock yang kedaluwarsa atau rusak
 * diambil alih lewat rename atomik — worker yang mati tidak boleh memblokir
 * profil selamanya.
 */
export function acquireProfileLock(options: AcquireProfileLockOptions): ProfileLock {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => new Date());
  const acquiredAt = now().toISOString();
  const payload: LockPayload = {
    ownerId: options.ownerId,
    token: randomUUID(),
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString()
  };
  const body = JSON.stringify(payload);

  mkdirSync(options.directory, { recursive: true });
  const path = join(options.directory, LOCK_FILE_NAME);

  try {
    writeFileSync(path, body, { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw new AppError('DISK', `gagal membuat lock profil di ${path}`, { cause: error });
    }

    const existing = readLock(path);
    if (existing !== null && Date.parse(existing.expiresAt) > Date.parse(acquiredAt)) {
      throw new ProfileBusyError(existing.ownerId, existing.expiresAt);
    }

    const temp = `${path}.${payload.token}.tmp`;
    try {
      writeFileSync(temp, body, { flag: 'wx' });
      renameSync(temp, path);
    } catch (stealError) {
      try {
        unlinkSync(temp);
      } catch {
        // temp belum sempat dibuat
      }
      throw new AppError('DISK', `gagal mengambil alih lock profil ${path}`, { cause: stealError });
    }
  }

  return {
    ownerId: payload.ownerId,
    token: payload.token,
    path,
    acquiredAt: payload.acquiredAt,
    expiresAt: payload.expiresAt,
    release(): boolean {
      const current = readLock(path);
      if (current === null || current.token !== payload.token) return false;
      try {
        unlinkSync(path);
        return true;
      } catch (error) {
        return errorCode(error) === 'ENOENT';
      }
    }
  };
}
