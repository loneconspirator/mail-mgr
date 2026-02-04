# Tier 1 Work Breakdown Structure — Deterministic Engine

Reference: [PRD.md](./PRD.md) | Stack: Node.js 22+, TypeScript, Fastify, imapflow, SQLite, YAML config, Docker

## Work Management

Use **Claude tasks** to track work. Before starting any work item, create a Claude task for it. Mark tasks complete when done. If you discover work that isn't part of the current task (bugs, improvements, future-tier concerns), create a separate Claude task for it and finish what you're doing.

---

## 1. Project Scaffolding

### 1.1 Initialize project

- `npm init`, install TypeScript, configure `tsconfig.json` (strict mode, ES2022 target, NodeNext module resolution)
- Directory structure:

```
src/
  config/       # config loading, schema, validation
  imap/         # IMAP connection, IDLE, message fetching
  rules/        # rule matching engine
  actions/      # move-to-folder action execution
  monitor/      # orchestration: poll/IDLE loop, rule evaluation pipeline
  web/          # Fastify server, API routes
  log/          # activity log (SQLite)
  index.ts      # entry point
test/
  unit/         # mirrors src/ structure
  integration/  # IMAP integration tests (against test server)
config/
  default.yml   # bundled default config (copied to data volume on first run)
```

At runtime, all persistent state lives under a single `DATA_PATH` directory (default `/data` in Docker, `./data` locally):

```
$DATA_PATH/
  config.yml    # user config (seeded from config/default.yml on first run)
  db.sqlite3    # activity log
```

- Install core dependencies: `fastify`, `imapflow`, `better-sqlite3`, `yaml`, `zod` (config/rule validation), `pino` (logging — Fastify uses it natively)
- Install dev dependencies: `vitest`, `@types/better-sqlite3`, `tsx` (dev runner), `esbuild` (build)
- Add npm scripts: `dev`, `build`, `start`, `test`, `test:watch`
- Add `.gitignore`, `.dockerignore`

### 1.2 Config schema and loading

The config file is the single source of truth for rules and connection settings. The web UI reads and writes this file.

**Config file format** (`config.yml`, lives at `DATA_PATH/config.yml`, default `DATA_PATH`: `/data`):

```yaml
imap:
  host: imap.example.com
  port: 993
  tls: true
  auth:
    user: mike@example.com
    pass: ${IMAP_PASSWORD}    # env var substitution
  idleTimeout: 300000         # ms before re-issuing IDLE (default 5 min)
  pollInterval: 60000         # ms fallback poll interval (default 1 min)

server:
  port: 3000
  host: 0.0.0.0

rules:
  - id: "github-oss"
    name: "GitHub OSS notifications"
    match:
      sender: "*@github.com"
      recipient: "mike+oss@example.com"
    action:
      type: move
      folder: "Dev/OSS"
    enabled: true
    order: 1

  - id: "newsletters"
    name: "Newsletter catch-all"
    match:
      sender: "*@substack.com"
    action:
      type: move
      folder: "Reading/Newsletters"
    enabled: true
    order: 2
```

**Implementation:**

- Define Zod schemas for the full config (IMAP settings, server settings, rules array)
- Rule match fields: `sender` (glob pattern), `recipient` (glob pattern), `subject` (glob pattern). All optional, but at least one required.
- Action types for Tier 1: `move` only (with required `folder` field). Design the action type as a discriminated union so Tier 3 can add `delete` and `skip` without refactoring.
- Environment variable substitution in string values: replace `${VAR_NAME}` with `process.env.VAR_NAME`. Only do this at load time, never write expanded values back.
- Resolve config path from `DATA_PATH` env var: `path.join(process.env.DATA_PATH || './data', 'config.yml')`.
- `loadConfig(path)` — read YAML, substitute env vars, validate with Zod, return typed config. Throws on validation failure.
- `saveConfig(path, config)` — validate with Zod, serialize to YAML, write atomically (write to temp file, rename). Only the `rules` and non-secret fields are written back; the `imap.auth.pass` field should preserve the original `${VAR}` reference if one was used.
- `ensureConfig(path)` — if the config file doesn't exist at the resolved path, copy the bundled default config (`config/default.yml`) into place. Called on startup before `loadConfig`.
- Config is re-read on each change from the UI. The running monitor should pick up rule changes without restart (rules are evaluated per-message, so just reloading the rules array is sufficient). IMAP connection config changes require a reconnect — handle this by comparing the loaded IMAP config to the current one and triggering reconnect if different.

