# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Layered service architecture with event-driven background workers

**Key Characteristics:**
- Clean separation between IMAP connectivity, rule evaluation, action execution, and HTTP API
- Event-driven processing: `Monitor` listens for new mail and processes asynchronously
- Hot-reload configuration with graceful worker restart
- Dual sweep mechanisms: immediate rule-based actions on arrival, scheduled review folder cleanup
- Database-backed activity log for audit trail

## Layers

**Configuration Layer:**
- Purpose: Load, validate, and manage application config with hot-reload support
- Location: `src/config/`
- Contains: YAML loader, schema validation (Zod), in-memory repository, environment variable substitution
- Depends on: File system, `zod` validation
- Used by: All other layers via dependency injection

**IMAP Client Layer:**
- Purpose: Abstract IMAP protocol operations, connection lifecycle, and message fetch/move
- Location: `src/imap/`
- Contains: Connection state machine, auto-reconnect with exponential backoff, IDLE/poll support, message parsing
- Depends on: `imapflow` library, email header parsing
- Used by: `Monitor`, `ReviewSweeper`, route handlers

**Rules & Actions Layer:**
- Purpose: Evaluate rules against messages and execute corresponding actions (move, delete, skip, review)
- Location: `src/rules/`, `src/actions/`
- Contains: Glob pattern matching (case-insensitive), rule evaluation, move/delete/review action execution
- Depends on: IMAP client, message types, `picomatch` for glob patterns
- Used by: `Monitor`, `ReviewSweeper`

**Monitoring & Processing:**
- Purpose: Listen for new IMAP messages, fetch them, evaluate rules, execute actions at arrival time
- Location: `src/monitor/index.ts`
- Contains: Event listener, serialized processing, UID tracking, state exposure for API
- Depends on: IMAP client, rules evaluator, action executor, activity log
- Used by: Main entry point, status API

**Review Sweeper:**
- Purpose: Periodically scan review folder, re-evaluate rules after retention threshold, archive or delete messages
- Location: `src/sweep/index.ts`
- Contains: Scheduled sweep loop, age-based eligibility check, sweep destination resolution
- Depends on: IMAP client, rules evaluator, activity log, configuration
- Used by: Main entry point, review status API

**Web API Layer:**
- Purpose: HTTP routes for configuration management, activity log, and status monitoring
- Location: `src/web/routes/`
- Contains: 6 route registrars (rules, activity, status, IMAP config, review config, review status)
- Depends on: Fastify, repository/log, Monitor and ReviewSweeper instances
- Used by: Frontend SPA, external monitoring

**Frontend Layer:**
- Purpose: Single-page application for rule management, activity viewing, system status
- Location: `src/web/frontend/`
- Contains: TypeScript SPA with DOM rendering, API client, state management
- Depends on: Web API routes
- Used by: Web browsers

**Activity Log Layer:**
- Purpose: Persist all rule actions to SQLite for audit and API retrieval
- Location: `src/log/index.ts`
- Contains: SQLite schema, activity logging, state persistence, auto-pruning (30-day retention)
- Depends on: `better-sqlite3`, file system
- Used by: `Monitor`, `ReviewSweeper`, activity API

## Data Flow

**Arrival-Time Processing (Monitor):**

1. IMAP client connects and emits `connected` event
2. Monitor runs initial scan and attaches `newMail` listener
3. When new messages arrive:
   - Fetch messages since last UID (serialized — skip if already processing)
   - Parse envelope, extract `from`, `to`, `cc`, `subject`
   - Evaluate rules in order (first match wins)
   - Execute matched action (move to folder, review folder, delete, or skip)
   - Log activity with message details, rule ID, action taken
   - Update `lastUid` state in database

**Review Folder Processing (ReviewSweeper):**

1. Sweeper starts with 30-second initial delay
2. On schedule (configurable interval):
   - Open review folder
   - Fetch all messages with flags and internal dates
   - For each message, check eligibility (age in days vs. read/unread thresholds)
   - Eligible messages: re-evaluate against sweep-eligible rules, resolve destination
   - Move to archive folder (default) or delete (if matched delete rule)
   - Log sweep actions with source='sweep'
   - Update sweep state (counts, last sweep time)

