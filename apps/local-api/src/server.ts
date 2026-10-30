import { createDeepSeekClient, createPlanner, type Planner } from '@saa/agent-core';
import { openDatabase, resolveWorkspacePath, runMigrations } from '@saa/database';
import type { SocialAdapter } from '@saa/domain';
import { createLogger } from '@saa/observability';
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

  const app = buildApp({
    db,
    config,
    logger,
    version: '0.1.0',
    workerActive: () => worker.isRunning
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown dimulai');
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
  } catch (error) {
    logger.error({ err: error }, 'gagal menjalankan local api');
    db.close();
    process.exitCode = 1;
  }
}

void main();
