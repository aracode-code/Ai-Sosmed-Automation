import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  formatLocalDate,
  formatLocalTime,
  localDateTimeToUtc,
  localMinutesOf,
  tzOffsetMs
} from './index';

const JAKARTA = 'Asia/Jakarta';

describe('waktu lokal', () => {
  it('Asia/Jakarta selalu +07:00 dari UTC', () => {
    expect(tzOffsetMs(new Date('2026-01-01T00:00:00.000Z'), JAKARTA)).toBe(7 * 60 * 60 * 1000);
  });

  it('mengubah jam dinding lokal menjadi instant UTC', () => {
    expect(localDateTimeToUtc('2026-01-01', '12:00', JAKARTA).toISOString()).toBe(
      '2026-01-01T05:00:00.000Z'
    );
  });

  it('tanggal lokal berbeda dari tanggal UTC setelah tengah malam WIB', () => {
    const late = new Date('2026-01-01T18:00:00.000Z');
    expect(formatLocalDate(late, JAKARTA)).toBe('2026-01-02');
    expect(formatLocalTime(late, JAKARTA)).toBe('01:00');
    expect(localMinutesOf(late, JAKARTA)).toBe(60);
  });

  it('menambah hari pada tanggal lokal melewati batas bulan', () => {
    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('menolak input tanggal yang tidak valid', () => {
    expect(() => localDateTimeToUtc('bukan-tanggal', '12:00', JAKARTA)).toThrow();
  });
});
