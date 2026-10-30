export const SCHEDULE_MODES = ['fixed', 'random', 'random_window'] as const;

export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export interface ScheduleWindow {
  start: string;
  end: string;
}

export interface ScheduleConfig {
  mode: ScheduleMode;
  minMinutes: number | null;
  maxMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string;
  dailyLimit: number;
  quietHours: ScheduleWindow | null;
  enabled: boolean;
}

export interface ScheduleValidation {
  ok: boolean;
  issues: string[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validasi konfigurasi jadwal (LLD §8.2): min >= 1, max >= min, window/quiet
 * berpasangan dan berformat HH:mm, timezone dikenal.
 */
export function validateScheduleConfig(input: ScheduleConfig): ScheduleValidation {
  const issues: string[] = [];

  if (!SCHEDULE_MODES.includes(input.mode)) issues.push(`mode "${String(input.mode)}" tidak dikenal`);

  const min = input.minMinutes;
  const max = input.maxMinutes;
  if (min !== null && (!Number.isInteger(min) || min < 1)) issues.push('minMinutes minimal 1');
  if (max !== null && (!Number.isInteger(max) || max < 1)) issues.push('maxMinutes minimal 1');
  if (min !== null && max !== null && max < min) {
    issues.push('maxMinutes tidak boleh kurang dari minMinutes');
  }
  if (input.mode === 'fixed' && min === null) {
    issues.push('mode fixed memerlukan minMinutes');
  }
  if (input.mode !== 'fixed' && (min === null || max === null)) {
    issues.push(`mode ${input.mode} memerlukan minMinutes dan maxMinutes`);
  }

  if ((input.windowStart === null) !== (input.windowEnd === null)) {
    issues.push('windowStart dan windowEnd harus diisi bersamaan');
  }
  if (input.windowStart !== null && !HHMM.test(input.windowStart)) {
    issues.push('windowStart harus berformat HH:mm');
  }
  if (input.windowEnd !== null && !HHMM.test(input.windowEnd)) {
    issues.push('windowEnd harus berformat HH:mm');
  }
  if (
    input.windowStart !== null &&
    input.windowEnd !== null &&
    input.windowStart === input.windowEnd
  ) {
    issues.push('windowStart dan windowEnd tidak boleh sama');
  }

  if (input.quietHours !== null) {
    if (!HHMM.test(input.quietHours.start)) issues.push('quietHours.start harus berformat HH:mm');
    if (!HHMM.test(input.quietHours.end)) issues.push('quietHours.end harus berformat HH:mm');
    if (input.quietHours.start === input.quietHours.end) {
      issues.push('quietHours.start dan quietHours.end tidak boleh sama');
    }
  }

  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1) {
    issues.push('dailyLimit minimal 1');
  }
  if (!isValidTimeZone(input.timezone)) {
    issues.push(`timezone "${input.timezone}" tidak dikenal`);
  }

  return { ok: issues.length === 0, issues };
}
