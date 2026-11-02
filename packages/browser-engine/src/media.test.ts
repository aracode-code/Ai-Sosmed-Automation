import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@saa/domain';
import { MockMediaGenerator, validateMediaFile, unavailableProbe } from './index';

const cleanups: (() => void)[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saa-flow-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const request = {
  prompt: 'Animasi tokenisasi kalimat',
  aspectRatio: '9:16' as const,
  outputDirectory: 'content/c1',
  correlationId: 'job_1'
};

describe('MockMediaGenerator', () => {
  it('menghasilkan byte, checksum, dan durasi deterministik', async () => {
    const root = tempRoot();
    const generator = new MockMediaGenerator({ outputRoot: root });

    const first = await generator.generate(request);
    const second = await generator.generate(request);

    expect(first.filePath).toBe(second.filePath);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sizeBytes).toBe(second.sizeBytes);
    expect(first.durationMs).toBe(second.durationMs);
    expect(first.durationMs).toBeGreaterThanOrEqual(8_000);
    expect(first.durationMs).toBeLessThanOrEqual(20_000);

    const bytes = readFileSync(first.filePath);
    expect(bytes.toString('ascii', 4, 8)).toBe('ftyp');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(first.sha256);
  });

  it('prompt berbeda menghasilkan artefak berbeda', async () => {
    const root = tempRoot();
    const generator = new MockMediaGenerator({ outputRoot: root });

    const a = await generator.generate(request);
    const b = await generator.generate({ ...request, prompt: 'Animasi lain' });

    expect(a.sha256).not.toBe(b.sha256);
    expect(a.filePath).not.toBe(b.filePath);
  });

  it('menolak direktori output di luar root', async () => {
    const root = tempRoot();
    const generator = new MockMediaGenerator({ outputRoot: root });

    await expect(
      generator.generate({ ...request, outputDirectory: '..' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('mode image menghasilkan PNG valid dengan dimensi sesuai rasio', async () => {
    const root = tempRoot();
    const generator = new MockMediaGenerator({ outputRoot: root });

    const generated = await generator.generate({ ...request, kind: 'image' });

    expect(generated.mimeType).toBe('image/png');
    expect(generated.durationMs).toBeUndefined();
    expect(generated.sizeBytes).toBeGreaterThanOrEqual(1_024);

    const bytes = readFileSync(generated.filePath);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(72);
    expect(bytes.readUInt32BE(20)).toBe(128);
  });
});

describe('validateMediaFile', () => {
  it('menerima artefak generator dan mengembalikan metadata', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);

    const validated = await validateMediaFile({
      root,
      path: generated.filePath,
      expectedSha256: generated.sha256,
      probe: unavailableProbe
    });

    expect(validated).toMatchObject({
      filePath: generated.filePath,
      mimeType: 'video/mp4',
      sizeBytes: generated.sizeBytes,
      sha256: generated.sha256,
      durationMs: null,
      probeAvailable: false
    });
  });

  it('menolak path di luar root', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);

    await expect(
      validateMediaFile({ root: join(root, 'konten-lain'), path: generated.filePath })
    ).rejects.toMatchObject({ errorClass: 'VALIDATION' });
  });

  it('menolak berkas yang bukan MP4', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(generated.filePath, Buffer.alloc(2_048, 7));

    await expect(validateMediaFile({ root, path: generated.filePath })).rejects.toMatchObject({
      errorClass: 'VALIDATION'
    });
  });

  it('menolak checksum yang tidak cocok', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);

    await expect(
      validateMediaFile({ root, path: generated.filePath, expectedSha256: 'deadbeef' })
    ).rejects.toMatchObject({ errorClass: 'VALIDATION' });
  });

  it('menolak berkas yang tidak ada', async () => {
    const root = tempRoot();
    await expect(
      validateMediaFile({ root, path: join(root, 'hilang.mp4') })
    ).rejects.toMatchObject({ errorClass: 'VALIDATION' });
  });

  it('menolak durasi probe yang tidak masuk akal', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);

    await expect(
      validateMediaFile({
        root,
        path: generated.filePath,
        probe: { async probe() { return { durationMs: 0, available: true }; } }
      })
    ).rejects.toMatchObject({ errorClass: 'VALIDATION' });
  });

  it('menerima PNG pada mode image tanpa memanggil probe', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate({
      ...request,
      kind: 'image'
    });

    const validated = await validateMediaFile({
      root,
      path: generated.filePath,
      kind: 'image',
      expectedSha256: generated.sha256,
      probe: unavailableProbe
    });

    expect(validated).toMatchObject({
      mimeType: 'image/png',
      kind: 'image',
      durationMs: null,
      probeAvailable: false
    });
  });

  it('menolak berkas non-gambar pada mode image', async () => {
    const root = tempRoot();
    const generated = await new MockMediaGenerator({ outputRoot: root }).generate(request);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(generated.filePath, Buffer.alloc(2_048, 7));

    await expect(
      validateMediaFile({ root, path: generated.filePath, kind: 'image' })
    ).rejects.toMatchObject({ errorClass: 'VALIDATION' });
  });
});