**Tests:**

- Valid config loads and types correctly
- Missing required fields throw with clear error messages
- Env var substitution works, missing env vars throw
- Glob patterns in match fields are preserved as strings (matching is handled by the rule engine, not config loading)
- `saveConfig` round-trips correctly (load → save → load produces equivalent config)

---

## 2. IMAP Client

### 2.1 Connection management

Wrap `imapflow` in a connection manager that handles the lifecycle.

**Implementation:**

- `ImapClient` class that owns the `ImapFlow` instance
- `connect()` — establish connection, authenticate, select INBOX. Emit `connected` event.
- `disconnect()` — graceful logout. Emit `disconnected` event.
- Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, cap at 60s). Log each attempt. Reset backoff on successful connection.
- Expose connection state: `connected`, `connecting`, `disconnected`, `error`
- Event emitter pattern for: `connected`, `disconnected`, `error`, `newMail`
- The class should be unit-testable by accepting the `ImapFlow` constructor or a factory, so tests can inject a stub.

**Tests:**

- Reconnect logic: simulate disconnect, verify backoff timing and eventual reconnect
- State transitions are correct
- Events fire at the right times

### 2.2 IDLE and polling

**Implementation:**

- After connecting and initial fetch, enter IMAP IDLE on INBOX.
- `imapflow` supports IDLE natively — use its `mailbox.exists` event to detect new messages.
- IDLE timeout handling: re-issue IDLE command every `idleTimeout` ms (some servers drop IDLE connections after ~30 min, default to 5 min to be safe).
- Polling fallback: if IDLE fails or the server doesn't support it, fall back to polling at `pollInterval` ms. Detect IDLE support from server capabilities.
- On new mail notification (IDLE or poll): fetch new message envelope data, hand off to the rule evaluation pipeline.
- Track last-seen UID to avoid reprocessing messages.

**Tests:**

- New message detection triggers fetch
- Polling fallback activates when IDLE is unavailable
- UID tracking prevents duplicate processing

### 2.3 Message fetching

**Implementation:**

- Fetch envelope data for new messages: UID, sender (from), recipients (to, cc), subject, date, flags
- Use `imapflow`'s `fetchOne` or `fetch` with the envelope and uid options
- Return a typed `EmailMessage` object:

```typescript
interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
}

interface EmailAddress {
  name: string;
  address: string;
}
```

- For Tier 1, we only need envelope data. Body fetching is a Tier 2 concern.

**Tests:**

- Envelope data is parsed into the correct typed structure
- Edge cases: missing subject, multiple recipients, encoded headers

---

## 3. Rule Engine

### 3.1 Pattern matching

**Implementation:**

- `matchRule(rule: Rule, message: EmailMessage): boolean`
- Glob matching on `sender`, `recipient`, `subject` fields using a lightweight glob library (`picomatch` — zero-dep, fast, well-tested). Match against the address string for sender/recipient.
- A rule matches if ALL specified fields match (AND logic). Fields not specified in the rule are ignored (wildcard).
- Recipient matching checks both `to` and `cc` fields — if any recipient address matches, the rule matches.
- Case-insensitive matching for email addresses. Case-insensitive for subject by default.
- Return on first matching rule (rules are evaluated in `order` field sequence).

**Tests:**

- Exact sender match
- Glob sender match (`*@github.com`)
- Recipient match across to and cc
- Subject glob match
- Multi-field AND logic (sender + recipient)
- No match returns false
- Case insensitivity
- Rule ordering is respected (first match wins)
- Disabled rules are skipped

### 3.2 Rule evaluation pipeline

**Implementation:**

- `evaluateRules(rules: Rule[], message: EmailMessage): Rule | null`
- Sort rules by `order`, filter to `enabled: true`, return first match or null.
- This is the integration point — takes the loaded rules and a fetched message, returns what to do.

**Tests:**

- First matching rule wins
- Null returned when nothing matches
- Disabled rules are skipped

---

## 4. Actions

### 4.1 Move to folder

**Implementation:**

