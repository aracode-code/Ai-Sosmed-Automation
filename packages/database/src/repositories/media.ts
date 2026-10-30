import { randomUUID } from 'node:crypto';
import type { MediaAsset } from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface MediaRow {
  id: string;
  content_id: string;
  path: string;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  validation_status: string;
}

function toMedia(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    contentId: row.content_id,
    path: row.path,
    sha256: row.sha256,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    validationStatus: row.validation_status as MediaAsset['validationStatus']
  };
}

export interface InsertMediaInput {
  contentId: string;
  path: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  validationStatus: MediaAsset['validationStatus'];
  id?: string;
}

export function insertMediaAsset(raw: SqliteDatabase, input: InsertMediaInput): MediaAsset {
  const id = input.id ?? `med_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO media_assets (
        id, content_id, path, sha256, mime_type, size_bytes, duration_ms, validation_status
      ) VALUES (
        @id, @contentId, @path, @sha256, @mimeType, @sizeBytes, @durationMs, @validationStatus
      )`
    )
    .run({
      id,
      contentId: input.contentId,
      path: input.path,
      sha256: input.sha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      validationStatus: input.validationStatus
    });

  const asset = getMediaAsset(raw, id);
  if (asset === null) throw new Error(`media asset ${id} gagal disimpan`);
  return asset;
}

/** Idempoten per id: retry handler memperbarui baris yang sama, bukan menggandakan. */
export function upsertMediaAsset(raw: SqliteDatabase, input: InsertMediaInput): MediaAsset {
  const id = input.id ?? `med_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO media_assets (
        id, content_id, path, sha256, mime_type, size_bytes, duration_ms, validation_status
      ) VALUES (
        @id, @contentId, @path, @sha256, @mimeType, @sizeBytes, @durationMs, @validationStatus
      )
      ON CONFLICT(id) DO UPDATE SET
        content_id = excluded.content_id,
        path = excluded.path,
        sha256 = excluded.sha256,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        duration_ms = excluded.duration_ms,
        validation_status = excluded.validation_status`
    )
    .run({
      id,
      contentId: input.contentId,
      path: input.path,
      sha256: input.sha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      validationStatus: input.validationStatus
    });

  const asset = getMediaAsset(raw, id);
  if (asset === null) throw new Error(`media asset ${id} gagal disimpan`);
  return asset;
}

export function getMediaAsset(raw: SqliteDatabase, id: string): MediaAsset | null {  const row = raw.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as
    | MediaRow
    | undefined;
  return row ? toMedia(row) : null;
}

export function listMediaByContent(raw: SqliteDatabase, contentId: string): MediaAsset[] {
  const rows = raw
    .prepare('SELECT * FROM media_assets WHERE content_id = ? ORDER BY id ASC')
    .all(contentId) as MediaRow[];
  return rows.map(toMedia);
}
