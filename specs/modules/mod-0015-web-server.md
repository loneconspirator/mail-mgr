---
id: MOD-0015
title: WebServer
interface-schema: src/web/server.ts
unit-test-path: test/unit/web/
integrations: [IX-005, IX-009, IX-010, IX-011, IX-012]
invariants-enforced: []
architecture-section: architecture.md#web-interface
---

## Responsibility

Fastify HTTP server serving the SPA frontend and REST API. Provides endpoints for rule management, activity log viewing, system status, proposal review and approval, batch filing, folder listing, and configuration updates. Acts as the bridge between the user's browser and all backend subsystems.

## Interface Summary

- `buildServer(deps)` — Create and configure a Fastify instance with all routes registered. Returns the Fastify instance (not started).

Key API routes relevant to UC-001:
- `GET /api/proposed-rules` — List proposals with example subjects and strength labels.
- `POST /api/proposed-rules/:id/approve` — Approve a proposal (with conflict checking).
- `POST /api/proposed-rules/:id/dismiss` — Dismiss a proposal.
- `GET /api/rules` — List all rules.
- `GET /api/activity` — Paginated activity log.
- `GET /api/status` — Connection state and system stats.

## Dependencies

- Fastify (external) — HTTP framework.
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
