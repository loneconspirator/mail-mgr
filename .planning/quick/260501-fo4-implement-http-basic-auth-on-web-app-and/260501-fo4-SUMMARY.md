---
quick_id: 260501-fo4
description: Implement HTTP BASIC auth on web app and API
date: 2026-05-01
status: completed
---

# Quick Task 260501-fo4 — HTTP BASIC auth on web app and API

## Outcome

HTTP BASIC auth now protects the entire mail-mgr web surface (UI + API), with `/healthz` exempted for container probes. Credentials come from `WEB_AUTH_USER` / `WEB_AUTH_PASS` env vars; the app refuses to start (fail-closed) if either is unset.

## Key Decisions

- **Framework:** Fastify 5.7 — middleware implemented as an `onRequest` hook registered in `buildServer`.
- **Healthcheck path:** `/healthz` (created — none existed). Wired into the Dockerfile via `HEALTHCHECK` for Portainer/Docker probes.
- **Missing env behavior:** **Fail-closed.** `buildServer` throws synchronously with a clear error rather than silently disabling auth. Security middleware should never silently no-op.
- **Constant-time compare:** `crypto.timingSafeEqual` against equal-length buffers, ANDed with a length-equality boolean — never leaks length and never throws on mismatch.
- **Test infrastructure:** Added `test/setup.ts` (vitest `setupFiles`) to inject `WEB_AUTH_USER` / `WEB_AUTH_PASS` for tests, plus a shared `test/_authHeader.ts` helper used by all existing web tests so they keep passing through the new auth gate.

## Files Created

- `src/web/auth.ts` — `basicAuthHook` factory + `HEALTH_PATH` constant, constant-time compare via `crypto.timingSafeEqual`
- `src/web/routes/health.ts` — `registerHealthRoute` exposing `GET /healthz`
- `test/unit/web/auth.test.ts` — Coverage: missing header → 401, invalid creds → 401, valid creds → 200, `/healthz` unauthenticated → 200, `WWW-Authenticate: Basic realm="mail-mgr"` header on 401, timing-safe compare on length mismatch
- `test/setup.ts` — vitest setup file injecting auth env vars
- `test/_authHeader.ts` — shared `AUTH_HEADERS` helper for test fixtures

## Files Modified

- `src/web/server.ts` — Wired `app.addHook('onRequest', basicAuthHook(...))` into `buildServer`, registered `/healthz` route, fail-closed env check
- `vitest.config.ts` — Added `test/setup.ts` to `setupFiles`
- `README.md` — Documented `WEB_AUTH_USER` / `WEB_AUTH_PASS` env vars
- `docker-compose.yaml` — Added env vars to environment block
- `Dockerfile` — Added `HEALTHCHECK` directive hitting `/healthz`
- All existing web/integration tests under `test/unit/web/` and `test/integration/` — Updated to send auth headers via the new `AUTH_HEADERS` helper

## Commits

- `3cc1950` — test(quick-260501-fo4-01): add failing tests for HTTP BASIC auth hook
- `65d2136` — feat(quick-260501-fo4-01): add basicAuthHook factory and /healthz route
- `996efe1` — feat(quick-260501-fo4-02): wire basicAuthHook + /healthz into buildServer
- `9cc1692` — docs(quick-260501-fo4-03): document WEB_AUTH env vars and add Dockerfile HEALTHCHECK

## Out of Scope (Deferred)

- Per-user accounts, sessions, OAuth
- Password rotation UI
- Rate limiting on auth failures
