import { createDeepSeekClient, createPlanner, type Planner } from '@saa/agent-core';
import { FlowPlaywrightGenerator } from '@saa/browser-engine';
import {
  openDatabase,
  resolveWorkspacePath,
  runMigrations,
  type DatabaseHandle
} from '@saa/database';
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
import { DpapiCredentialStore, MockYouTubeAdapter } from '@saa/youtube';
import { buildApp } from './app';
import { createAiCredentialManager, type AiCredentialManager } from './ai-credentials';
import { loadConfig, loadYouTubeCredentials, type AppConfig } from './config';
import { buildHandlerRegistry } from './handlers';
import { createLazyPlanner } from './lazy-planner';
import { createYouTubeApiPublisher } from './publisher';

function buildPlanner(aiCredentials: AiCredentialManager): Planner {
  return createLazyPlanner({
    credentials: aiCredentials,
    create: (apiKey) => createPlanner({ llm: createDeepSeekClient({ apiKey }) })
  });
}

function buildPublisher(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
  db: DatabaseHandle
): SocialAdapter | undefined {
  if (config.youtubeAdapter === 'api') {
    const credentials = loadYouTubeCredentials();
    if (credentials === null) {
      logger.warn(
        'GOOGLE_OAUTH_CLIENT_ID tidak ditemukan; YOUTUBE_ADAPTER=api tidak aktif dan job PUBLISH tidak terdaftar'
      );
      return undefined;
    }
    if (config.youtubeAppStatus === 'testing') {
      logger.error(
        'YOUTUBE_APP_STATUS=testing: refresh token Google hanya berlaku 7 hari sehingga pairing harus diulang; ADR-0008 melarang operasi pada status ini'
      );
    } else if (config.youtubeAppStatus !== 'production') {
      logger.warn(
        'YOUTUBE_APP_STATUS belum dilaporkan; pastikan OAuth app dipublikasikan (Production), bukan Testing'
      );
    }
    logger.info(
      { privacy: config.youtubeUploadPrivacy },
      'YOUTUBE_ADAPTER=api; adapter YouTube Data API v3 aktif (ADR-0008)'
    );
    return createYouTubeApiPublisher({ db, config, credentials });
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

  const aiCredentials = createAiCredentialManager({
    store: new DpapiCredentialStore()
  });
  await aiCredentials.refresh();
  if (aiCredentials.status().storeError) {
    logger.warn(
      'kredensial AI tersimpan tidak dapat dibaca; memakai environment bila tersedia, isi ulang lewat Connections'
    );
  }
  if (!aiCredentials.isConfigured()) {
    logger.warn(
      'kunci DeepSeek belum dikonfigurasi; PLAN_CONTENT akan eskalasi AUTH sampai kunci diisi lewat Connections'
    );
  }

  const planner = buildPlanner(aiCredentials);
  const publisher = buildPublisher(config, logger, db);
  const generator =
    config.flowAdapter === 'real'
      ? new FlowPlaywrightGenerator({
          endpoint: config.flowCdpEndpoint,
          outputRoot: mediaRoot
        })
      : undefined;
  if (generator !== undefined) {
    logger.info(
      { endpoint: config.flowCdpEndpoint },
      'generator Flow nyata aktif; pembuatan akan memakai kredit akun'
    );
  }
  const handlers = buildHandlerRegistry({
    db,
    mediaRoot,
    ...(generator === undefined ? {} : { generator }),
    planner,
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
    // Produksi konten ditahan selama kunci AI belum ada agar slot tidak
    // menghasilkan job PLAN_CONTENT yang pasti berakhir NEEDS_ATTENTION.
    const planned = aiCredentials.isConfigured()
      ? await productionEnqueue(schedule, context)
      : [];
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
    workerActive: () => worker.isRunning,
    aiCredentials
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
      if (!aiCredentials.isConfigured()) {
        logger.warn(
          'kunci DeepSeek belum diisi; produksi konten otomatis ditahan (hanya publikasi konten yang sudah ada)'
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
