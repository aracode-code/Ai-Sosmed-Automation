import { planJobIdOfPrompt, type ContentItem } from '@saa/domain';
import type { SqliteDatabase } from '../client';
import { hasJobForContent } from './jobs';

interface ContentRow {
  id: string;
  campaign_id: string;
  version: number;
  topic: string;
  prompt_json: string;
  caption_json: string | null;
  approval_status: string;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toContent(row: ContentRow): ContentItem {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    version: row.version,
    topic: row.topic,
    prompt: parseJson(row.prompt_json),
    caption: parseJson(row.caption_json),
    approvalStatus: row.approval_status as ContentItem['approvalStatus']
  };
}

export interface InsertContentInput {
  id: string;
  campaignId: string;
  version?: number;
  topic: string;
  prompt: unknown;
  caption?: unknown;
  approvalStatus?: ContentItem['approvalStatus'];
}

/**
 * Idempoten pada (id, version): handler yang diulang setelah crash tidak membuat
 * versi konten ganda. Revisi wajib memakai versi baru secara eksplisit.
 */
export function upsertContentItem(raw: SqliteDatabase, input: InsertContentInput): ContentItem {
  raw
    .prepare(
      `INSERT INTO content_items (id, campaign_id, version, topic, prompt_json, caption_json, approval_status)
       VALUES (@id, @campaignId, @version, @topic, @promptJson, @captionJson, @approvalStatus)
       ON CONFLICT (id, version) DO NOTHING`
    )
    .run({
      id: input.id,
      campaignId: input.campaignId,
      version: input.version ?? 1,
      topic: input.topic,
      promptJson: JSON.stringify(input.prompt ?? null),
      captionJson: input.caption === undefined ? null : JSON.stringify(input.caption),
      approvalStatus: input.approvalStatus ?? 'pending'
    });

  const item = getContentItem(raw, input.id, input.version ?? 1);
  if (item === null) throw new Error(`content ${input.id} gagal disimpan`);
  return item;
}

export function getContentItem(
  raw: SqliteDatabase,
  id: string,
  version?: number
): ContentItem | null {
  const row =
    version === undefined
      ? (raw
          .prepare('SELECT * FROM content_items WHERE id = ? ORDER BY version DESC LIMIT 1')
          .get(id) as ContentRow | undefined)
      : (raw
          .prepare('SELECT * FROM content_items WHERE id = ? AND version = ?')
          .get(id, version) as ContentRow | undefined);
  return row ? toContent(row) : null;
}

export function listContentByCampaign(raw: SqliteDatabase, campaignId: string): ContentItem[] {
  const rows = raw
    .prepare('SELECT * FROM content_items WHERE campaign_id = ? ORDER BY version DESC')
    .all(campaignId) as ContentRow[];
  return rows.map(toContent);
}

export function setContentApprovalStatus(
  raw: SqliteDatabase,
  params: { id: string; version: number; status: ContentItem['approvalStatus'] }
): boolean {
  const info = raw
    .prepare('UPDATE content_items SET approval_status = @status WHERE id = @id AND version = @version')
    .run(params);
  return info.changes > 0;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Seluruh item satu rencana. `planJobId` hanya ada di `prompt_json` (tanpa kolom),
 * jadi LIKE dipakai sebagai penyaring awal dan kecocokan tepat diverifikasi di JS.
 */
export function listContentByPlanJob(raw: SqliteDatabase, planJobId: string): ContentItem[] {
  const rows = raw
    .prepare(
      `SELECT * FROM content_items
       WHERE prompt_json LIKE @pattern ESCAPE '\\'
       ORDER BY id ASC`
    )
    .all({ pattern: `%"planJobId":"${escapeLike(planJobId)}"%` }) as ContentRow[];
  return rows.map(toContent).filter((item) => planJobIdOfPrompt(item.prompt) === planJobId);
}

/**
 * Konten yang masih menahan slot produksi berikutnya: seluruh item rencana yang sama
 * (bukan hanya konten terbaru) harus sudah punya job PUBLISH. Konten yang ditolak
 * reviewer dikecualikan karena tidak akan pernah terbit.
 */
export function listPlanContentsAwaitingPublish(
  raw: SqliteDatabase,
  newest: ContentItem
): ContentItem[] {
  const planJobId = planJobIdOfPrompt(newest.prompt);
  const contents = planJobId === null ? [newest] : listContentByPlanJob(raw, planJobId);
  return contents.filter(
    (item) =>
      item.approvalStatus !== 'rejected' &&
      !hasJobForContent(raw, { contentId: item.id, jobType: 'PUBLISH' })
  );
}
