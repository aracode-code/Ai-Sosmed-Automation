import type { FastifyPluginAsync } from 'fastify';
import { listSocialAccounts, type DatabaseHandle } from '@saa/database';

export interface AccountRoutesDeps {
  db: DatabaseHandle;
}

export const accountRoutes: FastifyPluginAsync<AccountRoutesDeps> = async (app, deps) => {
  app.get('/api/v1/accounts', async () => ({
    items: listSocialAccounts(deps.db.raw).map((account) => ({
      id: account.id,
      platform: account.platform,
      label: account.label,
      connectionStatus: account.connectionStatus
    }))
  }));
};
