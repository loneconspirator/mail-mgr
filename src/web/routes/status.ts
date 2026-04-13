import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { StatusResponse } from '../../shared/types.js';

export function registerStatusRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/status — connection state, messages processed
  app.get('/api/status', async (): Promise<StatusResponse> => {
    const state = deps.monitor.getState();
    return {
      connectionStatus: state.connectionStatus,
      lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
      messagesProcessed: state.messagesProcessed,
    };
  });
}
