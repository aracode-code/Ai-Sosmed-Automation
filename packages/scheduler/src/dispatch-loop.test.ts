import { describe, expect, it } from 'vitest';
import { appError } from '@saa/domain';
import type { RunSummary } from './scheduler';
import { ScheduleDispatchLoop, type DispatchLogger } from './dispatch-loop';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const EMPTY_SUMMARY: RunSummary = {
  paused: false,
  due: 0,
  seeded: 0,
  shifted: 0,
  quotaSkipped: 0,
  enqueued: 0,
  failed: []
};

function recordingLogger() {
  const infos: Array<{ msg?: string; enqueued?: number }> = [];
  const errors: Array<{ errorClass?: string; msg?: string }> = [];
  const logger: DispatchLogger = {
    info: (obj, msg) => {
      const enqueued = (obj as { enqueued?: number }).enqueued;
      infos.push({ ...(msg === undefined ? {} : { msg }), ...(enqueued === undefined ? {} : { enqueued }) });
    },
    warn: () => undefined,
    error: (obj, msg) => {
      const errorClass = (obj as { errorClass?: string }).errorClass;
      errors.push({ ...(errorClass === undefined ? {} : { errorClass }), ...(msg === undefined ? {} : { msg }) });
    }
  };
  return { logger, infos, errors };
}

describe('ScheduleDispatchLoop.runOnce', () => {
  it('mencatat siklus yang membuat job publikasi', async () => {
    const { logger, infos } = recordingLogger();
    const loop = new ScheduleDispatchLoop({
      scheduler: { runOnce: async () => ({ ...EMPTY_SUMMARY, due: 1, enqueued: 1 }) },
      enqueue: () => [],
      logger
    });

    const summary = await loop.runOnce();

    expect(summary?.enqueued).toBe(1);
    expect(infos).toEqual([{ msg: 'scheduler: job publikasi dibuat', enqueued: 1 }]);
  });

  it('menelan error scheduler dan mencatat kelas error', async () => {
    const { logger, errors } = recordingLogger();
    const loop = new ScheduleDispatchLoop({
      scheduler: {
        runOnce: async () => {
          throw appError('TRANSIENT_NETWORK', 'koneksi putus');
        }
      },
      enqueue: () => [],
      logger
    });

    await expect(loop.runOnce()).resolves.toBeNull();
    expect(errors).toEqual([{ errorClass: 'TRANSIENT_NETWORK', msg: 'scheduler: siklus gagal' }]);
  });
});

describe('ScheduleDispatchLoop lifecycle', () => {
  it('menjalankan tick berkala setelah start dan berhenti total setelah stop', async () => {
    let ticks = 0;
    const loop = new ScheduleDispatchLoop({
      scheduler: {
        runOnce: async () => {
          ticks += 1;
          return EMPTY_SUMMARY;
        }
      },
      enqueue: () => [],
      intervalMs: 5
    });
    expect(loop.isRunning).toBe(false);

    loop.start();
    expect(loop.isRunning).toBe(true);
    await sleep(40);
    await loop.stop();

    const afterStop = ticks;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    expect(loop.isRunning).toBe(false);

    await sleep(30);
    expect(ticks).toBe(afterStop);
  });

  it('start ganda tidak menggandakan timer dan tick tidak tumpang tindih', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const loop = new ScheduleDispatchLoop({
      scheduler: {
        runOnce: async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(15);
          concurrent -= 1;
          return EMPTY_SUMMARY;
        }
      },
      enqueue: () => [],
      intervalMs: 5
    });

    loop.start();
    loop.start();
    await sleep(70);
    await loop.stop();

    expect(maxConcurrent).toBe(1);
  });
});
