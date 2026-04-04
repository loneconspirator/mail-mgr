import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Monitor } from '../monitor/index.js';
import { registerRuleRoutes } from './routes/rules.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerImapConfigRoutes } from './routes/imap-config.js';

export interface ServerDeps {
  config: Config;
  configPath: string;
  activityLog: ActivityLog;
  monitor: Monitor;
  /** Called after IMAP config changes to trigger reconnect */
  onImapConfigChange?: (newConfig: Config) => Promise<void>;
  /** Override static files root for testing (defaults to dist/public) */
  staticRoot?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Store deps on app for route access
  app.decorate('deps', deps);

  // Serve frontend static files
  const publicDir = deps.staticRoot || path.join(process.cwd(), 'dist', 'public');
  app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: serve index.html for non-API, non-file routes
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  registerRuleRoutes(app, deps);
  registerActivityRoutes(app, deps);
  registerStatusRoutes(app, deps);
  registerImapConfigRoutes(app, deps);

  return app;
}
