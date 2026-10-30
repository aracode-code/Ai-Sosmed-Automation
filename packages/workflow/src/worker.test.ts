import { describe, expect, it } from 'vitest';
import { appError, type Job } from '@saa/domain';
import type { LoggerLike } from './dispatcher';
import { Worker, type JobRunner } from './worker';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function fakeJob(id: string): Job {
  return { id } as Job;
}

function recordingLogger() {
  const errors: Array<{ errorClass?: string; msg?: string }> = [];
  const logger: LoggerLike = {
    info: () => undefined,
    warn: () => undefined,
    error: (obj, msg) => {
      const errorClass = (obj as { errorClass?: string }).errorClass;
      errors.push({
        ...(errorClass === undefined ? {} : { errorClass }),
        ...(msg === undefined ? {} : { msg })
      });
    }
  };
  return { logger, errors };
}

describe('Worker.runOnce', () => {
  it('mendelegasikan ke runner dan mengembalikan job', async () => {
    const calls: string[] = [];
    const runner: JobRunner = {
      runOnce: async () => {
        calls.push('run');
        return fakeJob('job_1');
      }
    };
    const worker = new Worker({ runner, intervalMs: 5 });

    const job = await worker.runOnce();

    expect(calls).toEqual(['run']);
    expect(job?.id).toBe('job_1');
  });

  it('menelan error runner, mencatat kelas error, dan mengembalikan null', async () => {
    const { logger, errors } = recordingLogger();
    const runner: JobRunner = {
      runOnce: async () => {
        throw appError('TRANSIENT_NETWORK', 'koneksi putus');
      }
    };
    const worker = new Worker({ runner, intervalMs: 5, logger });

    await expect(worker.runOnce()).resolves.toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.errorClass).toBe('TRANSIENT_NETWORK');
    expect(errors[0]?.msg).toBe('worker: siklus gagal');
  });
});

describe('Worker lifecycle', () => {
  it('menjalankan siklus berkala setelah start dan berhenti total setelah stop', async () => {
    let ticks = 0;
    const runner: JobRunner = {
      runOnce: async () => {
        ticks += 1;
        return null;
      }
    };
    const worker = new Worker({ runner, intervalMs: 5 });
    expect(worker.isRunning).toBe(false);

    worker.start();
    expect(worker.isRunning).toBe(true);
    await sleep(60);
    await worker.stop();

    const afterStop = ticks;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    expect(worker.isRunning).toBe(false);

    await sleep(40);
    expect(ticks).toBe(afterStop);
  });

  it('start ganda tidak menggandakan timer', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let calls = 0;
    const runner: JobRunner = {
      runOnce: async () => {
        calls += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent -= 1;
        return null;
      }
    };
    const worker = new Worker({ runner, intervalMs: 5 });

    worker.start();
    worker.start();
    worker.start();
    await sleep(90);
    await worker.stop();

    expect(maxConcurrent).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
