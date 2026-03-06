import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerActivityRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/activity — recent activity (query: limit, offset)
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/activity', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    return deps.activityLog.getRecentActivity(limit, offset);
  });
}
