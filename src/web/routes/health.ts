/**
 * GET /healthz — unauthenticated container health endpoint.
 *
 * Intentionally trivial: returns `{ ok: true }`. No DB, IMAP, or config probe;
 * we only want to know the HTTP server is up. Auth hook (basicAuthHook) skips
 * this path via HEALTH_PATH.
 */
import type { FastifyInstance } from 'fastify';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ ok: true }));
}
