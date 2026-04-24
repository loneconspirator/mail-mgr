import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { ActivityEntry } from '../../shared/types.js';

export function registerActivityRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/activity — recent activity (query: limit, offset)
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/activity', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    const rows = deps.activityLog.getRecentActivity(limit, offset);
    return rows.map((r): ActivityEntry => ({
      id: r.id,
      timestamp: r.timestamp,
      uid: r.message_uid,
      messageId: r.message_id,
      from: r.message_from,
      to: r.message_to,
      subject: r.message_subject,
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      action: r.action,
      folder: r.folder,
      source: (r as unknown as { source?: string }).source ?? 'arrival',
      success: r.success,
      error: r.error,
    }));
  });

  // DELETE /api/activity — purge entries by action and optional source
  app.delete('/api/activity', async (request, reply) => {
    const query = request.query as { action?: string; source?: string };
    if (!query.action) {
      return reply.status(400).send({ error: 'action query parameter required' });
    }
    const deleted = deps.activityLog.purgeByAction(query.action, query.source);
    return { deleted };
  });

  // GET /api/activity/recent-folders -- distinct folder destinations, most recent first
  app.get<{ Querystring: { limit?: string } }>('/api/activity/recent-folders', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '5', 10) || 5, 1), 20);
    return deps.activityLog.getRecentFolders(limit);
  });
}
