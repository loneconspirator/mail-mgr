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
      success: r.success,
      error: r.error,
    }));
  });
}
