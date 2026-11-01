import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlowPlaywrightGenerator } from './flow-playwright-generator';
import type { FlowReadiness } from './flow-readiness';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'saa-flow-gen-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const READY: FlowReadiness = {
  url: 'https://flow.google.com/project/x',
  title: 'Flow',
  promptPresent: true,
  submitPresent: true,
  challengeDetected: false
};

describe('FlowPlaywrightGenerator', () => {
  it('meminta kind video dan mengembalikan metadata berkas nyata', async () => {
    const bytes = Buffer.from('ftypmp42-dummy');
    let captured: { kind: string; prompt: string; dir: string; endpoint: string } | null = null;

    const generator = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => READY,
      generateMedia: async (options) => {
        captured = {
          kind: options.kind,
          prompt: options.prompt,
          dir: options.outputDirectory,
          endpoint: options.endpoint
        };
        mkdirSync(options.outputDirectory, { recursive: true });
        const filePath = join(options.outputDirectory, 'clip.mp4');
        writeFileSync(filePath, bytes);
        return { filePath, suggestedName: 'clip.mp4', mediaKind: 'video' };
      }
    });

    const result = await generator.generate({
      prompt: 'apel di meja',
      aspectRatio: '16:9',
      outputDirectory: workDir,
      correlationId: 'corr-1'
    });

    expect(captured).toEqual({
      kind: 'video',
      prompt: 'apel di meja',
      dir: join(workDir, 'corr-1'),
      endpoint: 'http://127.0.0.1:9222'
    });
    expect(result.mimeType).toBe('video/mp4');
    expect(result.sizeBytes).toBe(bytes.length);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('menolak berkas hasil yang kosong', async () => {
    const generator = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => READY,
      generateMedia: async (options) => {
        mkdirSync(options.outputDirectory, { recursive: true });
        const filePath = join(options.outputDirectory, 'kosong.mp4');
        writeFileSync(filePath, '');
        return { filePath, suggestedName: 'kosong.mp4', mediaKind: 'video' };
      }
    });

    await expect(
      generator.generate({
        prompt: 'x',
        aspectRatio: '16:9',
        outputDirectory: workDir,
        correlationId: 'corr-2'
      })
    ).rejects.toThrow(/kosong/);
  });

  it('melaporkan tidak tersedia saat ada tantangan verifikasi', async () => {
    const generator = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => ({ ...READY, challengeDetected: true })
    });
    await expect(generator.checkAvailability()).resolves.toEqual({
      available: false,
      reason: expect.stringContaining('tantangan')
    });
  });

  it('melaporkan tidak tersedia saat komposer tidak ditemukan atau browser gagal', async () => {
    const missing = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => ({ ...READY, promptPresent: false })
    });
    expect((await missing.checkAvailability()).available).toBe(false);

    const failing = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => {
        throw new Error('connect ECONNREFUSED');
      }
    });
    expect(await failing.checkAvailability()).toEqual({
      available: false,
      reason: 'connect ECONNREFUSED'
    });
  });

  it('tersedia saat komposer siap', async () => {
    const generator = new FlowPlaywrightGenerator({
      endpoint: 'http://127.0.0.1:9222',
      outputRoot: workDir,
      readiness: async () => READY
    });
    await expect(generator.checkAvailability()).resolves.toEqual({ available: true });
  });
});
