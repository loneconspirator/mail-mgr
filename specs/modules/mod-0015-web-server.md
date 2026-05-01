---
id: MOD-0015
title: WebServer
interface-schema: src/web/server.ts
unit-test-path: test/unit/web/
integrations: [IX-005, IX-009, IX-010, IX-011, IX-012]
invariants-enforced: [INV-003]
architecture-section: architecture.md#web-interface
---

## Responsibility

Fastify HTTP server serving the SPA frontend and REST API. Provides endpoints for rule management, activity log viewing, system status, proposal review and approval, batch filing, folder listing, and configuration updates. Acts as the bridge between the user's browser and all backend subsystems.

Enforces HTTP BASIC authentication on every request via an `onRequest` hook against env-sourced credentials. Fails closed at startup if either credential env var is unset. The `/healthz` liveness route is the sole exemption so container/Portainer probes can reach it without credentials.

## Interface Summary

- `buildServer(deps)` — Create and configure a Fastify instance with all routes registered. Returns the Fastify instance (not started). Throws synchronously if `WEB_AUTH_USER` or `WEB_AUTH_PASS` is unset.
- `basicAuthHook(expectedUser, expectedPass)` — Factory that returns a Fastify `onRequest` hook performing constant-time credential comparison and skipping the `HEALTH_PATH` route. Exported from `src/web/auth.ts` alongside `readAuthCredsOrThrow()` and the `HEALTH_PATH` constant.
- `registerHealthRoute(app)` — Registers `GET /healthz` returning 200 without auth. Exported from `src/web/routes/health.ts`.

Key API routes relevant to UC-001:
- `GET /api/proposed-rules` — List proposals with example subjects and strength labels.
- `POST /api/proposed-rules/:id/approve` — Approve a proposal (with conflict checking).
- `POST /api/proposed-rules/:id/dismiss` — Dismiss a proposal.
- `GET /api/rules` — List all rules.
- `GET /api/activity` — Paginated activity log.
- `GET /api/status` — Connection state and system stats.

Liveness route (unauthenticated):
- `GET /healthz` — Returns 200 with no body validation; intended for container health probes.

## Dependencies

- Fastify (external) — HTTP framework.
- Node `crypto` (external) — `timingSafeEqual` for constant-time password compare.
- Environment — `WEB_AUTH_USER`, `WEB_AUTH_PASS` (required at startup).
- MOD-0014 — Rule CRUD and config access.
- MOD-0007 — Activity history queries.
- MOD-0012 — Proposal listing and approval.
- MOD-0013 — Conflict detection at approval time.
- MOD-0001 — Status reporting.
- MOD-0016 — Sweep status reporting.

## Notes

- The server is stateless — all state lives in ConfigRepository, ActivityLog, and the SQLite stores.
- Static frontend assets are served from a built directory; the SPA handles client-side routing.
- Route modules are organized by concern under `src/web/routes/`.
- **Auth fail-closed:** missing or empty `WEB_AUTH_USER` / `WEB_AUTH_PASS` causes `buildServer` to throw before any route is registered. There is no silent-skip mode; this is a deliberate guard against accidentally deploying an open instance.
- **Constant-time compare:** the auth hook compares user-provided credentials against expected values using `crypto.timingSafeEqual` on equal-length buffers, ANDed with a length-equality boolean so neither length nor early-byte mismatches leak via timing.
- **401 response shape:** unauthenticated requests receive `401` with `WWW-Authenticate: Basic realm="mail-mgr"` so browsers automatically prompt for credentials.
