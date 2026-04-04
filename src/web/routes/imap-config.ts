import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

const PASSWORD_MASK = '****';

function maskImapConfig(imap: { host: string; port: number; tls: boolean; auth: { user: string; pass: string }; idleTimeout: number; pollInterval: number }) {
  return { ...imap, auth: { user: imap.auth.user, pass: PASSWORD_MASK } };
}

export function registerImapConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/imap', async () => {
    return maskImapConfig(deps.configRepo.getImapConfig());
  });

  app.put('/api/config/imap', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const currentImap = deps.configRepo.getImapConfig();

    const authBody = body.auth as { user?: string; pass?: string } | undefined;
    const newImap = {
      ...body,
      auth: {
        user: authBody?.user ?? currentImap.auth.user,
        pass: authBody?.pass === PASSWORD_MASK
          ? currentImap.auth.pass
          : (authBody?.pass ?? currentImap.auth.pass),
      },
    };

    try {
      const updated = await deps.configRepo.updateImapConfig(newImap as any);
      return maskImapConfig(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });
}
