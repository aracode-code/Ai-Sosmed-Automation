import { createDeepSeekClient, createPlanner, type Planner } from '@saa/agent-core';
import { openDatabase, resolveWorkspacePath, runMigrations } from '@saa/database';
import type { SocialAdapter } from '@saa/domain';
import { createLogger } from '@saa/observability';
import {
  createContentProductionEnqueuer,
  createPublicationEnqueuer,
  Scheduler,
  ScheduleDispatchLoop,
  type EnqueueFn
} from '@saa/scheduler';
import { Dispatcher, runStartupRecovery, Worker } from '@saa/workflow';
import { MockYouTubeAdapter } from '@saa/youtube';
import { buildApp } from './app';
import { loadAiCredentials, loadConfig, type AppConfig } from './config';
import { buildHandlerRegistry } from './handlers';

function buildPlanner(logger: ReturnType<typeof createLogger>): Planner | undefined {
  const credentials = loadAiCredentials();
  if (credentials === null) {
    logger.warn(
      'DEEPSEEK_API_KEY tidak ditemukan; job PLAN_CONTENT tidak terdaftar dan akan jatuh ke NEEDS_ATTENTION'
    );
    return undefined;
  }
  return createPlanner({ llm: createDeepSeekClient({ apiKey: credentials.apiKey }) });
}

function buildPublisher(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>
): SocialAdapter | undefined {
  if (config.youtubeAdapter === 'api') {
    logger.warn(
      'YOUTUBE_ADAPTER=api belum terhubung ke handler (slice A4, ADR-0008); job PUBLISH tidak terdaftar'
    );
    return undefined;
  }
  if (config.youtubeAdapter !== 'mock') {
    logger.warn(
      'YOUTUBE_ADAPTER=off; job PUBLISH tidak terdaftar dan akan jatuh ke NEEDS_ATTENTION'
    );
    return undefined;
  }
  logger.warn(
    'YOUTUBE_ADAPTER=mock; publikasi YouTube bersifat PALSU (tanpa unggahan nyata) — jangan dipakai di produksi'
  );
  return new MockYouTubeAdapter();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    component: 'local-api',
    pretty: config.env === 'development'
  });

  const databasePath = resolveWorkspacePath(config.databasePath);
  const mediaRoot = resolveWorkspacePath(config.mediaRoot);
  const db = openDatabase(databasePath);
  const applied = runMigrations(db.raw);
  logger.info({ database: databasePath, applied }, 'migrasi selesai');

  const recovery = runStartupRecovery(db, { logger });
  if (recovery.requeued.length + recovery.escalated.length > 0) {
    logger.warn(
      { requeued: recovery.requeued.length, escalated: recovery.escalated.length },
      'job dipulihkan setelah restart'
    );
  }

  const planner = buildPlanner(logger);
  const publisher = buildPublisher(config, logger);
  const handlers = buildHandlerRegistry({
    db,
    mediaRoot,
    ...(planner === undefined ? {} : { planner }),
    ...(publisher === undefined ? {} : { publisher })
  });

  const dispatcher = new Dispatcher({
    db,
    workerId: `worker_${process.pid}`,
    handlers,
    logger
  });
  const worker = new Worker({
    runner: dispatcher,
    intervalMs: config.workerIntervalMs,
    logger
  });

  const publicationEnqueue = createPublicationEnqueuer({
    db,
    platforms: publisher === undefined ? [] : [publisher.platform]
  });
  const productionEnqueue = createContentProductionEnqueuer({ db });

  // Publikasi lebih dulu: konten yang siap pada slot ini tidak boleh tertahan
  // oleh produksi konten berikutnya di slot yang sama.
  const enqueue: EnqueueFn = async (schedule, context) => {
    const published = await publicationEnqueue(schedule, context);
    const planned =
      planner === undefined ? [] : await productionEnqueue(schedule, context);
    return [...published, ...planned];
  };

  const dispatchLoop = new ScheduleDispatchLoop({
    scheduler: new Scheduler(db),
    enqueue,
    intervalMs: config.schedulerIntervalMs,
    logger
  });

  const app = buildApp({
    db,
    config,
    logger,
    version: '0.1.0',
    workerActive: () => worker.isRunning
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown dimulai');
    // Dispatch dihentikan lebih dulu agar tidak ada job baru saat worker berhenti.
    await dispatchLoop.stop();
    await worker.stop();
    await app.close();
    db.close();
    logger.info('shutdown selesai');
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(
      {
        host: config.host,
        port: config.port,
        mediaRoot,
        handlers: Object.keys(handlers)
      },
      'local api siap'
    );

    if (config.workerEnabled) {
      worker.start();
      logger.info({ intervalMs: config.workerIntervalMs }, 'worker dimulai');
    } else {
      logger.warn('worker dimatikan (WORKER_ENABLED=false); job tidak akan diproses');
    }

    if (!config.schedulerEnabled) {
      logger.warn('dispatch jadwal dimatikan (SCHEDULER_ENABLED=false)');
    } else if (publisher === undefined) {
      logger.warn('adapter publikasi belum aktif; dispatch jadwal tidak dijalankan');
    } else if (!config.workerEnabled) {
      logger.warn('worker dimatikan; dispatch jadwal tidak dijalankan agar antrean tidak menumpuk');
    } else {
      if (planner === undefined) {
        logger.warn(
          'planner tidak aktif; produksi konten otomatis tidak dijalankan (hanya publikasi konten yang sudah ada)'
        );
      }
      dispatchLoop.start();
      logger.info({ intervalMs: config.schedulerIntervalMs }, 'dispatch jadwal dimulai');
    }
  } catch (error) {
    logger.error({ err: error }, 'gagal menjalankan local api');
    db.close();
    process.exitCode = 1;
  }
}

void main();
