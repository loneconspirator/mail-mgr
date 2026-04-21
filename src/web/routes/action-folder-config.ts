import type { FastifyInstance } from 'fastify';
import type { ActionFolderConfig } from '../../shared/types.js';
import type { ServerDeps } from '../server.js';

export function registerActionFolderConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/action-folders', async () => {
    return deps.configRepo.getActionFolderConfig();
  });

  app.put('/api/config/action-folders', async (request, reply) => {
    const body = request.body;
    if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'Request body must be a JSON object' });
    }
    try {
      const updated = await deps.configRepo.updateActionFolderConfig(body as Partial<ActionFolderConfig>);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed' });
    }
  });
}
