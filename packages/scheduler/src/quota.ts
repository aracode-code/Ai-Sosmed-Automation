import type { Schedule } from '@saa/domain';
import type { DatabaseHandle } from '@saa/database';
import { addLocalDays, localDateTimeToUtc } from './time';

export interface QuotaGate {
  /** True bila kuota harian untuk salah satu account+platform jadwal ini habis. */
  isExceeded(schedule: Schedule, localDate: string): boolean;
}

/**
 * Kuota dihitung dari publish_attempts pada tanggal lokal schedule.
 * Saat P5 mendefinisikan status attempt, percobaan yang gagal total dapat
 * dikecualikan; untuk sekarang semua attempt dihitung agar tidak melebihi batas.
 */
export function createDbQuotaGate(db: DatabaseHandle): QuotaGate {
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
           GROUP BY pa.account_id, pa.platform`
        )
        .all({
          campaignId: schedule.campaignId,
          start: start.toISOString(),
          end: end.toISOString()
        }) as { accountId: string; platform: string; count: number }[];

      return rows.some((row) => row.count >= schedule.dailyLimit);
    }
  };
}
