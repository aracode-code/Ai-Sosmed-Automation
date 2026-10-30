import { describe, expect, it } from 'vitest';
import { validateScheduleConfig, type ScheduleConfig } from './index';

function config(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    mode: 'random',
    minMinutes: 30,
    maxMinutes: 120,
    windowStart: null,
    windowEnd: null,
    timezone: 'Asia/Jakarta',
    dailyLimit: 2,
    quietHours: null,
    enabled: true,
    ...overrides
  };
}

describe('validateScheduleConfig', () => {
  it('menerima konfigurasi random yang valid', () => {
    expect(validateScheduleConfig(config())).toEqual({ ok: true, issues: [] });
  });

  it('menolak minMinutes kurang dari 1', () => {
    const result = validateScheduleConfig(config({ minMinutes: 0 }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('minMinutes minimal 1');
  });

  it('menolak maxMinutes lebih kecil dari minMinutes', () => {
    const result = validateScheduleConfig(config({ minMinutes: 120, maxMinutes: 60 }));
    expect(result.issues).toContain('maxMinutes tidak boleh kurang dari minMinutes');
  });

  it('mode fixed wajib punya minMinutes', () => {
    const result = validateScheduleConfig(
      config({ mode: 'fixed', minMinutes: null, maxMinutes: null })
    );
    expect(result.issues).toContain('mode fixed memerlukan minMinutes');
  });

  it('mode random wajib punya kedua batas', () => {
    const result = validateScheduleConfig(config({ mode: 'random', maxMinutes: null }));
    expect(result.ok).toBe(false);
  });

  it('window harus berpasangan dan berformat HH:mm', () => {
    expect(validateScheduleConfig(config({ windowStart: '09:00' })).issues).toContain(
      'windowStart dan windowEnd harus diisi bersamaan'
    );
    expect(
      validateScheduleConfig(config({ windowStart: '9:00', windowEnd: '17:00' })).issues
    ).toContain('windowStart harus berformat HH:mm');
  });

  it('window boleh melewati tengah malam', () => {
    expect(
      validateScheduleConfig(config({ windowStart: '22:00', windowEnd: '02:00' })).ok
    ).toBe(true);
  });

  it('quiet hours divalidasi', () => {
    expect(
      validateScheduleConfig(config({ quietHours: { start: '22:00', end: '22:00' } })).issues
    ).toContain('quietHours.start dan quietHours.end tidak boleh sama');
  });

  it('menolak timezone yang tidak dikenal', () => {
    expect(validateScheduleConfig(config({ timezone: 'Mars/Olympus' })).issues).toContain(
      'timezone "Mars/Olympus" tidak dikenal'
    );
  });

  it('menolak dailyLimit nol', () => {
    expect(validateScheduleConfig(config({ dailyLimit: 0 })).issues).toContain(
      'dailyLimit minimal 1'
    );
  });
});
