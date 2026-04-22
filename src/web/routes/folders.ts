import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerFolderRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/folders', async (request, reply) => {
    const query = request.query as { refresh?: string };
    const forceRefresh = query.refresh === 'true';
    try {
      const cache = deps.getFolderCache();
      await cache.getTree(forceRefresh);
      return cache.getResponse();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return reply.status(503).send({ error: 'Folder list unavailable - IMAP not connected' });
    }
  });
}
