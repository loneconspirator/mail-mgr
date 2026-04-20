import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

// Re-export for backward compatibility; also used locally in registerDispositionRoutes
export { isSenderOnly } from '../../rules/sender-utils.js';
import { isSenderOnly } from '../../rules/sender-utils.js';

const DISPOSITION_TYPES = ['skip', 'delete', 'review', 'move'] as const;
type DispositionType = typeof DISPOSITION_TYPES[number];

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
