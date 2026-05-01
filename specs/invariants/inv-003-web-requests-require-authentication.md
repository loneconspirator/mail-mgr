---
id: INV-003
title: All web requests require valid HTTP BASIC credentials, except /healthz
enforcement:
  - type: code-discipline
    ref: src/web/auth.ts#basicAuthHook
  - type: code-discipline
    ref: src/web/server.ts#buildServer
  - type: unit-test
    ref: test/unit/web/auth.test.ts
modules: [MOD-0015]
---

## Statement

Every HTTP request handled by the WebServer (MOD-0015) MUST be authenticated with HTTP BASIC credentials matching the values of the `WEB_AUTH_USER` and `WEB_AUTH_PASS` environment variables, with exactly one exception: requests to the `HEALTH_PATH` route (`/healthz`) MUST proceed without an `Authorization` header so that container and Portainer liveness probes succeed.

A request that fails this check MUST receive a `401 Unauthorized` response carrying `WWW-Authenticate: Basic realm="mail-mgr"` so browsers prompt for credentials. Credential comparison MUST be constant-time with respect to both string contents and length.

If `WEB_AUTH_USER` or `WEB_AUTH_PASS` is unset or empty when `buildServer` is invoked, the process MUST refuse to start (fail-closed). There is no silent-skip mode.

## Why this exists

mail-mgr exposes the user's mail content, rule configuration, and action triggers (move, delete, batch-file). An unauthenticated web surface — even on a home LAN like Soma (192.168.1.90) — risks accidental exposure to other devices on the network, port-forward misconfigurations, or future deployments beyond the LAN. Quick task 260501-fo4 added the auth gate after this concern was filed as a pending todo.

The fail-closed startup behavior exists because security middleware that "silently degrades" is the exact failure mode that produces accidentally-open production deployments. If the operator forgot to set the env vars, the only safe response is to refuse to come up rather than to come up without auth and log a warning that nobody reads.

The `/healthz` exemption exists because container orchestrators (Docker, Portainer) issue liveness probes without credentials. Without the carve-out, a healthy container would be marked unhealthy and restarted in a loop. The exemption is path-exact (`/healthz`), not a prefix, so adversarial paths like `/healthz/../api/rules` cannot ride through unauthenticated.

## Enforcement

- **Primary (request gate) — code discipline.** `basicAuthHook` registered as Fastify `onRequest` hook in `buildServer` (`src/web/server.ts`). The hook short-circuits to `done()` when `request.url === HEALTH_PATH`; otherwise it parses the `Authorization` header, decodes the base64 user:pass, and runs `crypto.timingSafeEqual` against the expected values. The compare uses equal-length buffers ANDed with a length-equality boolean, so neither contents nor length leak via timing.

- **Secondary (startup) — code discipline.** `buildServer` reads `process.env.WEB_AUTH_USER` and `process.env.WEB_AUTH_PASS` and throws synchronously with a clear error message if either is missing or empty, before any route is registered. The host process exits non-zero, surfacing the misconfiguration to the orchestrator instead of coming up in an unauthenticated state.

- **Response shape — code discipline.** On auth failure the hook calls `reply.code(401).header('WWW-Authenticate', 'Basic realm="mail-mgr"').send(...)` so browsers automatically prompt and the response body cannot leak before the auth result is decided.

- **Unit test.** `test/unit/web/auth.test.ts` exercises: missing `Authorization` header → 401, malformed header → 401, wrong user → 401, wrong pass → 401, valid creds → 200, `/healthz` with no auth → 200, `WWW-Authenticate` header present on every 401 response, length-mismatched passwords compared without throwing.

## Known violation modes

- **Adding a new "public" route by registering it before the `onRequest` hook.** Fastify hooks added with `addHook('onRequest', ...)` apply to all routes registered on that instance regardless of declaration order, but a future refactor that splits `buildServer` into multiple Fastify instances or applies the hook only to a route group would silently re-open the door. Any new route added MUST be reachable via the same instance that has the hook attached, or the hook MUST be added to that instance.

- **Expanding the unauthenticated allowlist.** If a future change adds another exempt path (e.g. `/metrics`), the path-equality check in `basicAuthHook` must remain exact (no prefix or regex matching) and the new exemption must be re-justified in this invariant. A prefix match would allow path-traversal-style bypass.

- **Removing the fail-closed startup throw.** Reverting to a "log warning and start without auth" mode reproduces the original todo's risk. Any change that lets `buildServer` succeed when env vars are unset must be rejected.
