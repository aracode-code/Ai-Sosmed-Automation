import { randomUUID } from 'node:crypto';
import type { PlatformId, PublishAttempt } from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface PublishAttemptRow {
  id: string;
  job_id: string;
  account_id: string;
  platform: string;
  idempotency_key: string;
  status: string;
  external_post_id: string | null;
  permalink: string | null;
  attempted_at: string;
  verified_at: string | null;
  error_code: string | null;
}

function toAttempt(row: PublishAttemptRow): PublishAttempt {
  return {
    id: row.id,
    jobId: row.job_id,
    accountId: row.account_id,
    platform: row.platform as PlatformId,
    idempotencyKey: row.idempotency_key,
    status: row.status as PublishAttempt['status'],
    externalPostId: row.external_post_id,
    permalink: row.permalink,
    attemptedAt: row.attempted_at,
    verifiedAt: row.verified_at,
    errorCode: row.error_code
  };
}

export interface InsertPublishAttemptInput {
  jobId: string;
  accountId: string;
  platform: PlatformId;
  idempotencyKey: string;
  status?: PublishAttempt['status'];
  id?: string;
}

/** Dicatat SEBELUM aksi eksternal; idempotency key unik mencegah dua attempt untuk aksi yang sama. */
export function insertPublishAttempt(
  raw: SqliteDatabase,
  input: InsertPublishAttemptInput,
  now: string = new Date().toISOString()
): PublishAttempt {
  const id = input.id ?? `pub_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO publish_attempts (
        id, job_id, account_id, platform, idempotency_key, status, attempted_at
      ) VALUES (
        @id, @jobId, @accountId, @platform, @idempotencyKey, @status, @attemptedAt
      )`
    )
    .run({
      id,
      jobId: input.jobId,
      accountId: input.accountId,
      platform: input.platform,
      idempotencyKey: input.idempotencyKey,
      status: input.status ?? 'pending',
      attemptedAt: now
    });

  const attempt = getPublishAttempt(raw, id);
  if (attempt === null) throw new Error(`publish attempt ${id} gagal disimpan`);
  return attempt;
}

export function getPublishAttempt(raw: SqliteDatabase, id: string): PublishAttempt | null {
  const row = raw.prepare('SELECT * FROM publish_attempts WHERE id = ?').get(id) as
    | PublishAttemptRow
    | undefined;
  return row ? toAttempt(row) : null;
}

export function getPublishAttemptByKey(
  raw: SqliteDatabase,
  idempotencyKey: string
): PublishAttempt | null {
  const row = raw
    .prepare('SELECT * FROM publish_attempts WHERE idempotency_key = ?')
    .get(idempotencyKey) as PublishAttemptRow | undefined;
  return row ? toAttempt(row) : null;
}

export interface UpdatePublishAttemptInput {
  id: string;
  status: PublishAttempt['status'];
  externalPostId?: string | null;
  permalink?: string | null;
  verifiedAt?: string | null;
  errorCode?: string | null;
}

export function updatePublishAttempt(
  raw: SqliteDatabase,
  input: UpdatePublishAttemptInput
): PublishAttempt | null {
  const sets = ['status = @status'];
  const values: Record<string, unknown> = { id: input.id, status: input.status };

  if (input.externalPostId !== undefined) {
    sets.push('external_post_id = @externalPostId');
    values.externalPostId = input.externalPostId;
  }
  if (input.permalink !== undefined) {
    sets.push('permalink = @permalink');
    values.permalink = input.permalink;
  }
  if (input.verifiedAt !== undefined) {
    sets.push('verified_at = @verifiedAt');
    values.verifiedAt = input.verifiedAt;
  }
  if (input.errorCode !== undefined) {
    sets.push('error_code = @errorCode');
    values.errorCode = input.errorCode;
  }

  raw.prepare(`UPDATE publish_attempts SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return getPublishAttempt(raw, input.id);
}
