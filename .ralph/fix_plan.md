# Tier 1 — Deterministic Engine

Ref: [PRD](../docs/PRD.md) | [WBS](../docs/WBS-1.md)

## Build Order

Tasks are listed in dependency order. A task cannot start until everything it depends on is done.

### Phase 1 — Foundation

- [x] **1.1 Initialize project scaffolding** — `npm init`, TypeScript (strict, ES2022, NodeNext), directory structure (`src/{config,imap,rules,actions,monitor,web,log}`, `test/{unit,integration}`, `config/default.yml`). Install core deps (fastify, imapflow, better-sqlite3, yaml, zod, pino) and dev deps (vitest, @types/better-sqlite3, tsx, esbuild). Add npm scripts (`dev`, `build`, `start`, `test`, `test:watch`), `.gitignore`, `.dockerignore`. Runtime state under `DATA_PATH` (`./data` locally, `/data` in Docker). See [WBS 1.1](../docs/WBS-1.md#11-initialize-project).

- [x] **1.2 Config schema and loading** — Zod schemas for full config (IMAP, server, rules). Rule match fields: `sender`, `recipient`, `subject` (glob patterns, at least one required). Action type as discriminated union (`move` only for Tier 1, extensible for Tier 3). Env var substitution (`${VAR_NAME}`) at load time only. `loadConfig()`, `saveConfig()` (atomic write, preserve `${VAR}` refs), `ensureConfig()` (seed from `config/default.yml`). Config re-read on UI changes; IMAP config diff triggers reconnect. Tests: valid load, missing fields throw, env var sub, round-trip save/load. See [WBS 1.2](../docs/WBS-1.md#12-config-schema-and-loading).
  - Depends on: 1.1

### Phase 2 — IMAP Client

- [x] **2.1 IMAP connection management** — `ImapClient` class wrapping `imapflow`. `connect()` (authenticate, select INBOX, emit `connected`), `disconnect()` (graceful logout). Auto-reconnect with exponential backoff (1s..60s cap, reset on success). Connection states: `connected`, `connecting`, `disconnected`, `error`. Event emitter for `connected`, `disconnected`, `error`, `newMail`. Accept ImapFlow factory for test injection. Tests: backoff timing, state transitions, event firing. See [WBS 2.1](../docs/WBS-1.md#21-connection-management).
  - Depends on: 1.1, 1.2

- [x] **2.2 IMAP IDLE and polling** — Enter IDLE on INBOX after connect. Use `mailbox.exists` for new mail detection. Re-issue IDLE every `idleTimeout` ms (default 5 min). Polling fallback at `pollInterval` ms when IDLE unsupported. Track last-seen UID to avoid reprocessing. Tests: new message triggers fetch, polling fallback, UID dedup. See [WBS 2.2](../docs/WBS-1.md#22-idle-and-polling).
  - Depends on: 2.1

- [x] **2.3 IMAP message fetching** — Fetch envelope data (UID, from, to, cc, subject, date, flags) via `imapflow` `fetchOne`/`fetch`. Return typed `EmailMessage` and `EmailAddress` objects. Tier 1 = envelope only (body is Tier 2). Tests: correct typed structure, edge cases (missing subject, multiple recipients, encoded headers). See [WBS 2.3](../docs/WBS-1.md#23-message-fetching).
  - Depends on: 2.1

### Phase 3 — Rule Engine

- [x] **3.1 Rule engine pattern matching** — `matchRule(rule, message): boolean`. Glob matching via `picomatch` on sender, recipient, subject. AND logic (all specified fields must match). Recipient checks both `to` and `cc`. Case-insensitive for addresses and subject. Tests: exact match, glob match (`*@github.com`), recipient across to/cc, subject glob, multi-field AND, no match, case insensitivity, ordering, disabled skip. See [WBS 3.1](../docs/WBS-1.md#31-pattern-matching).
  - Depends on: 1.2, 2.3

- [x] **3.2 Rule evaluation pipeline** — `evaluateRules(rules[], message): Rule | null`. Sort by `order`, filter `enabled: true`, return first match or null. Tests: first match wins, null on no match, disabled skipped. See [WBS 3.2](../docs/WBS-1.md#32-rule-evaluation-pipeline).
  - Depends on: 3.1

### Phase 4 — Actions & Logging

- [x] **4.1 Move-to-folder action** — `executeAction(client, message, action): Promise<ActionResult>`. Use `imapflow` `messageMove` by UID. Auto-create target folder with `mailboxCreate` if missing (retry once). `ActionResult`: success, messageUid, messageId, action, folder, rule (id), timestamp, error. Tests: successful move, folder auto-creation, failed move error. See [WBS 4.1](../docs/WBS-1.md#41-move-to-folder).
  - Depends on: 1.2, 2.1

- [x] **5.1 SQLite activity log** — `better-sqlite3`, single `activity` table (id, timestamp, message_uid, message_id, message_from, message_to, message_subject, rule_id, rule_name, action, folder, success, error). `logActivity()`, `getRecentActivity(limit, offset)`. DB at `DATA_PATH/db.sqlite3`. Prune >30 days on startup and daily. Tests: all fields logged, reverse chrono order, pagination, pruning. See [WBS 5.1](../docs/WBS-1.md#51-sqlite-activity-log).
  - Depends on: 1.1, 4.1

### Phase 5 — Orchestration

- [x] **6.1 Monitor orchestration pipeline** — `Monitor` class owning ImapClient, config, rule engine, activity log. Pipeline: fetch envelope -> evaluate rules -> execute action -> log result. No-match = leave in inbox, no activity row. Sequential IMAP ops. Startup: initial INBOX scan then IDLE/poll. Expose state (connection status, last poll, messages processed) for web UI. Tests: full pipeline, no-match, error handling continues. See [WBS 6.1](../docs/WBS-1.md#61-message-processing-pipeline).
  - Depends on: 2.1, 2.2, 2.3, 3.2, 4.1, 5.1

### Phase 6 — Web UI & API

- [x] **7.1 Fastify API server** — Routes: `GET/POST /api/rules`, `PUT/DELETE /api/rules/:id`, `PUT /api/rules/reorder`, `GET /api/activity`, `GET /api/status`, `GET/PUT /api/config/imap`. Zod validation. Rule CRUD persists to config file. IDs via `crypto.randomUUID()`. IMAP password masked (`****`) on read, preserved on `****` write. Serve static from `dist/public/`. Tests: status codes, CRUD persistence, reorder, password masking, 400 on invalid body. See [WBS 7.1](../docs/WBS-1.md#71-fastify-api-server).
  - Depends on: 1.2, 5.1, 6.1

- [x] **7.2 Frontend SPA** — Vanilla TS or preact (3KB). Three views: Rules (table, CRUD modal, drag reorder, enabled toggle), Activity (paginated table, 30s auto-refresh), Settings (IMAP form, connection status, test button). Build with esbuild. Serve via `@fastify/static`. `fetch` for API. Minimal CSS, system fonts, no framework. Tests: API wrappers and data transforms in vitest; manual E2E for Tier 1. See [WBS 7.2](../docs/WBS-1.md#72-frontend-spa).
  - Depends on: 7.1

### Phase 7 — Packaging & Integration

- [ ] **8.1 Dockerfile and docker-compose** — Multi-stage (node:22-alpine build + runtime). Non-root user. Port 3000. Volume `/data`. First-run config seeding. Compose: single service, named volume, `IMAP_PASSWORD` env, `restart: unless-stopped`. Tests: build succeeds, healthy start, config seeding, no overwrite on subsequent runs. See [WBS 8.1](../docs/WBS-1.md#81-dockerfile-and-compose).
  - Depends on: 7.2

- [ ] **9.1 IMAP integration tests** — Real IMAP server (greenmail Docker image). Scenarios: connect + IDLE + move, poll fallback, reconnect after drop, full pipeline (inject email -> rule match -> move -> activity logged). See [WBS 9.1](../docs/WBS-1.md#91-imap-integration-tests).
  - Depends on: 6.1, 8.1

## Completed
- [x] Project enabled for Ralph
- [x] 1.1 Project scaffolding (TypeScript, directory structure, deps, npm scripts)
- [x] 1.2 Config schema and loading (Zod schemas, loadConfig, saveConfig, ensureConfig, env var substitution, 18 tests passing)
- [x] 2.1 IMAP connection management (ImapClient class with connect/disconnect, exponential backoff 1s..60s, state machine, event emitter, factory injection for testing, 17 tests passing)
- [x] 2.3 IMAP message fetching (EmailMessage/EmailAddress types, parseMessage from imapflow envelope, edge case handling, 12 tests passing)
- [x] 3.1 Rule engine pattern matching (matchRule with picomatch glob matching, AND logic, recipient checks to+cc, case-insensitive, 18 tests passing)
- [x] 3.2 Rule evaluation pipeline (evaluateRules, sort by order, first match wins, disabled skip)
- [x] 4.1 Move-to-folder action (executeAction, messageMove by UID, folder auto-creation)
- [x] 5.1 SQLite activity log (activity table, logActivity, getRecentActivity, pruning — 1 flaky prune test)
- [x] 6.1 Monitor orchestration pipeline (Monitor class, fetch→evaluate→execute→log pipeline)
- [x] 7.1 Fastify API server (rule CRUD, activity, status, IMAP config, password masking)
- [x] 2.2 IMAP IDLE and polling (IDLE cycling via NOOP at idleTimeout, polling fallback when IDLE unsupported, UID dedup, 10 new tests)
- [x] 7.2 Frontend SPA (vanilla TS, 3 views: Rules/Activity/Settings, esbuild bundle, @fastify/static, SPA fallback, 6 frontend tests, 122 total passing)

## Notes
- Build bottom-up per [WBS implementation order](../docs/WBS-1.md#implementation-order)
- Items 2.1-5.1 can be built and tested independently with mocks, then wired together in 6.1
- Unit tests with vitest throughout; integration tests against real IMAP at the end
- Update this file after each major milestone
