import { randomUUID } from 'node:crypto';
import {
  TERMINAL_STATUSES,
  transitionJob,
  type Job,
  type JobStatus,
  type JobType
} from '@saa/domain';
import type { SqliteDatabase } from '../client';

/** Daftar terminal diturunkan dari domain agar SQL tidak pernah drift. */
const TERMINAL_SQL = TERMINAL_STATUSES.map((status) => `'${status}'`).join(', ');

interface JobRow {
  id: string;
  campaign_id: string | null;
  content_id: string | null;
  parent_job_id: string | null;
  job_type: string;
  status: string;
  payload_json: string;
  run_at: string | null;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_until: string | null;
  idempotency_key: string;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contentId: row.content_id,
    parentJobId: row.parent_job_id,
    jobType: row.job_type as JobType,
    status: row.status as JobStatus,
    payload: parseJson(row.payload_json),
    runAt: row.run_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    idempotencyKey: row.idempotency_key,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface InsertJobInput {
  jobType: JobType;
  idempotencyKey: string;
  payload: unknown;
  campaignId?: string | null;
  contentId?: string | null;
  parentJobId?: string | null;
  status?: JobStatus;
  runAt?: string | null;
  maxAttempts?: number;
  id?: string;
}

export function insertJob(
  raw: SqliteDatabase,
  input: InsertJobInput,
  now: string = new Date().toISOString()
): Job {
  const id = input.id ?? `job_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO jobs (
        id, campaign_id, content_id, parent_job_id, job_type, status, payload_json,
        run_at, attempts, max_attempts, lease_owner, lease_until, idempotency_key,
        last_error_code, created_at, updated_at
      ) VALUES (
        @id, @campaignId, @contentId, @parentJobId, @jobType, @status, @payloadJson,
        @runAt, 0, @maxAttempts, NULL, NULL, @idempotencyKey,
        NULL, @now, @now
      )`
    )
    .run({
      id,
      campaignId: input.campaignId ?? null,
      contentId: input.contentId ?? null,
      parentJobId: input.parentJobId ?? null,
      jobType: input.jobType,
      status: input.status ?? 'QUEUED',
      payloadJson: JSON.stringify(input.payload ?? null),
      runAt: input.runAt ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      idempotencyKey: input.idempotencyKey,
      now
    });

  const job = getJob(raw, id);
  if (job === null) {
    throw new Error(`job ${id} gagal disimpan`);
  }
  return job;
}

