import type { FastifyPluginAsync } from 'fastify';
import { getDashboardSummary, type DatabaseHandle } from '@saa/database';
import { z } from 'zod';

export interface DashboardRoutesDeps {
  db: DatabaseHandle;
  now?: () => Date;
}

const querySchema = z.object({
  recentFailures: z.coerce.number().int().min(1).max(20).optional(),
  trendDays: z.coerce.number().int().min(1).max(30).optional()
});

/** Ringkasan baca-saja untuk halaman dashboard (LLD §6). */
export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesDeps> = async (app, deps) => {
  const now = deps.now ?? (() => new Date());

  app.get('/api/v1/dashboard/summary', async (request) => {
    const query = querySchema.parse(request.query);
    return {
      generatedAt: now().toISOString(),
      ...getDashboardSummary(deps.db.raw, {
        nowIso: now().toISOString(),
        ...(query.recentFailures === undefined ? {} : { recentFailures: query.recentFailures }),
        ...(query.trendDays === undefined ? {} : { trendDays: query.trendDays })
      })
    };
  });
};
