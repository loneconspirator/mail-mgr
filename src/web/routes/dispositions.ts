import type { FastifyInstance } from 'fastify';
import type { Rule } from '../../config/schema.js';
import type { ServerDeps } from '../server.js';

const DISPOSITION_TYPES = ['skip', 'delete', 'review', 'move'] as const;
type DispositionType = typeof DISPOSITION_TYPES[number];

export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    (m.readStatus === undefined || m.readStatus === 'any')
  );
}

export function isValidDispositionType(type: string): type is DispositionType {
  return (DISPOSITION_TYPES as readonly string[]).includes(type);
}

export function registerDispositionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/dispositions', async (request, reply) => {
    const rules = deps.configRepo.getRules();
    const senderOnly = rules.filter(isSenderOnly);

    const raw = (request.query as Record<string, unknown>).type;
    const type = typeof raw === 'string' ? raw : undefined;

    if (type !== undefined) {
      if (!isValidDispositionType(type)) {
        return reply.status(400).send({
          error: 'Invalid disposition type',
          valid: DISPOSITION_TYPES,
        });
      }
      return senderOnly.filter(r => r.action.type === type);
    }

    return senderOnly;
  });
}
