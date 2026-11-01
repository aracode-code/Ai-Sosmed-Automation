import { describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import {
  applyAspectRatio,
  buildSetRatioExpression,
  buildVerifyRatioExpression
} from './flow-generator';

function fakePage(responses: string[]): {
  page: Parameters<typeof applyAspectRatio>[0];
  calls: { evaluate: string[]; escaped: number; waited: number };
} {
  const calls = { evaluate: [] as string[], escaped: 0, waited: 0 };
  const page = {
    async evaluate<T>(expression: string): Promise<T> {
      calls.evaluate.push(expression);
      const next = responses.shift();
      if (next === undefined) throw new Error('tidak ada respons tersisa');
      return next as unknown as T;
    },
    keyboard: {
      async press(key: string): Promise<void> {
        if (key === 'Escape') calls.escaped += 1;
      }
    },
    async waitForTimeout(): Promise<void> {
      calls.waited += 1;
    }
  };
  return { page, calls };
}

describe('buildSetRatioExpression', () => {
  it('memakai pola model video dan rasio yang diminta', () => {
    const expression = buildSetRatioExpression('video', '9:16');
    expect(expression).toContain('model default pembuatan video');
    expect(expression).toContain('"9:16"');
  });

  it('memakai pola model gambar untuk kind image', () => {
    expect(buildSetRatioExpression('image', '1:1')).toContain('model default pembuatan gambar');
  });

  it('mencari cakupan berdasarkan kontrak, bukan level tetap', () => {
    const expression = buildSetRatioExpression('video', '16:9');
    expect(expression).toContain('depth < 3');
    expect(expression).toContain('owners === 1');
    expect(expression).not.toContain('i < 5');
  });

  it('mencari tombol Simpan secara global (footer panel)', () => {
    const expression = buildSetRatioExpression('video', '9:16');
    const saveQuery = expression.slice(expression.indexOf("trim() === 'Simpan'") - 120);
    expect(expression).toContain("=== 'Simpan'");
    expect(saveQuery).not.toContain('scope.querySelectorAll');
    expect(expression).toContain('simpan-tidak-ada');
  });
});

describe('buildVerifyRatioExpression', () => {
  it('memeriksa aria-checked pada radio yang sama', () => {
    const expression = buildVerifyRatioExpression('video', '9:16');
    expect(expression).toContain("getAttribute('aria-checked') === 'true'");
    expect(expression).toContain('rasio-belum-aktif');
    expect(expression).not.toContain("=== 'Simpan'");
  });
});

describe('applyAspectRatio', () => {
  it('berhasil bila set dan verifikasi ok', async () => {
    const { page, calls } = fakePage(['ok', 'ok']);
    await expect(applyAspectRatio(page, 'video', '9:16')).resolves.toBeUndefined();

    expect(calls.evaluate).toHaveLength(2);
    expect(calls.evaluate[0]).toContain("=== 'Simpan'");
    expect(calls.evaluate[1]).toContain('aria-checked');
    expect(calls.escaped).toBe(1);
  });

  it('gagal eksplisit bila panel/rasio tidak ditemukan dan tidak lanjut verifikasi', async () => {
    const { page, calls } = fakePage(['rasio-tidak-ada']);

    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toMatchObject({
      errorClass: 'UI_CHANGED'
    });
    expect(calls.evaluate).toHaveLength(1);
    expect(calls.escaped).toBe(1);
  });

  it('gagal bila setelan tidak tersimpan (verifikasi menolak)', async () => {
    const { page } = fakePage(['ok', 'rasio-belum-aktif']);

    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toThrow(/verifikasi rasio/);
  });

  it('gagal bila cakupan section tidak dapat ditentukan', async () => {
    const { page } = fakePage(['scope-tidak-ditemukan']);

    await expect(applyAspectRatio(page, 'image', '1:1')).rejects.toBeInstanceOf(AppError);
  });

  it('menutup panel (Escape) juga pada jalur gagal verifikasi', async () => {
    const { page, calls } = fakePage(['ok', 'panel-tidak-ada']);
    await expect(applyAspectRatio(page, 'video', '16:9')).rejects.toThrow();
    expect(calls.escaped).toBe(1);
  });
});
