import { describe, expect, it } from 'vitest';
import { computeNextRun, pickDelayMinutes, shiftIntoAllowedSlot, withinWindow } from './index';

const JAKARTA = { timezone: 'Asia/Jakarta' };

describe('pickDelayMinutes', () => {
  const random = {
    ...JAKARTA,
    mode: 'random' as const,
    minMinutes: 30,
    maxMinutes: 120,
    windowStart: null,
    windowEnd: null,
    quietHours: null
  };

  it('selalu berada dalam rentang inklusif [min, max]', () => {
    let seed = 7;
    const lcg = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 500; i += 1) {
      const delay = pickDelayMinutes(random, lcg);
      expect(delay).toBeGreaterThanOrEqual(30);
      expect(delay).toBeLessThanOrEqual(120);
    }
  });

  it('mencapai kedua batas inklusif', () => {
    expect(pickDelayMinutes(random, () => 0)).toBe(30);
    expect(pickDelayMinutes(random, () => 0.9999999999)).toBe(120);
  });

  it('mode fixed memakai minMinutes apa adanya', () => {
    expect(pickDelayMinutes({ ...random, mode: 'fixed', minMinutes: 45 }, () => 0.5)).toBe(45);
  });
});

describe('withinWindow', () => {
  it('mendukung rentang biasa dan rentang yang melewati tengah malam', () => {
    expect(withinWindow(12 * 60, '09:00', '18:00')).toBe(true);
    expect(withinWindow(19 * 60, '09:00', '18:00')).toBe(false);
    expect(withinWindow(23 * 60, '22:00', '02:00')).toBe(true);
    expect(withinWindow(60, '22:00', '02:00')).toBe(true);
    expect(withinWindow(12 * 60, '22:00', '02:00')).toBe(false);
  });
});

describe('computeNextRun', () => {
  const base = {
    ...JAKARTA,
    mode: 'fixed' as const,
    minMinutes: 60,
    maxMinutes: null,
    windowStart: null,
    windowEnd: null,
    quietHours: null
  };

  it('menggeser ke window berikutnya bila hasil jatuh sebelum window', () => {
    const now = new Date('2026-01-01T03:00:00.000Z'); // 10:00 WIB
    const next = computeNextRun(
      { ...base, windowStart: '12:00', windowEnd: '18:00' },
      now,
      () => 0
    );
    expect(next.toISOString()).toBe('2026-01-01T05:00:00.000Z'); // 12:00 WIB
  });

  it('menggeser ke window hari berikutnya bila window hari ini sudah lewat', () => {
    const now = new Date('2026-01-01T12:00:00.000Z'); // 19:00 WIB
    const next = computeNextRun(
      { ...base, windowStart: '12:00', windowEnd: '18:00' },
      now,
      () => 0
    );
    expect(next.toISOString()).toBe('2026-01-02T05:00:00.000Z');
  });

  it('menghindari quiet hours', () => {
    const now = new Date('2026-01-01T11:00:00.000Z'); // 18:00 WIB
    const next = computeNextRun(
      {
        ...base,
        minMinutes: 30,
        quietHours: { start: '18:00', end: '20:00' }
      },
      now,
      () => 0
    );
    expect(next.toISOString()).toBe('2026-01-01T13:00:00.000Z'); // 20:00 WIB
  });

  it('menghindari quiet hours yang melewati tengah malam', () => {
    const now = new Date('2026-01-01T20:00:00.000Z'); // 03:00 WIB 2 Jan
    const next = computeNextRun(
      {
        ...base,
        minMinutes: 30,
        quietHours: { start: '22:00', end: '04:00' }
      },
      now,
      () => 0
    );
    expect(next.toISOString()).toBe('2026-01-01T21:00:00.000Z'); // 04:00 WIB 2 Jan
  });

  it('tidak mengubah kandidat bila sudah berada di slot valid', () => {
    const now = new Date('2026-01-01T05:00:00.000Z');
    expect(shiftIntoAllowedSlot(now, base).toISOString()).toBe(now.toISOString());
  });
});
