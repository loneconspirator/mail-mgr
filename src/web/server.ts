import Fastify from 'fastify';
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
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Store deps on app for route access
  app.decorate('deps', deps);

  registerRuleRoutes(app, deps);
  registerActivityRoutes(app, deps);
  registerStatusRoutes(app, deps);
  registerImapConfigRoutes(app, deps);

  return app;
}
