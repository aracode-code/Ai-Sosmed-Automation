import { randomUUID } from 'node:crypto';
import type { Approval, ApprovalBinding, ApprovalDecision, PlatformId } from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface ApprovalRow {
  id: string;
  content_id: string;
  content_version: number;
  asset_sha256: string;
  caption_hash: string;
  account_id: string;
  platform: string;
  decision: string;
  decided_at: string;
  decided_by: string;
  reason: string | null;
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    contentId: row.content_id,
    contentVersion: row.content_version,
    assetSha256: row.asset_sha256,
    captionHash: row.caption_hash,
    accountId: row.account_id,
    platform: row.platform as PlatformId,
    decision: row.decision as ApprovalDecision,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    reason: row.reason
  };
}

export interface InsertApprovalInput extends ApprovalBinding {
  decision: ApprovalDecision;
  decidedBy: string;
  reason?: string | null;
  id?: string;
}

/** Approval tidak pernah diubah setelah dicatat; revisi = baris baru dengan versi baru. */
export function insertApproval(
  raw: SqliteDatabase,
  input: InsertApprovalInput,
  now: string = new Date().toISOString()
): Approval {
  const id = input.id ?? `apv_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO approvals (
        id, content_id, content_version, asset_sha256, caption_hash,
        account_id, platform, decision, decided_at, decided_by, reason
      ) VALUES (
        @id, @contentId, @contentVersion, @assetSha256, @captionHash,
        @accountId, @platform, @decision, @decidedAt, @decidedBy, @reason
      )`
    )
    .run({
      id,
      contentId: input.contentId,
      contentVersion: input.contentVersion,
      assetSha256: input.assetSha256,
      captionHash: input.captionHash,
      accountId: input.accountId,
      platform: input.platform,
      decision: input.decision,
      decidedAt: now,
      decidedBy: input.decidedBy,
      reason: input.reason ?? null
    });

  const approval = getApproval(raw, id);
  if (approval === null) throw new Error(`approval ${id} gagal disimpan`);
  return approval;
}

export function getApproval(raw: SqliteDatabase, id: string): Approval | null {
  const row = raw.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
    | ApprovalRow
    | undefined;
  return row ? toApproval(row) : null;
}

export function listApprovalsForContent(raw: SqliteDatabase, contentId: string): Approval[] {
  const rows = raw
    .prepare(
      'SELECT * FROM approvals WHERE content_id = ? ORDER BY decided_at DESC, id DESC'
    )
    .all(contentId) as ApprovalRow[];
  return rows.map(toApproval);
}

export interface ApprovalLookup {
  contentId: string;
  contentVersion: number;
  accountId: string;
  platform: PlatformId;
}

/** Approval terakhir untuk satu target; pemanggil wajib memeriksa binding (§12.1). */
export function getLatestApproval(raw: SqliteDatabase, lookup: ApprovalLookup): Approval | null {
  const row = raw
    .prepare(
      `SELECT * FROM approvals
       WHERE content_id = @contentId AND content_version = @contentVersion
         AND account_id = @accountId AND platform = @platform
       ORDER BY decided_at DESC, id DESC
       LIMIT 1`
    )
    .get(lookup) as ApprovalRow | undefined;
  return row ? toApproval(row) : null;
}
