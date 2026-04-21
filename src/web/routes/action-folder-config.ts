import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerActionFolderConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/action-folders', async () => {
    return deps.configRepo.getActionFolderConfig();
  });

  app.put('/api/config/action-folders', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const updated = await deps.configRepo.updateActionFolderConfig(body as any);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });
}
