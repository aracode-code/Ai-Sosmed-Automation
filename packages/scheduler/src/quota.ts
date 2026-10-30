import type { Schedule } from '@saa/domain';
import type { DatabaseHandle } from '@saa/database';
import { addLocalDays, localDateTimeToUtc } from './time';

export interface QuotaGate {
  /** True bila kuota harian untuk salah satu account+platform jadwal ini habis. */
  isExceeded(schedule: Schedule, localDate: string): boolean;
}

/**
 * Attempt yang terbukti berhenti sebelum ada panggilan jaringan tidak memakai
 * kuota: `PUBLISH_VALIDATION` (validasi lokal handler), `VALIDATION` (aset tidak
 * terbaca atau inisialisasi ditolak 4xx sebelum byte dikirim), `DISK` (gagal
 * membaca berkas). Status lain tetap dihitung karena unggahan mungkin sudah
 * terkirim — over-count lebih aman daripada melampaui limit harian project.
 */
const PRE_UPLOAD_ERROR_CODES = ['PUBLISH_VALIDATION', 'VALIDATION', 'DISK'] as const;

/** Kuota dihitung dari publish_attempts pada tanggal lokal schedule. */
export function createDbQuotaGate(db: DatabaseHandle): QuotaGate {
  const excluded = PRE_UPLOAD_ERROR_CODES.map((_, index) => `@preUpload${index}`).join(', ');
  const exclusionParams = Object.fromEntries(
    PRE_UPLOAD_ERROR_CODES.map((code, index) => [`preUpload${index}`, code])
  );

  return {
    isExceeded(schedule, localDate) {
      const start = localDateTimeToUtc(localDate, '00:00', schedule.timezone);
      const end = localDateTimeToUtc(addLocalDays(localDate, 1), '00:00', schedule.timezone);

      const rows = db.raw
        .prepare(
          `SELECT pa.account_id AS accountId, pa.platform AS platform, COUNT(*) AS count
           FROM publish_attempts pa
           JOIN jobs j ON j.id = pa.job_id
           WHERE j.campaign_id = @campaignId
             AND pa.attempted_at >= @start
             AND pa.attempted_at < @end
             AND COALESCE(pa.error_code, '') NOT IN (${excluded})
           GROUP BY pa.account_id, pa.platform`
        )
        .all({
          campaignId: schedule.campaignId,
          start: start.toISOString(),
          end: end.toISOString(),
          ...exclusionParams
        }) as { accountId: string; platform: string; count: number }[];

      return rows.some((row) => row.count >= schedule.dailyLimit);
    }
  };
}
