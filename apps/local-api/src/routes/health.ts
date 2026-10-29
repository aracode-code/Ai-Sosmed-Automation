import type { FastifyPluginAsync } from 'fastify';
import type { DatabaseHandle } from '@saa/database';

export interface HealthRoutesDeps {
  db: DatabaseHandle;
  version: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesDeps> = async (app, deps) => {
  const handler = async () => {
    let dbState: 'ok' | 'error' = 'ok';
    try {
      deps.db.raw.prepare('SELECT 1').get();
    } catch {
      dbState = 'error';
    }

    return {
      status: dbState === 'ok' ? 'ok' : 'degraded',
      version: deps.version,
      db: dbState,
      workers: { active: 0 },
      time: new Date().toISOString()
    };
  };

  app.get('/health', handler);
  app.get('/api/v1/health', handler);
};
