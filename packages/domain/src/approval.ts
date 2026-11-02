import { createHash } from 'node:crypto';
import type { PlatformId } from './platform';

export type ApprovalDecision = 'approved' | 'rejected';

/** Approval terikat pada keenam elemen ini; perubahan salah satunya membatalkan approval. */
export interface ApprovalBinding {
  contentId: string;
  contentVersion: number;
  assetSha256: string;
  captionHash: string;
  accountId: string;
  platform: PlatformId;
}

export type BindingMismatch =
  | 'decision'
  | 'contentVersion'
  | 'assetSha256'
  | 'captionHash'
  | 'accountId'
  | 'platform';

export interface BindingCheck {
  ok: boolean;
  mismatches: BindingMismatch[];
}

export function checkApprovalBinding(
  approval: ApprovalBinding & { decision: ApprovalDecision },
  expected: ApprovalBinding
): BindingCheck {
  const mismatches: BindingMismatch[] = [];
  if (approval.decision !== 'approved') mismatches.push('decision');
  if (approval.contentVersion !== expected.contentVersion) mismatches.push('contentVersion');
  if (approval.assetSha256 !== expected.assetSha256) mismatches.push('assetSha256');
  if (approval.captionHash !== expected.captionHash) mismatches.push('captionHash');
  if (approval.accountId !== expected.accountId) mismatches.push('accountId');
  if (approval.platform !== expected.platform) mismatches.push('platform');
  return { ok: mismatches.length === 0, mismatches };
}

/** JSON stabil (key terurut) agar hash caption tidak berubah karena urutan properti. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

export function hashCaption(caption: unknown): string {
  return createHash('sha256').update(stableStringify(caption)).digest('hex');
}

/** Satu item dalam rencana; aset belum ada saat rencana disetujui, jadi hanya caption yang mengikat. */
export interface PlanBindingItem {
  contentId: string;
  contentVersion: number;
  captionHash: string;
}

/**
 * Hash seluruh item satu rencana. Urutan id tidak menentukan, tetapi menambah,
 * menghapus, atau mengubah caption item mana pun membatalkan persetujuan rencana.
 */
export function hashPlanBinding(items: readonly PlanBindingItem[]): string {
  const canonical = [...items]
    .sort((a, b) => (a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0))
    .map((item) => ({
      contentId: item.contentId,
      contentVersion: item.contentVersion,
      captionHash: item.captionHash
    }));
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/** Rencana hanya menggerbangi konten bila disetujui dan binding-nya masih cocok. */
export function planApprovalAllows(
  approval: { decision: ApprovalDecision; bindingHash: string } | null,
  items: readonly PlanBindingItem[]
): boolean {
  if (approval === null || approval.decision !== 'approved') return false;
  return approval.bindingHash === hashPlanBinding(items);
}

/** Id job rencana dibaca dari `prompt_json` konten; konten lama tanpa metadata → null. */
export function planJobIdOfPrompt(prompt: unknown): string | null {
  if (prompt === null || typeof prompt !== 'object' || Array.isArray(prompt)) return null;
  const value = (prompt as { planJobId?: unknown }).planJobId;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
