import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerReviewConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/review', async () => {
    return deps.configRepo.getReviewConfig();
  });

  app.put('/api/config/review', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const updated = await deps.configRepo.updateReviewConfig(body as any);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });

  // Cursor toggle settings
  app.get('/api/settings/cursor', async () => {
    const value = deps.activityLog.getState('cursorEnabled');
    return { enabled: value !== 'false' };
  });

  app.put('/api/settings/cursor', async (request) => {
    const body = request.body as { enabled: boolean };
    deps.activityLog.setState('cursorEnabled', body.enabled ? 'true' : 'false');
    return { enabled: body.enabled };
  });
}
