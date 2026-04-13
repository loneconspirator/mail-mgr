import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { StatusResponse, MoveTrackerStatusResponse, DeepScanResponse } from '../../shared/types.js';

export function registerStatusRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/status — connection state, messages processed
  app.get('/api/status', async (): Promise<StatusResponse> => {
    const state = deps.getMonitor().getState();
    return {
      connectionStatus: state.connectionStatus,
      lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
      messagesProcessed: state.messagesProcessed,
    };
  });

  // GET /api/tracking/status — move tracker state
  app.get('/api/tracking/status', async (): Promise<MoveTrackerStatusResponse> => {
    const tracker = deps.getMoveTracker();
    if (!tracker) {
      return { enabled: false, lastScanAt: null, messagesTracked: 0, signalsLogged: 0, pendingDeepScan: 0 };
    }
    const state = tracker.getState();
    return {
      enabled: state.enabled,
      lastScanAt: state.lastScanAt,
      messagesTracked: state.messagesTracked,
      signalsLogged: state.signalsLogged,
      pendingDeepScan: state.pendingDeepScan,
    };
  });

  // POST /api/tracking/deep-scan — manually trigger deep scan
  app.post('/api/tracking/deep-scan', async (_req, reply) => {
    const tracker = deps.getMoveTracker();
    if (!tracker || !tracker.getState().enabled) {
      return reply.status(503).send({ error: 'Move tracking is not enabled' });
    }
    const result: DeepScanResponse = await tracker.triggerDeepScan();
    return result;
  });
}
