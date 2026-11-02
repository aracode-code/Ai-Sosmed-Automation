import { randomUUID } from 'node:crypto';
import {
  PLATFORM_IDS,
  type Campaign,
  type GenerationMode,
  type PlatformId
} from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface CampaignRow {
  id: string;
  name: string;
  niche: string;
  status: string;
  approval_mode: string;
  generation_mode: string;
  platforms_json: string;
  created_at: string;
}

function parsePlatforms(value: string): PlatformId[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PlatformId =>
      PLATFORM_IDS.includes(item as PlatformId)
    );
  } catch {
    return [];
  }
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    niche: row.niche,
    status: row.status,
    approvalMode: row.approval_mode === 'automatic' ? 'automatic' : 'required',
    generationMode: row.generation_mode === 'image' ? 'image' : 'video',
    platforms: parsePlatforms(row.platforms_json),
    createdAt: row.created_at
  };
}

export interface InsertCampaignInput {
  id?: string;
  name: string;
  niche: string;
  status?: string;
  approvalMode: 'automatic' | 'required';
  /** Default video: campaign lama dan pemanggil lama tidak berubah perilaku. */
  generationMode?: GenerationMode;
  platforms: PlatformId[];
}

export function insertCampaign(
  raw: SqliteDatabase,
  input: InsertCampaignInput,
  now: string = new Date().toISOString()
): Campaign {
  const id = input.id ?? `cmp_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO campaigns (id, name, niche, status, approval_mode, generation_mode, platforms_json, created_at)
       VALUES (@id, @name, @niche, @status, @approvalMode, @generationMode, @platformsJson, @now)`
    )
    .run({
      id,
      name: input.name,
      niche: input.niche,
      status: input.status ?? 'active',
      approvalMode: input.approvalMode,
      generationMode: input.generationMode ?? 'video',
      platformsJson: JSON.stringify(input.platforms),
      now
    });

  const campaign = getCampaign(raw, id);
  if (campaign === null) throw new Error(`campaign ${id} gagal disimpan`);
  return campaign;
}

export function getCampaign(raw: SqliteDatabase, id: string): Campaign | null {
  const row = raw.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as
    | CampaignRow
    | undefined;
  return row ? toCampaign(row) : null;
}

export function listCampaigns(raw: SqliteDatabase): Campaign[] {
  const rows = raw
    .prepare('SELECT * FROM campaigns ORDER BY created_at DESC')
    .all() as CampaignRow[];
  return rows.map(toCampaign);
}
