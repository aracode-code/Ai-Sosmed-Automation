import { randomUUID } from 'node:crypto';
import type { Schedule, ScheduleMode, ScheduleWindow } from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface ScheduleRow {
  id: string;
  campaign_id: string;
  mode: string;
  min_minutes: number | null;
  max_minutes: number | null;
  window_start: string | null;
  window_end: string | null;
  timezone: string;
  daily_limit: number;
  enabled: number;
  next_run_at: string | null;
  quiet_start: string | null;
  quiet_end: string | null;
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    mode: row.mode as ScheduleMode,
    minMinutes: row.min_minutes,
    maxMinutes: row.max_minutes,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    timezone: row.timezone,
    dailyLimit: row.daily_limit,
    quietHours:
      row.quiet_start !== null && row.quiet_end !== null
        ? { start: row.quiet_start, end: row.quiet_end }
        : null,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at
  };
}

export interface InsertScheduleInput {
  campaignId: string;
  mode: ScheduleMode;
  minMinutes?: number | null;
  maxMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  timezone?: string;
  dailyLimit?: number;
  quietHours?: ScheduleWindow | null;
  enabled?: boolean;
  nextRunAt?: string | null;
  id?: string;
}

export function insertSchedule(raw: SqliteDatabase, input: InsertScheduleInput): Schedule {
  const id = input.id ?? `sch_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO schedules (
        id, campaign_id, mode, min_minutes, max_minutes, window_start, window_end,
        timezone, daily_limit, enabled, next_run_at, quiet_start, quiet_end
      ) VALUES (
        @id, @campaignId, @mode, @minMinutes, @maxMinutes, @windowStart, @windowEnd,
        @timezone, @dailyLimit, @enabled, @nextRunAt, @quietStart, @quietEnd
      )`
    )
    .run({
      id,
      campaignId: input.campaignId,
      mode: input.mode,
      minMinutes: input.minMinutes ?? null,
      maxMinutes: input.maxMinutes ?? null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      timezone: input.timezone ?? 'Asia/Jakarta',
      dailyLimit: input.dailyLimit ?? 1,
      enabled: input.enabled === false ? 0 : 1,
      nextRunAt: input.nextRunAt ?? null,
      quietStart: input.quietHours?.start ?? null,
      quietEnd: input.quietHours?.end ?? null
    });

  const schedule = getSchedule(raw, id);
  if (schedule === null) throw new Error(`schedule ${id} gagal disimpan`);
  return schedule;
}

export function getSchedule(raw: SqliteDatabase, id: string): Schedule | null {
  const row = raw.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as
    | ScheduleRow
    | undefined;
  return row ? toSchedule(row) : null;
}

export function listSchedules(
  raw: SqliteDatabase,
  query: { campaignId?: string } = {}
): Schedule[] {
  const rows = raw
    .prepare(
      `SELECT * FROM schedules
       WHERE (@campaignId IS NULL OR campaign_id = @campaignId)
       ORDER BY id ASC`
    )
    .all({ campaignId: query.campaignId ?? null }) as ScheduleRow[];
  return rows.map(toSchedule);
}

export function listDueSchedules(raw: SqliteDatabase, now: string): Schedule[] {
  const rows = raw
    .prepare(
      `SELECT * FROM schedules
       WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= @now)
       ORDER BY COALESCE(next_run_at, '') ASC, id ASC`
    )
    .all({ now }) as ScheduleRow[];
  return rows.map(toSchedule);
}

export function setScheduleNextRun(
  raw: SqliteDatabase,
  id: string,
  nextRunAt: string | null
): boolean {
  const info = raw
    .prepare('UPDATE schedules SET next_run_at = @nextRunAt WHERE id = @id')
    .run({ id, nextRunAt });
  return info.changes > 0;
}

export interface SchedulePatch {
  mode?: ScheduleMode;
  minMinutes?: number | null;
  maxMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  timezone?: string;
  dailyLimit?: number;
  quietHours?: ScheduleWindow | null;
  enabled?: boolean;
  nextRunAt?: string | null;
}

/** Patch parsial: field `undefined` tidak berubah, `null` menghapus nilai. */
export function updateSchedule(
  raw: SqliteDatabase,
  id: string,
  patch: SchedulePatch
): Schedule | null {
  const sets: string[] = [];
  const values: Record<string, unknown> = { id };

  const put = (column: string, field: string, value: unknown): void => {
    if (value === undefined) return;
    sets.push(`${column} = @${field}`);
    values[field] = value;
  };

  put('mode', 'mode', patch.mode);
  put('min_minutes', 'minMinutes', patch.minMinutes);
  put('max_minutes', 'maxMinutes', patch.maxMinutes);
  put('window_start', 'windowStart', patch.windowStart);
  put('window_end', 'windowEnd', patch.windowEnd);
  put('timezone', 'timezone', patch.timezone);
  put('daily_limit', 'dailyLimit', patch.dailyLimit);
  put('enabled', 'enabled', patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0);
  put('next_run_at', 'nextRunAt', patch.nextRunAt);
  if (patch.quietHours !== undefined) {
    sets.push('quiet_start = @quietStart', 'quiet_end = @quietEnd');
    values.quietStart = patch.quietHours?.start ?? null;
    values.quietEnd = patch.quietHours?.end ?? null;
  }

  if (sets.length === 0) return getSchedule(raw, id);

  const info = raw.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = @id`).run(values);
  if (info.changes === 0) return null;
  return getSchedule(raw, id);
}