**Configuration Hot-Reload:**

1. ConfigRepository watches for file changes
2. When rules change: notify Monitor and ReviewSweeper to update rules list
3. When IMAP config changes: restart Monitor (disconnect/reconnect), rebuild ReviewSweeper
4. When review config changes: resolve trash folder anew, restart ReviewSweeper

**State Management:**

- **Monitor state:** `connectionStatus`, `lastProcessedAt`, `messagesProcessed`
- **ReviewSweeper state:** folder path, message counts (total/unread/read), next sweep time, last sweep summary
- **Persistent state:** Last processed UID, sweep summaries stored in SQLite state table

## Key Abstractions

**EmailMessage:**
- Purpose: Canonical message format for rule matching and action context
- Examples: `src/imap/messages.ts`
- Pattern: Parsed IMAP envelope into normalized `{ uid, messageId, from, to, cc, subject, date, flags }`

**Rule & Action:**
- Purpose: Declarative email handling
- Examples: `src/config/schema.ts`
- Pattern: Rules have `match` conditions (sender/recipient/subject globs) and `action` (move/review/skip/delete)

**ReviewMessage:**
- Purpose: Message format for review folder scanning (includes internal date, needed for age calculation)
- Examples: `src/imap/messages.ts`
- Pattern: Lighter than EmailMessage, used only in sweep context

**ActionContext:**
- Purpose: Provide client, folder paths to action executor
- Examples: `src/actions/index.ts`
- Pattern: Contains IMAP client, review folder path, trash folder path for move/delete operations

**ServerDeps:**
- Purpose: Inject dependencies into Fastify routes
- Examples: `src/web/server.ts`
- Pattern: Passed to route registrars; routes call `deps.getMonitor()`, `deps.getSweeper()` for current instances

## Entry Points

**Application Entry (main):**
- Location: `src/index.ts`
- Triggers: Node.js process start
- Responsibilities:
  1. Load config from `DATA_PATH/config.yml`
  2. Initialize activity log from `DATA_PATH/db.sqlite3`
  3. Create ImapClient, Monitor, ReviewSweeper instances
  4. Set up hot-reload listeners on ConfigRepository
  5. Build Fastify app and attach dependencies
  6. Start monitor (connect to IMAP, listen for new mail)
  7. Start sweeper (schedule review folder sweeps)
  8. Listen on HTTP port

**Web Server Entry:**
- Location: `src/web/server.ts` → `buildServer()`
- Triggers: Called from main()
- Responsibilities: Instantiate Fastify, register static file serving, register all route handlers, return app instance

**Route Entry Points (per-route):**
- Location: `src/web/routes/*.ts`
- Triggers: Fastify request matching `/api/*`
- Responsibilities: Extract query/body, call repository or service, format response

## Error Handling

**Strategy:** Try-once-retry-once on IMAP move failures; all other errors logged and returned to caller

**Patterns:**

- **Message Move Failures:** `executeAction()` in `src/actions/index.ts` catches initial failure, attempts folder creation, retries move, returns success/error result
- **IMAP Connection Errors:** ImapClient catches connection errors, schedules exponential backoff reconnect (1s→60s), emits `error` event to Monitor
- **Config Validation:** Schema validation via Zod; on failure, throws with detailed issue list
- **Route Handler Errors:** Caught, returned as 400 with error details (for validation) or 500 (for unexpected)
- **Activity Log Errors:** Non-blocking — failures to log don't abort message processing
- **Sweep Errors:** Caught and counted; individual message failures don't stop sweep loop

## Cross-Cutting Concerns

**Logging:** Pino logger instances per module; minimal verbosity in production (routes disable Fastify logger)

**Validation:** Zod schemas define Config, Rule, ImapConfig, ReviewConfig at `src/config/schema.ts`; all modifications validated before persistence

**Authentication:** Configured in YAML/env vars; passed to ImapFlow as-is; no runtime auth changes

---

*Architecture analysis: 2026-04-06*
