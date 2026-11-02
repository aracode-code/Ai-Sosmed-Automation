import { describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import {
  applyAspectRatio,
  buildSetRatioExpression,
  PANEL_OPEN_EXPRESSION
} from './flow-generator';

function fakePage(responses: unknown[]): {
  page: Parameters<typeof applyAspectRatio>[0];
  calls: { evaluate: string[]; escaped: number; waited: number };
} {
  const calls = { evaluate: [] as string[], escaped: 0, waited: 0 };
  const page = {
    async evaluate<T>(expression: string): Promise<T> {
      calls.evaluate.push(expression);
      const next = responses.shift();
      if (next === undefined) throw new Error('tidak ada respons tersisa');
      return next as T;
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
    expect(expression).toContain("trim() === 'Simpan'");
    expect(expression).toContain('simpan-tidak-ada');
  });

  it('membuka panel secara kondisional dan menunggu model ter-render', () => {
    const expression = buildSetRatioExpression('video', '9:16');
    expect(expression).toContain('if (!findModel())');
    expect(expression).toContain('if (!panelOpen())');
    expect(expression).toContain('await wait(200)');
  });

  it('memverifikasi aria-checked sebelum menekan Simpan', () => {
    const expression = buildSetRatioExpression('video', '9:16');
    const checkIndex = expression.indexOf("getAttribute('aria-checked') !== 'true'");
    const saveIndex = expression.indexOf('save.click()');
    expect(checkIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBeGreaterThan(checkIndex);
    expect(expression).toContain('rasio-belum-aktif');
  });
});

describe('applyAspectRatio', () => {
  it('berhasil dalam satu langkah tanpa membuka ulang panel', async () => {
    const { page, calls } = fakePage(['ok']);
    await expect(applyAspectRatio(page, 'video', '9:16')).resolves.toBeUndefined();

    expect(calls.evaluate).toHaveLength(1);
    expect(calls.evaluate[0]).toContain('aria-checked');
    expect(calls.evaluate[0]).toContain('save.click()');
    expect(calls.escaped).toBe(0);
  });

  it('gagal eksplisit bila rasio tidak ditemukan lalu menutup panel', async () => {
    const { page, calls } = fakePage(['rasio-tidak-ada', true, 'ok', false]);

    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toMatchObject({
      errorClass: 'UI_CHANGED'
    });
    expect(calls.evaluate).toHaveLength(4);
    expect(calls.evaluate[1]).toBe(PANEL_OPEN_EXPRESSION);
    expect(calls.escaped).toBe(0);
  });

  it('tidak menyentuh panel bila sudah tertutup pada jalur gagal', async () => {
    const { page, calls } = fakePage(['model-tidak-ada', false]);
    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toBeInstanceOf(AppError);
    expect(calls.evaluate).toHaveLength(2);
    expect(calls.escaped).toBe(0);
  });

  it('gagal bila radio tidak aktif setelah diklik', async () => {
    const { page } = fakePage(['rasio-belum-aktif', false]);

    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toThrow(/rasio 9:16/);
  });

  it('memakai Escape sebagai fallback bila toggle gagal menutup panel', async () => {
    const { page, calls } = fakePage(['rasio-tidak-ada', true, 'ok', true]);

    await expect(applyAspectRatio(page, 'video', '9:16')).rejects.toBeInstanceOf(AppError);
    expect(calls.escaped).toBe(1);
  });

  it('gagal bila cakupan section tidak dapat ditentukan', async () => {
    const { page } = fakePage(['scope-tidak-ditemukan', false]);

    await expect(applyAspectRatio(page, 'image', '1:1')).rejects.toBeInstanceOf(AppError);
  });
});
