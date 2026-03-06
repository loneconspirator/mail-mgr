import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig, imapConfigSchema } from '../../config/index.js';
import type { ServerDeps } from '../server.js';

const PASSWORD_MASK = '****';

export function registerImapConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/config/imap — get IMAP config (password masked)
  app.get('/api/config/imap', async () => {
    const config = loadConfig(deps.configPath);
    return {
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.tls,
      auth: {
        user: config.imap.auth.user,
        pass: PASSWORD_MASK,
      },
      idleTimeout: config.imap.idleTimeout,
      pollInterval: config.imap.pollInterval,
    };
  });

  // PUT /api/config/imap — update IMAP config (triggers reconnect)
  app.put('/api/config/imap', async (request, reply) => {
    const config = loadConfig(deps.configPath);
    const body = request.body as Record<string, unknown>;

    // Build the new IMAP config, preserving password if masked
    const authBody = body.auth as { user?: string; pass?: string } | undefined;
    const newImapPartial = {
      ...body,
      auth: {
        user: authBody?.user ?? config.imap.auth.user,
        pass: authBody?.pass === PASSWORD_MASK
          ? config.imap.auth.pass
          : (authBody?.pass ?? config.imap.auth.pass),
      },
    };

    const result = imapConfigSchema.safeParse(newImapPartial);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return reply.status(400).send({ error: 'Validation failed', details: issues });
    }

    config.imap = result.data;
    saveConfig(deps.configPath, config);

    if (deps.onImapConfigChange) {
      await deps.onImapConfigChange(config);
    }

    return {
      host: result.data.host,
      port: result.data.port,
      tls: result.data.tls,
      auth: {
        user: result.data.auth.user,
        pass: PASSWORD_MASK,
      },
      idleTimeout: result.data.idleTimeout,
      pollInterval: result.data.pollInterval,
    };
  });
}
