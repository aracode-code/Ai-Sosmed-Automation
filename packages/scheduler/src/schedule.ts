import type { ScheduleConfig } from '@saa/domain';
import { addLocalDays, formatLocalDate, localDateTimeToUtc, localMinutesOf } from './time';

export type ScheduleTiming = Pick<
  ScheduleConfig,
  | 'mode'
  | 'minMinutes'
  | 'maxMinutes'
  | 'windowStart'
  | 'windowEnd'
  | 'timezone'
  | 'quietHours'
>;

function minutesOf(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** Batas window/quiet bersifat inklusif; rentang boleh melewati tengah malam. */
export function withinWindow(minutes: number, start: string, end: string): boolean {
  const startMinutes = minutesOf(start);
  const endMinutes = minutesOf(end);
  return startMinutes <= endMinutes
    ? minutes >= startMinutes && minutes <= endMinutes
    : minutes >= startMinutes || minutes <= endMinutes;
}

/**
 * Jeda antar publikasi (menit). Mode random memakai batas inklusif [min, max]
 * dengan PRNG standar; `rng` diinjeksi agar dapat diuji deterministik.
 */
export function pickDelayMinutes(
  schedule: ScheduleTiming,
  rng: () => number = Math.random
): number {
  const min = schedule.minMinutes ?? schedule.maxMinutes ?? 1;
  if (schedule.mode === 'fixed') return min;
  const max = Math.max(min, schedule.maxMinutes ?? min);
  const draw = rng();
  const clamped = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999999999) : 0;
  return min + Math.floor(clamped * (max - min + 1));
}

function nextWindowStart(candidate: Date, schedule: ScheduleTiming): Date | null {
  if (schedule.windowStart === null || schedule.windowEnd === null) return null;
  const localDate = formatLocalDate(candidate, schedule.timezone);
  const minutes = localMinutesOf(candidate, schedule.timezone);
  if (withinWindow(minutes, schedule.windowStart, schedule.windowEnd)) return null;

  const startToday = localDateTimeToUtc(localDate, schedule.windowStart, schedule.timezone);
  if (startToday.getTime() > candidate.getTime()) return startToday;
  return localDateTimeToUtc(
    addLocalDays(localDate, 1),
    schedule.windowStart,
    schedule.timezone
  );
}

function nextQuietEnd(candidate: Date, schedule: ScheduleTiming): Date | null {
  const quiet = schedule.quietHours;
  if (quiet === null) return null;
  const localDate = formatLocalDate(candidate, schedule.timezone);
  const minutes = localMinutesOf(candidate, schedule.timezone);
  if (!withinWindow(minutes, quiet.start, quiet.end)) return null;

  const endToday = localDateTimeToUtc(localDate, quiet.end, schedule.timezone);
  // Akhir quiet hours eksklusif: kandidat tepat di batas itu sudah boleh jalan.
  if (endToday.getTime() === candidate.getTime()) return null;
  if (endToday.getTime() > candidate.getTime()) return endToday;
  return localDateTimeToUtc(addLocalDays(localDate, 1), quiet.end, schedule.timezone);
}

/** Geser kandidat ke slot valid berikutnya (window lalu quiet hours). */
export function shiftIntoAllowedSlot(candidate: Date, schedule: ScheduleTiming): Date {
  let cursor = candidate;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const windowShift = nextWindowStart(cursor, schedule);
    if (windowShift !== null) {
      cursor = windowShift;
      continue;
    }
    const quietShift = nextQuietEnd(cursor, schedule);
    if (quietShift !== null) {
      cursor = quietShift;
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * Hitung next_run_at dari `now`. Hasil WAJIB dipersist; restart tidak boleh
 * menghitung ulang (LLD §8.2).
 */
export function computeNextRun(
  schedule: ScheduleTiming,
  now: Date,
  rng: () => number = Math.random
): Date {
  const delayMs = pickDelayMinutes(schedule, rng) * 60_000;
  return shiftIntoAllowedSlot(new Date(now.getTime() + delayMs), schedule);
}
