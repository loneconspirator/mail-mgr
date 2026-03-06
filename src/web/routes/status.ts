import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerStatusRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/status — connection state, messages processed
  app.get('/api/status', async () => {
    const state = deps.monitor.getState();
    return {
      connectionStatus: state.connectionStatus,
      lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
      messagesProcessed: state.messagesProcessed,
    };
  });
}