- `executeAction(client: ImapClient, message: EmailMessage, action: Action): Promise<ActionResult>`
- For `move` action: use `imapflow`'s `messageMove` to move the message by UID to the target folder. If the target folder doesn't exist, create it with `mailboxCreate`.
- Return an `ActionResult` with: success/failure, action taken, source folder, target folder, timestamp, error message if failed.

```typescript
interface ActionResult {
  success: boolean;
  messageUid: number;
  messageId: string;
  action: string;
  folder?: string;
  rule: string;        # rule id that matched
  timestamp: Date;
  error?: string;
}
```

- Auto-create folders: if `messageMove` fails because the target doesn't exist, create it and retry once.

**Tests:**

- Successful move returns correct ActionResult
- Folder auto-creation on first move to a new folder
- Failed move returns error in ActionResult

---

## 5. Activity Log

### 5.1 SQLite activity log

**Implementation:**

- Use `better-sqlite3` (synchronous, fast, no native addon build issues on Alpine).
- Single table:

```sql
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  message_uid INTEGER NOT NULL,
  message_id TEXT,
  message_from TEXT,
  message_to TEXT,
  message_subject TEXT,
  rule_id TEXT,
  rule_name TEXT,
  action TEXT NOT NULL,
  folder TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
);
```

- `logActivity(result: ActionResult, message: EmailMessage, rule: Rule): void`
- `getRecentActivity(limit: number, offset: number): ActivityEntry[]`
- Store the database file at `DATA_PATH/db.sqlite3` (default `DATA_PATH`: `/data`), created on first run.
- Prune entries older than 30 days on startup and daily thereafter (keep the DB from growing without bound).

**Tests:**

- Activity is logged with all fields
- Retrieval returns entries in reverse chronological order
- Pagination works (limit/offset)
- Pruning removes old entries and keeps recent ones

---

## 6. Monitor (Orchestration)

### 6.1 Message processing pipeline

This is the main loop that ties everything together.

**Implementation:**

