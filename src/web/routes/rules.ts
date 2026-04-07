import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { Rule } from '../../config/index.js';
import type { FolderCache } from '../../folders/index.js';

/** Check whether a rule's destination folder exists in the cached folder tree. */
function checkFolderWarnings(rule: Rule, folderCache: FolderCache): string[] {
  const warnings: string[] = [];
  const action = rule.action;
  if (action.type === 'move' || (action.type === 'review' && 'folder' in action && action.folder)) {
    const folder = action.type === 'move' ? action.folder : (action as { folder?: string }).folder;
    if (folder && !folderCache.hasFolder(folder)) {
      warnings.push(`Destination folder "${folder}" not found on server`);
    }
  }
  return warnings;
}

export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/rules', async () => {
    return deps.configRepo.getRules();
  });

  app.post('/api/rules', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const rule = deps.configRepo.addRule(body as any);
      const warnings = checkFolderWarnings(rule, deps.getFolderCache());
      return reply.status(201).send(warnings.length > 0 ? { ...rule, warnings } : rule);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });

  app.put<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    try {
      const rule = deps.configRepo.updateRule(id, body as any);
      if (!rule) return reply.status(404).send({ error: 'Rule not found' });
      const warnings = checkFolderWarnings(rule, deps.getFolderCache());
      return warnings.length > 0 ? { ...rule, warnings } : rule;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = deps.configRepo.deleteRule(id);
    if (!ok) return reply.status(404).send({ error: 'Rule not found' });
    return reply.status(204).send();
  });

  app.put<{ Body: Array<{ id: string; order: number }> }>('/api/rules/reorder', async (request, reply) => {
    const pairs = request.body as Array<{ id: string; order: number }>;
    if (!Array.isArray(pairs)) {
      return reply.status(400).send({ error: 'Expected array of {id, order} pairs' });
    }
    return deps.configRepo.reorderRules(pairs);
  });
}
