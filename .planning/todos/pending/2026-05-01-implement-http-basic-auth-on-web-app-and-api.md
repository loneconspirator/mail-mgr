---
created: 2026-05-01T17:29:44.069Z
title: Implement HTTP BASIC auth on web app and API
area: auth
files:
  - src/web/
---

## Problem

The mail-mgr web application and API are currently exposed without any authentication. Anyone with network access to the host can view dashboards, inspect mail state, trigger actions, and call API endpoints. Even on a home/LAN deployment (Soma), this is risky because the service exposes mail content, rule configuration, and action triggers — and may eventually be reachable beyond the LAN.

## Solution

Add HTTP BASIC auth in front of both the web UI and API routes.

Approach hints:
- Single shared credential pair (username + password) sourced from env vars (e.g. `WEB_AUTH_USER` / `WEB_AUTH_PASS`) — no user database needed for v1.
- Apply middleware globally at the web server entry in `src/web/` so both HTML routes and API routes are covered.
- Skip auth for healthcheck / liveness endpoint if one exists, so docker/portainer probes still work.
- Return `WWW-Authenticate: Basic realm="mail-mgr"` on 401 so browsers prompt.
- Document the env vars in README and `docker-compose.yaml` example.
- Constant-time compare on the password to avoid timing leaks.

Out of scope (defer): per-user accounts, sessions, OAuth, password rotation UI.
