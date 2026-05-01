/**
 * MOD-0015 WebServer — Fastify HTTP server serving the SPA frontend and REST API.
 *
 * See specs/modules/mod-0015-web-server.md for the module spec, IX-005 for the
 * proposal approval interaction this server participates in, and architecture.md
 * (#web-interface) for the architectural role.
 *
 * Enforces INV-003 (web auth required) by calling readAuthCredsOrThrow at
 * startup (fail-closed) and registering basicAuthHook before any non-/healthz
 * route handler.
 */
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ConfigRepository } from '../config/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Monitor } from '../monitor/index.js';
import type { ReviewSweeper } from '../sweep/index.js';
import type { FolderCache } from '../folders/index.js';
import type { BatchEngine } from '../batch/index.js';
import type { MoveTracker } from '../tracking/index.js';
import type { ProposalStore } from '../tracking/proposals.js';
import { registerRuleRoutes } from './routes/rules.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerImapConfigRoutes } from './routes/imap-config.js';
import { registerEnvelopeRoutes } from './routes/envelope.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerReviewConfigRoutes } from './routes/review-config.js';
import { registerFolderRoutes } from './routes/folders.js';
import { registerBatchRoutes } from './routes/batch.js';
import { registerProposedRuleRoutes } from './routes/proposed-rules.js';
import { registerDispositionRoutes } from './routes/dispositions.js';
import { registerActionFolderConfigRoutes } from './routes/action-folder-config.js';
import { basicAuthHook, readAuthCredsOrThrow } from './auth.js';
import { registerHealthRoute } from './routes/health.js';

export interface ServerDeps {
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  /** Returns the current Monitor instance (supports hot-reload of IMAP config). */
  getMonitor: () => Monitor;
  getSweeper: () => ReviewSweeper | undefined;
  getFolderCache: () => FolderCache;
  getBatchEngine: () => BatchEngine;
  getMoveTracker: () => MoveTracker | undefined;
  getProposalStore: () => ProposalStore;
  /** Override static files root for testing (defaults to dist/public) */
  staticRoot?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  // Fail-closed: refuse to build the server if the operator has not set the
  // BASIC auth credentials. This must throw synchronously so misconfigured
  // deploys fail at startup rather than silently running unauthenticated.
  const { user: authUser, pass: authPass } = readAuthCredsOrThrow();

  const app = Fastify({ logger: false });

  // Store deps on app for route access
  app.decorate('deps', deps);

  // Register the unauthenticated /healthz route BEFORE the auth hook (defense
  // in depth — the hook also short-circuits on HEALTH_PATH).
  registerHealthRoute(app);

  // Enforce HTTP BASIC auth on every other request. Hook order: this runs
  // before any route handler thanks to onRequest.
  app.addHook('onRequest', basicAuthHook(authUser, authPass));

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
  registerEnvelopeRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerReviewConfigRoutes(app, deps);
  registerFolderRoutes(app, deps);
  registerBatchRoutes(app, deps);
  registerProposedRuleRoutes(app, deps);
  registerDispositionRoutes(app, deps);
  registerActionFolderConfigRoutes(app, deps);

  return app;
}