export function getJob(raw: SqliteDatabase, id: string): Job | null {
  const row = raw.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function getJobByIdempotencyKey(raw: SqliteDatabase, key: string): Job | null {
  const row = raw.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as
    | JobRow
    | undefined;
  return row ? toJob(row) : null;
}

/**
 * Job non-terminal untuk campaign + tipe tertentu. `NEEDS_ATTENTION` dihitung
 * aktif: pekerjaan yang menunggu manusia tidak boleh ditumpuk job baru.
 */
export function hasActiveJobForCampaign(
  raw: SqliteDatabase,
  params: { campaignId: string; jobType: JobType }
): boolean {
  const row = raw
    .prepare(
      `SELECT 1 AS ditemukan FROM jobs
       WHERE campaign_id = @campaignId
         AND job_type = @jobType
         AND status NOT IN (${TERMINAL_SQL})
       LIMIT 1`
    )
    .get(params) as { ditemukan: number } | undefined;
  return row !== undefined;
}

export function hasJobForContent(
  raw: SqliteDatabase,
  params: { contentId: string; jobType: JobType }
): boolean {
  const row = raw
    .prepare(
      `SELECT 1 AS ditemukan FROM jobs
       WHERE content_id = @contentId
         AND job_type = @jobType
       LIMIT 1`
    )
    .get(params) as { ditemukan: number } | undefined;
  return row !== undefined;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/**
 * Insert yang aman diulang: retry handler tidak membuat job duplikat untuk
 * idempotency key yang sama, termasuk saat dua worker balapan.
 */
export function insertJobIdempotent(
  raw: SqliteDatabase,
  input: InsertJobInput,
  now: string = new Date().toISOString()
): Job {
  const existing = getJobByIdempotencyKey(raw, input.idempotencyKey);
  if (existing !== null) return existing;

  try {
    return insertJob(raw, input, now);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = getJobByIdempotencyKey(raw, input.idempotencyKey);
    if (raced === null) throw error;
    return raced;
  }
}

export interface ListJobsQuery {
  status?: JobStatus;
  jobType?: JobType;
  campaignId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface ListJobsResult {
  items: Job[];
  nextCursor: string | null;
}

export function listJobs(raw: SqliteDatabase, query: ListJobsQuery = {}): ListJobsResult {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const [cursorCreatedAt, cursorId] =
    query.cursor && query.cursor.includes('|') ? query.cursor.split('|') : [null, null];

  const rows = raw
    .prepare(
      `SELECT * FROM jobs
       WHERE (@status IS NULL OR status = @status)
         AND (@jobType IS NULL OR job_type = @jobType)
         AND (@campaignId IS NULL OR campaign_id = @campaignId)
         AND (@cursorCreatedAt IS NULL
              OR created_at < @cursorCreatedAt
              OR (created_at = @cursorCreatedAt AND id < @cursorId))
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`
    )
    .all({
      status: query.status ?? null,
      jobType: query.jobType ?? null,
      campaignId: query.campaignId ?? null,
      cursorCreatedAt,
      cursorId,
      limit
    }) as JobRow[];

  const items = rows.map(toJob);
  const last = items.at(-1);
  return {
    items,
    nextCursor: items.length === limit && last ? `${last.createdAt}|${last.id}` : null
  };
}

export interface ClaimParams {
  workerId: string;
  leaseTtlMs: number;
  now: string;
}

/** Klaim satu job QUEUED yang due. Aman dari dua worker karena UPDATE dijaga kondisi lease. */
export function claimDueJob(raw: SqliteDatabase, params: ClaimParams): Job | null {
  const claim = raw.transaction((): Job | null => {
    const row = raw
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'QUEUED'
           AND (run_at IS NULL OR run_at <= @now)
           AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until <= @now)
         ORDER BY COALESCE(run_at, created_at) ASC, created_at ASC
         LIMIT 1`
      )
      .get({ now: params.now }) as JobRow | undefined;

    if (row === undefined) return null;

    const leaseUntil = new Date(Date.parse(params.now) + params.leaseTtlMs).toISOString();
    const info = raw
      .prepare(
        `UPDATE jobs
         SET lease_owner = @workerId, lease_until = @leaseUntil, updated_at = @now
         WHERE id = @id
           AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until <= @now)`
      )
      .run({
        id: row.id,
        workerId: params.workerId,
        leaseUntil,
        now: params.now
      });

    if (info.changes === 0) return null;
    return getJob(raw, row.id);
  });

  return claim.immediate();
}

export function extendLease(
  raw: SqliteDatabase,
  params: { jobId: string; workerId: string; leaseUntil: string; now: string }
): boolean {
  const info = raw
    .prepare(
      `UPDATE jobs SET lease_until = @leaseUntil, updated_at = @now
       WHERE id = @jobId AND lease_owner = @workerId
         AND status NOT IN (${TERMINAL_SQL})`
    )
    .run(params);
  return info.changes > 0;
}

export function releaseLease(
  raw: SqliteDatabase,
  params: { jobId: string; workerId: string; now: string }
): boolean {
  const info = raw
    .prepare(
      `UPDATE jobs SET lease_owner = NULL, lease_until = NULL, updated_at = @now
       WHERE id = @jobId AND lease_owner = @workerId`
    )
    .run(params);
  return info.changes > 0;
}

export function listExpiredLeases(raw: SqliteDatabase, now: string): Job[] {
  const rows = raw
    .prepare(
      `SELECT * FROM jobs
       WHERE lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_until <= @now
         AND status NOT IN (${TERMINAL_SQL})`
    )
    .all({ now }) as JobRow[];
  return rows.map(toJob);
}

export function promoteDueRetries(raw: SqliteDatabase, now: string): Job[] {
  const rows = raw
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'RETRY_WAIT' AND (run_at IS NULL OR run_at <= @now)`
    )
    .all({ now }) as JobRow[];

  const promoted: Job[] = [];
  for (const row of rows) {
    const result = transitionJob('RETRY_WAIT', { type: 'RETRY_DUE', target: 'QUEUED' });
    if (!result.ok) continue;
    const updated = applyTransition(raw, {
      jobId: row.id,
      from: 'RETRY_WAIT',
      to: result.status,
      now,
      patch: { runAt: null, clearLease: true }
    });
    if (updated !== null) promoted.push(updated);
  }
  return promoted;
}

export interface TransitionPatch {
  attempts?: number;
  runAt?: string | null;
  lastErrorCode?: string | null;
  clearLease?: boolean;
  contentId?: string;
}

export interface ApplyTransitionParams {
  jobId: string;
  from: JobStatus;
  to: JobStatus;
  now: string;
  patch?: TransitionPatch;
}

/** Transisi optimistis: gagal (null) bila status aktual sudah berbeda dari `from`. */
export function applyTransition(raw: SqliteDatabase, params: ApplyTransitionParams): Job | null {
  const patch = params.patch ?? {};
  const sets: string[] = ['status = @to', 'updated_at = @now'];
  const values: Record<string, unknown> = {
    id: params.jobId,
    from: params.from,
    to: params.to,
    now: params.now
  };

  if (patch.attempts !== undefined) {
    sets.push('attempts = @attempts');
    values.attempts = patch.attempts;
  }
  if (patch.runAt !== undefined) {
    sets.push('run_at = @runAt');
    values.runAt = patch.runAt;
  }
  if (patch.lastErrorCode !== undefined) {
    sets.push('last_error_code = @lastErrorCode');
    values.lastErrorCode = patch.lastErrorCode;
  }
  if (patch.clearLease === true) {
    sets.push('lease_owner = NULL', 'lease_until = NULL');
  }
  if (patch.contentId !== undefined) {
    sets.push('content_id = @contentId');
    values.contentId = patch.contentId;
  }

  const info = raw
    .prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = @id AND status = @from`)
    .run(values);

  if (info.changes === 0) return null;
  return getJob(raw, params.jobId);
}
