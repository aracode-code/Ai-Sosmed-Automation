import { AppError, type MediaKind } from '@saa/domain';

/**
 * Guard pemakaian Flow. Tidak ada API saldo kredit, jadi guard ini membatasi
 * **jumlah pembuatan** dan mewajibkan konfirmasi eksplisit — bukan menjamin
 * saldo tidak habis.
 */

export interface FlowGuard {
  maxPerDay: number;
  requireConfirm: boolean;
  dryRun: boolean;
}

/** Alias historis; sumber tunggal jenis media ada di `@saa/domain`. */
export type FlowMediaKind = MediaKind;

export type UsageStatus = 'started' | 'succeeded' | 'failed';

export interface UsageEntry {
  at: string;
  kind: FlowMediaKind;
  promptHash: string;
  status: UsageStatus;
  dryRun: boolean;
  /** False bila proses berhenti sebelum tombol kirim ditekan (tidak memotong kredit). */
  submitted: boolean;
}

export interface UsageLedger {
  entries: UsageEntry[];
}

const TRUE_VALUES = new Set(['1', 'true', 'yes']);

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

function parseCount(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new AppError('VALIDATION', `FLOW_MAX_GENERATIONS_PER_DAY tidak valid: ${raw}`);
  }
  return value;
}

/** Default konservatif: 1 pembuatan/hari, wajib konfirmasi, bukan dry-run. */
export function parseFlowGuard(env: NodeJS.ProcessEnv = process.env): FlowGuard {
  return {
    maxPerDay: parseCount(env.FLOW_MAX_GENERATIONS_PER_DAY, 1),
    requireConfirm: parseBool(env.FLOW_REQUIRE_CONFIRM, true),
    dryRun: parseBool(env.FLOW_DRY_RUN, false)
  };
}

export function emptyLedger(): UsageLedger {
  return { entries: [] };
}

const DEFAULT_TIME_ZONE = 'Asia/Jakarta';

/** Tanggal kalender pada zona waktu operasional (default Asia/Jakarta). */
export function dayOf(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/** Entri dry-run dan entri yang tidak pernah submit tidak dihitung. */
export function countUsageOn(
  ledger: UsageLedger,
  iso: string,
  timeZone: string = DEFAULT_TIME_ZONE
): number {
  const day = dayOf(iso, timeZone);
  return ledger.entries.filter(
    (entry) => !entry.dryRun && entry.submitted && dayOf(entry.at, timeZone) === day
  ).length;
}

export interface BudgetDecision {
  allowed: boolean;
  usedToday: number;
  reason?: string;
}

export function decideGeneration(
  guard: FlowGuard,
  ledger: UsageLedger,
  nowIso: string,
  timeZone: string = DEFAULT_TIME_ZONE
): BudgetDecision {
  const usedToday = countUsageOn(ledger, nowIso, timeZone);
  if (guard.maxPerDay === 0) {
    return {
      allowed: false,
      usedToday,
      reason: 'FLOW_MAX_GENERATIONS_PER_DAY=0 — pembuatan dinonaktifkan'
    };
  }
  if (usedToday >= guard.maxPerDay) {
    return {
      allowed: false,
      usedToday,
      reason: `batas harian tercapai (${usedToday}/${guard.maxPerDay}) pada ${dayOf(nowIso, timeZone)}`
    };
  }
  return { allowed: true, usedToday };
}

export interface ParseLedgerOptions {
  raw: string | null;
}

export function parseLedger({ raw }: ParseLedgerOptions): UsageLedger {
  if (raw === null) return emptyLedger();
  try {
    const parsed = JSON.parse(raw) as Partial<UsageLedger>;
    if (!Array.isArray(parsed.entries)) return emptyLedger();
    const entries = parsed.entries.filter((entry): entry is UsageEntry => {
      if (typeof entry !== 'object' || entry === null) return false;
      const candidate = entry as Partial<UsageEntry>;
      return (
        typeof candidate.at === 'string' &&
        (candidate.kind === 'image' || candidate.kind === 'video') &&
        typeof candidate.promptHash === 'string' &&
        (candidate.status === 'started' ||
          candidate.status === 'succeeded' ||
          candidate.status === 'failed') &&
        typeof candidate.dryRun === 'boolean' &&
        typeof candidate.submitted === 'boolean'
      );
    });
    return { entries };
  } catch {
    return emptyLedger();
  }
}

export function appendUsage(ledger: UsageLedger, entry: UsageEntry): UsageLedger {
  return { entries: [...ledger.entries, entry] };
}

export function updateLastStatus(
  ledger: UsageLedger,
  status: UsageStatus
): UsageLedger {
  if (ledger.entries.length === 0) return ledger;
  const entries = [...ledger.entries];
  const last = entries[entries.length - 1];
  if (last.status === status) return ledger;
  entries[entries.length - 1] = { ...last, status };
  return { entries };
}
