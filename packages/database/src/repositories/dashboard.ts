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

export interface DashboardSummaryOptions {
  /** Jumlah kegagalan terbaru yang dikembalikan (default 5, maks 20). */
  recentFailures?: number;
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
    recentFailures: rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      lastErrorCode: row.last_error_code,
      updatedAt: row.updated_at
    }))
  };
}
