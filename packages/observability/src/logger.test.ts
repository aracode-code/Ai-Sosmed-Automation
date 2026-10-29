import { describe, expect, it } from 'vitest';
import { createLogger, sanitizeForLog } from './index';

describe('sanitizeForLog', () => {
  it('meredaksi kunci sensitif pada objek bersarang', () => {
    const sanitized = sanitizeForLog({
      user: 'ayu',
      auth: { token: 'abc', nested: { refreshToken: 'xyz' } },
      list: [{ password: 'rahasia' }]
    }) as Record<string, unknown>;

    expect(sanitized.user).toBe('ayu');
    expect(sanitized.auth).toEqual({
      token: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]' }
    });
    expect((sanitized.list as Record<string, unknown>[])[0]).toEqual({ password: '[REDACTED]' });
  });

  it('tidak mengubah nilai primitif dan null', () => {
    expect(sanitizeForLog('teks')).toBe('teks');
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog(42)).toBe(42);
  });
});

describe('logger', () => {
  it('tidak menulis token ke output', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) }
    });

    logger.info(
      { context: { token: 'super-rahasia', campaign: 'cmp_1' } },
      'uji redaksi'
    );

    const output = lines.join('');
    expect(output).not.toContain('super-rahasia');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('cmp_1');
  });
});
