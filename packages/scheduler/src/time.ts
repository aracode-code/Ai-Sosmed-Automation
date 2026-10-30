export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  formatters.set(timeZone, created);
  return created;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second')
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function formatLocalDate(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatLocalTime(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localMinutesOf(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** Selisih lokal-vs-UTC pada detik tersebut; untuk Asia/Jakarta selalu +07:00. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Konversi jam dinding lokal (HH:mm pada tanggal lokal) menjadi instant UTC. */
export function localDateTimeToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error(`tanggal/jam lokal tidak valid: ${localDate} ${localTime}`);
  }

  const wallClockTs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ts = wallClockTs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const adjusted = wallClockTs - tzOffsetMs(new Date(ts), timeZone);
    if (adjusted === ts) break;
    ts = adjusted;
  }
  return new Date(ts);
}

export function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )}`;
}
