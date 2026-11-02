import { randomUUID } from 'node:crypto';
import {
  hashCaption,
  hashPlanBinding,
  planApprovalAllows,
  planJobIdOfPrompt,
  type ApprovalDecision,
  type ContentItem,
  type PlanApproval,
  type PlanBindingItem
} from '@saa/domain';
import type { SqliteDatabase } from '../client';
import { listContentByPlanJob } from './content';

interface PlanApprovalRow {
  id: string;
  plan_job_id: string;
  campaign_id: string;
  binding_hash: string;
  item_count: number;
  decision: string;
  decided_at: string;
  decided_by: string;
  reason: string | null;
}

function toPlanApproval(row: PlanApprovalRow): PlanApproval {
  return {
    id: row.id,
    planJobId: row.plan_job_id,
    campaignId: row.campaign_id,
    bindingHash: row.binding_hash,
    itemCount: row.item_count,
    decision: row.decision as ApprovalDecision,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    reason: row.reason
  };
}

export interface InsertPlanApprovalInput {
  planJobId: string;
  campaignId: string;
  bindingHash: string;
  itemCount: number;
  decision: ApprovalDecision;
  decidedBy: string;
  reason?: string | null;
  id?: string;
}

/** Satu keputusan per job rencana; baris tidak pernah diubah setelah disimpan. */
export function insertPlanApproval(
  raw: SqliteDatabase,
  input: InsertPlanApprovalInput,
  now: string = new Date().toISOString()
): PlanApproval {
  const id = input.id ?? `papv_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO plan_approvals (
        id, plan_job_id, campaign_id, binding_hash, item_count,
        decision, decided_at, decided_by, reason
      ) VALUES (
        @id, @planJobId, @campaignId, @bindingHash, @itemCount,
        @decision, @decidedAt, @decidedBy, @reason
      )`
    )
    .run({
      id,
      planJobId: input.planJobId,
      campaignId: input.campaignId,
      bindingHash: input.bindingHash,
      itemCount: input.itemCount,
      decision: input.decision,
      decidedAt: now,
      decidedBy: input.decidedBy,
      reason: input.reason ?? null
    });

  const approval = getPlanApproval(raw, input.planJobId);
  if (approval === null) throw new Error(`plan approval ${id} gagal disimpan`);
  return approval;
}

export function getPlanApproval(raw: SqliteDatabase, planJobId: string): PlanApproval | null {
  const row = raw
    .prepare('SELECT * FROM plan_approvals WHERE plan_job_id = ?')
    .get(planJobId) as PlanApprovalRow | undefined;
  return row ? toPlanApproval(row) : null;
}

/** Item binding rencana: caption ikut mengikat karena aset belum ada saat persetujuan. */
export function planBindingsOf(items: readonly ContentItem[]): PlanBindingItem[] {
  return items.map((item) => ({
    contentId: item.id,
    contentVersion: item.version,
    captionHash: hashCaption(item.caption)
  }));
}

export function planBindingHashOf(items: readonly ContentItem[]): string {
  return hashPlanBinding(planBindingsOf(items));
}

export interface PlanGate {
  planJobId: string | null;
  approval: PlanApproval | null;
  /** `true` hanya bila keputusan `approved` dan binding masih cocok dengan konten saat ini. */
  ok: boolean;
}

/** Gerbang tahap rencana untuk satu konten; konten lama tanpa rencana selalu `ok: false`. */
export function getPlanGate(raw: SqliteDatabase, content: ContentItem): PlanGate {
  const planJobId = planJobIdOfPrompt(content.prompt);
  if (planJobId === null) return { planJobId: null, approval: null, ok: false };

  const approval = getPlanApproval(raw, planJobId);
  if (approval === null) return { planJobId, approval: null, ok: false };

  const items = listContentByPlanJob(raw, planJobId);
  return { planJobId, approval, ok: planApprovalAllows(approval, planBindingsOf(items)) };
}
