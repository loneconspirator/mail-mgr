import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/rules', async () => {
    return deps.configRepo.getRules();
  });

  app.post('/api/rules', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const rule = deps.configRepo.addRule(body as any);
      return reply.status(201).send(rule);
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
      return rule;
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
