import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig, ruleSchema } from '../../config/index.js';
import type { ServerDeps } from '../server.js';

export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/rules — list all rules ordered
  app.get('/api/rules', async () => {
    const config = loadConfig(deps.configPath);
    return config.rules.sort((a, b) => a.order - b.order);
  });

  // POST /api/rules — create a new rule
  app.post('/api/rules', async (request, reply) => {
    const config = loadConfig(deps.configPath);
    const body = request.body as Record<string, unknown>;

    const newRule = {
      ...body,
      id: crypto.randomUUID(),
    };

    const result = ruleSchema.safeParse(newRule);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.status(400).send({ error: 'Validation failed', details: issues });
    }

    config.rules.push(result.data);
    saveConfig(deps.configPath, config);
    deps.monitor.updateRules(config.rules);

    return reply.status(201).send(result.data);
  });

  // PUT /api/rules/:id — update a rule
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const config = loadConfig(deps.configPath);
    const { id } = request.params as { id: string };
    const idx = config.rules.findIndex((r) => r.id === id);

    if (idx === -1) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const updated = { ...(request.body as Record<string, unknown>), id };
    const result = ruleSchema.safeParse(updated);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.status(400).send({ error: 'Validation failed', details: issues });
    }

    config.rules[idx] = result.data;
    saveConfig(deps.configPath, config);
    deps.monitor.updateRules(config.rules);

    return result.data;
  });

  // DELETE /api/rules/:id — delete a rule
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const config = loadConfig(deps.configPath);
    const { id } = request.params as { id: string };
    const idx = config.rules.findIndex((r) => r.id === id);

    if (idx === -1) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    config.rules.splice(idx, 1);
    saveConfig(deps.configPath, config);
    deps.monitor.updateRules(config.rules);

    return reply.status(204).send();
  });

  // PUT /api/rules/reorder — bulk reorder
  app.put<{ Body: Array<{ id: string; order: number }> }>('/api/rules/reorder', async (request, reply) => {
    const config = loadConfig(deps.configPath);
    const pairs = request.body as Array<{ id: string; order: number }>;

    if (!Array.isArray(pairs)) {
      return reply.status(400).send({ error: 'Expected array of {id, order} pairs' });
    }

    for (const pair of pairs) {
      const rule = config.rules.find((r) => r.id === pair.id);
      if (rule) {
        rule.order = pair.order;
      }
    }

    saveConfig(deps.configPath, config);
    deps.monitor.updateRules(config.rules);

    return config.rules.sort((a, b) => a.order - b.order);
  });
}