- `Monitor` class that owns: `ImapClient`, loaded config, rule engine, activity log
- On new message(s):
  1. Fetch envelope data for each new message
  2. Evaluate rules against the message
  3. If a rule matches, execute the action
  4. Log the result (match or no-match)
  5. If no match, leave in inbox (log that no rule matched, but don't log to the activity table — only log actions taken)
- Process messages sequentially (no concurrent moves on the same mailbox — IMAP operations should be serialized).
- On startup: do an initial scan of all INBOX messages (fetch UIDs and envelopes for unseen/unfiled messages), then enter IDLE/poll mode.
- Expose state for the web UI: connection status, last poll time, messages processed count.

**Tests:**

- Full pipeline: message arrives → rule matches → action executes → activity logged
- No-match: message arrives → no rule matches → message stays, no activity logged
- Error handling: action fails → error logged, processing continues with next message

---

## 7. Web UI and API

### 7.1 Fastify API server

**API routes:**

```
GET    /api/rules              # list all rules (ordered)
POST   /api/rules              # create rule
PUT    /api/rules/:id          # update rule
DELETE /api/rules/:id          # delete rule
PUT    /api/rules/reorder      # bulk reorder (accepts array of {id, order})

GET    /api/activity           # recent activity (query: limit, offset)

GET    /api/status             # connection state, uptime, messages processed

GET    /api/config/imap        # get IMAP config (password masked)
PUT    /api/config/imap        # update IMAP config (triggers reconnect)
```

**Implementation:**

- Fastify with TypeScript, JSON schema validation on request bodies (use Zod schemas from config module, convert to JSON Schema for Fastify with `zod-to-json-schema` or just use Fastify's `setValidatorCompiler` with Zod).
- Rule CRUD: read from config, modify in memory, write back to config file.
- Rule IDs: generated with `crypto.randomUUID()` on creation.
- Reorder: accept an array of `{id, order}` pairs, update all order fields, save config.
- IMAP config: return config with password masked (`****`). On update, if password field is `****`, preserve the existing password. Otherwise update it.
- Serve static files for the frontend SPA from `dist/public/`.

**Tests:**

- Each endpoint returns correct status codes and response shapes
- Rule CRUD operations persist to config file
- Reorder updates all order fields correctly
- IMAP password masking works correctly (never leaks password via API)
- Invalid request bodies return 400 with Zod error details

### 7.2 Frontend SPA

A simple single-page app. Keep it lean — no heavy framework overhead.

**Stack:** Vanilla TypeScript + a minimal UI approach. Use `preact` (3KB) if you want components, or just plain HTML + fetch calls + a lightweight template approach. The UI is simple enough that React is overkill.

**Pages/Views:**

1. **Rules** — Table of rules (name, match summary, action, enabled toggle, drag-to-reorder). CRUD modal/form for creating/editing rules. Fields: name, sender pattern, recipient pattern, subject pattern, action type (move), target folder, enabled checkbox.
2. **Activity** — Table of recent activity (timestamp, from, subject, rule matched, action taken, folder). Paginated. Auto-refresh every 30s or on focus.
3. **Settings** — IMAP connection form (host, port, TLS toggle, username, password). Connection status indicator. Test connection button.

**Implementation:**

- Build with `esbuild` (bundle the frontend TS into a single JS file + CSS).
- Serve from Fastify's static file plugin (`@fastify/static`).
- Use `fetch` for API calls. No state management library. Keep state in simple module-level variables and re-render affected DOM nodes.
- Minimal CSS — a system font stack, a simple table layout, basic form styling. No CSS framework. Make it functional, not pretty. It's an admin panel, not a consumer product.

**Tests:**

- Frontend logic (API call wrappers, data transformation) tested with vitest
- API integration tested via Fastify's `inject()` method (no real HTTP needed)
- E2E testing is a Tier 2+ concern. Manual testing is fine for the SPA in Tier 1.

---

## 8. Docker

### 8.1 Dockerfile and compose

**Dockerfile:**

- Multi-stage build: build stage (node:22-alpine, install deps, compile TS, bundle frontend), runtime stage (node:22-alpine, copy built output and production deps only).
- Run as non-root user.
- Expose port 3000.
- Default command: `node dist/index.js`
- Single volume: `/data` (contains `config.yml` and `db.sqlite3`)
- On first run, if `/data/config.yml` doesn't exist, copy the bundled default config into the volume.

**docker-compose.yaml:**

```yaml
services:
  mail-mgr:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - mail-mgr-data:/data
    environment:
      - IMAP_PASSWORD=${IMAP_PASSWORD}
      - DATA_PATH=/data
    restart: unless-stopped

volumes:
  mail-mgr-data:
```

**Tests:**

- Docker build succeeds
- Container starts and reaches healthy state
- First-run config seeding works (config.yml created in volume if missing)
- Subsequent runs use the existing config.yml without overwriting

---

## 9. Integration Testing

### 9.1 IMAP integration tests

Use a real IMAP server for integration tests. Options:

- `greenmail` (Java-based, Docker image available) — full IMAP server for testing
- `docker-mailserver` — heavier but more realistic
- For CI: spin up a greenmail container, run integration tests against it

**Test scenarios:**

- Connect to test IMAP server, detect new message via IDLE, move to folder
- Poll fallback works when IDLE is disabled
- Reconnect after connection drop
- Full pipeline: inject test email → rule matches → email moved → activity logged

### 9.2 Test approach

- Unit tests: `vitest`, mock IMAP interactions, test rule matching, config loading, activity logging in isolation
- Integration tests: real IMAP server in Docker, test the full pipeline
- API tests: Fastify's `inject()` for all HTTP endpoints — no real server needed
- Aim for high coverage on the rule engine and config handling. These are the core logic paths. Lower coverage is acceptable on IMAP plumbing (integration tests cover it) and UI rendering.

---

## Implementation Order

Build bottom-up. Each item depends on the one before it.

1. **Project scaffolding** (1.1) — get the project compiling and tests running
2. **Config schema and loading** (1.2) — the config is the foundation everything reads from
3. **IMAP client** (2.1, 2.2, 2.3) — connect, IDLE, fetch messages
4. **Rule engine** (3.1, 3.2) — match rules against messages
5. **Actions** (4.1) — execute matched rule actions
6. **Activity log** (5.1) — record what happened
7. **Monitor** (6.1) — wire it all together into the processing pipeline
8. **API server** (7.1) — expose management endpoints
9. **Frontend** (7.2) — build the admin UI
10. **Docker** (8.1) — package it up
11. **Integration tests** (9.1) — end-to-end validation

Items 3-6 can be built and tested independently with mocks, then wired together in step 7.
