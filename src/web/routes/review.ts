import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { ReviewStatusResponse } from '../../shared/types.js';

export function registerReviewRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/review/status', async (): Promise<ReviewStatusResponse> => {
    if (!deps.sweeper) {
      return {
        folder: 'Review',
        totalMessages: 0,
        unreadMessages: 0,
        readMessages: 0,
        nextSweepAt: null,
        lastSweep: null,
      };
    }
    return deps.sweeper.getState();
  });
}
