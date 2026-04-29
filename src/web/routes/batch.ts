import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerDeps } from '../server.js';

const batchBodySchema = z.object({
  sourceFolder: z.string().min(1).max(500),
});

export function registerBatchRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // POST /api/batch/dry-run
  app.post('/api/batch/dry-run', async (req, reply) => {
    const parsed = batchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const engine = deps.getBatchEngine();
    try {
      const results = await engine.dryRun(parsed.data.sourceFolder);
      return { results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Batch already running') {
        return reply.status(409).send({ error: message });
      }
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/batch/execute
  app.post('/api/batch/execute', async (req, reply) => {
    const parsed = batchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }
    const engine = deps.getBatchEngine();
    // Fire-and-forget: engine.execute is async, so concurrent-run errors
    // surface as a rejected promise (logged here) rather than a synchronous
    // throw the route can map to HTTP 409. Status reflects only that the
    // request was accepted; clients poll GET /api/batch/status for outcome.
    engine.execute(parsed.data.sourceFolder).catch((err: unknown) => {
      app.log.error({ err }, 'Batch execution failed');
    });
    return { status: 'started' };
  });

  // POST /api/batch/cancel
  app.post('/api/batch/cancel', async () => {
    deps.getBatchEngine().cancel();
    return { status: 'cancelling' };
  });

  // GET /api/batch/status
  app.get('/api/batch/status', async () => {
    return deps.getBatchEngine().getState();
  });
}
