import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MediaProbe, ProbeResult } from './types';

const execFileAsync = promisify(execFile);

/** Dipakai bila ffprobe tidak tersedia: pipeline tetap berjalan tanpa durasi. */
export const unavailableProbe: MediaProbe = {
  async probe(): Promise<ProbeResult> {
    return { durationMs: null, available: false };
  }
};

export interface FfprobeOptions {
  executable?: string;
  timeoutMs?: number;
}

interface FfprobeOutput {
  format?: { duration?: string };
}

/**
 * Probe berbasis ffprobe. Kegagalan eksekusi tidak melempar error melainkan
 * ditandai `available: false` (degradasi wajib, X-16).
 */
export function createFfprobeProbe(options: FfprobeOptions = {}): MediaProbe {
  const executable = options.executable ?? 'ffprobe';
  const timeout = options.timeoutMs ?? 5_000;

  return {
    async probe(filePath: string): Promise<ProbeResult> {
      try {
        const { stdout } = await execFileAsync(
          executable,
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'json',
            filePath
          ],
          { timeout, windowsHide: true }
        );
        const parsed = JSON.parse(stdout) as FfprobeOutput;
        const seconds = Number(parsed.format?.duration);
        return {
          durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
          available: true
        };
      } catch {
        return { durationMs: null, available: false };
      }
    }
  };
}
