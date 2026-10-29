import { openDatabase, runMigrations } from '@saa/database';
import { createLogger } from '@saa/observability';
import { runStartupRecovery } from '@saa/workflow';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    component: 'local-api',
    pretty: config.env === 'development'
  });

  const db = openDatabase(config.databasePath);
  const applied = runMigrations(db.raw);
  logger.info({ database: config.databasePath, applied }, 'migrasi selesai');

  const recovery = runStartupRecovery(db, { logger });
  logger.info(
    { requeued: recovery.requeued.length, escalated: recovery.escalated.length },
    'startup recovery selesai'
  );

  const app = buildApp({ db, config, logger, version: '0.1.0' });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown dimulai');
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
    logger.info({ host: config.host, port: config.port }, 'local api siap');
  } catch (error) {
    logger.error({ err: error }, 'gagal menjalankan local api');
    db.close();
    process.exitCode = 1;
  }
}

void main();
