import type { SqliteDatabase } from '../client';

/**
 * Ringkasan dashboard (LLD §6). Hanya agregasi baca-saja; tidak memuat isi
 * konten atau kredensial, dan tidak menghitung apa pun yang tidak ada di DB.
 */

export interface RecentFailure {
  id: string;
  jobType: string;
  status: string;
  lastErrorCode: string | null;
  updatedAt: string;
}

export interface DashboardSummary {
  jobs: { total: number; byStatus: Record<string, number> };
  publishAttempts: { total: number; byStatus: Record<string, number> };
  campaigns: { total: number; byStatus: Record<string, number> };
  content: { total: number; byApprovalStatus: Record<string, number>; pendingApproval: number };
  accounts: { total: number; byConnectionStatus: Record<string, number> };
  trend: TrendPoint[];
  recentFailures: RecentFailure[];
}

const FAILURE_STATUSES = ['FAILED', 'PERMANENT_FAILURE', 'NEEDS_ATTENTION'];

function countsBy(raw: SqliteDatabase, sql: string): Record<string, number> {
  const rows = raw.prepare(sql).all() as { key: string; count: number }[];
  const result: Record<string, number> = {};
  for (const row of rows) result[row.key] = Number(row.count);
  return result;
}

function totalOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export interface TrendPoint {
  /** Tanggal kalender Asia/Jakarta (YYYY-MM-DD). */
  date: string;
  jobs: number;
  published: number;
  failed: number;
}

/** Offset tetap WIB (+07:00, tanpa DST) — konsisten dengan zona operasional scheduler. */
const JAKARTA_OFFSET = '+7 hours';

function jakartaDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function lastDays(nowIso: string, days: number): string[] {
  const end = new Date(nowIso);
  const result: string[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const point = new Date(end.getTime() - index * 24 * 60 * 60 * 1000);
    result.push(jakartaDay(point.toISOString()));
  }
  return result;
}

function buildTrend(raw: SqliteDatabase, nowIso: string, days: number): TrendPoint[] {
  const dates = lastDays(nowIso, days);

  const jobRows = raw
    .prepare(
      `SELECT date(datetime(created_at, '${JAKARTA_OFFSET}')) AS day, COUNT(*) AS count
       FROM jobs
       WHERE date(datetime(created_at, '${JAKARTA_OFFSET}')) >= ?
       GROUP BY day`
    )
    .all(dates[0]) as { day: string; count: number }[];

  const attemptRows = raw
    .prepare(
      `SELECT date(datetime(attempted_at, '${JAKARTA_OFFSET}')) AS day, status, COUNT(*) AS count
       FROM publish_attempts
       WHERE date(datetime(attempted_at, '${JAKARTA_OFFSET}')) >= ?
       GROUP BY day, status`
    )
    .all(dates[0]) as { day: string; status: string; count: number }[];

  const byDay = new Map<string, TrendPoint>(
    dates.map((date) => [date, { date, jobs: 0, published: 0, failed: 0 }])
  );

  for (const row of jobRows) {
    const point = byDay.get(row.day);
    if (point !== undefined) point.jobs = Number(row.count);
  }
  for (const row of attemptRows) {
    const point = byDay.get(row.day);
    if (point === undefined) continue;
    const count = Number(row.count);
    if (row.status === 'published') point.published += count;
    else if (row.status === 'failed' || row.status === 'unknown') point.failed += count;
  }

  return dates.map((date) => byDay.get(date) ?? { date, jobs: 0, published: 0, failed: 0 });
}

export interface DashboardSummaryOptions {
  /** Jumlah kegagalan terbaru yang dikembalikan (default 5, maks 20). */
  recentFailures?: number;
  /** Panjang tren harian (default 7, maks 30). */
  trendDays?: number;
  /** Waktu acuan tren; default `Date.now()`. */
  nowIso?: string;
}

export function getDashboardSummary(
  raw: SqliteDatabase,
  options: DashboardSummaryOptions = {}
): DashboardSummary {
  const limit = Math.min(Math.max(options.recentFailures ?? 5, 1), 20);

  const jobsByStatus = countsBy(raw, 'SELECT status AS key, COUNT(*) AS count FROM jobs GROUP BY status');
  const attemptsByStatus = countsBy(
    raw,
    'SELECT status AS key, COUNT(*) AS count FROM publish_attempts GROUP BY status'
  );
  const campaignsByStatus = countsBy(
    raw,
    'SELECT status AS key, COUNT(*) AS count FROM campaigns GROUP BY status'
  );
  const contentByApproval = countsBy(
    raw,
    'SELECT approval_status AS key, COUNT(*) AS count FROM content_items GROUP BY approval_status'
  );
  const accountsByConnection = countsBy(
    raw,
    'SELECT connection_status AS key, COUNT(*) AS count FROM social_accounts GROUP BY connection_status'
  );

  const placeholders = FAILURE_STATUSES.map(() => '?').join(', ');
  const rows = raw
    .prepare(
      `SELECT id, job_type, status, last_error_code, updated_at
       FROM jobs
       WHERE status IN (${placeholders})
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .all(...FAILURE_STATUSES, limit) as {
    id: string;
    job_type: string;
    status: string;
    last_error_code: string | null;
    updated_at: string;
  }[];

  return {
    jobs: { total: totalOf(jobsByStatus), byStatus: jobsByStatus },
    publishAttempts: { total: totalOf(attemptsByStatus), byStatus: attemptsByStatus },
    campaigns: { total: totalOf(campaignsByStatus), byStatus: campaignsByStatus },
    content: {
      total: totalOf(contentByApproval),
      byApprovalStatus: contentByApproval,
      pendingApproval: contentByApproval.pending ?? 0
    },
    accounts: { total: totalOf(accountsByConnection), byConnectionStatus: accountsByConnection },
    trend: buildTrend(raw, options.nowIso ?? new Date().toISOString(), Math.min(Math.max(options.trendDays ?? 7, 1), 30)),
    recentFailures: rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      lastErrorCode: row.last_error_code,
      updatedAt: row.updated_at
    }))
  };
}
