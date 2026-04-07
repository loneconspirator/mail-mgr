# Codebase Structure

**Analysis Date:** 2026-04-06

## Directory Layout

```
mail-mgr/
├── src/                    # Application source code
│   ├── index.ts            # Application entry point
│   ├── config/             # Configuration management
│   ├── imap/               # IMAP client abstraction
│   ├── rules/              # Rule evaluation logic
│   ├── actions/            # Action execution (move, delete, skip, review)
│   ├── monitor/            # Main message processing loop
│   ├── sweep/              # Review folder cleanup scheduler
│   ├── log/                # Activity log persistence
│   ├── shared/             # Shared types for API
│   └── web/                # Web server and routes
│       ├── index.ts        # Server exports
│       ├── server.ts       # Fastify app builder
│       ├── frontend/       # Single-page application
│       └── routes/         # HTTP route handlers
├── test/                   # Test suites
│   ├── unit/               # Unit tests (per-module)
│   └── integration/        # Integration tests (pipeline)
├── dist/                   # Compiled output (generated)
│   └── public/             # Frontend static files (generated)
├── data/                   # Runtime data directory
│   ├── config.yml          # Configuration file
│   └── db.sqlite3          # Activity log database
├── docs/                   # Project documentation
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Unit test configuration
└── vitest.integration.config.ts # Integration test configuration
```

## Directory Purposes

**src/ — Application Source:**
- Purpose: TypeScript source code for backend and frontend
- Contains: Configuration, IMAP handling, rule evaluation, action execution, logging, HTTP API, SPA
- Key files: `index.ts` (main entry), all subdirectory index.ts files (barrel exports)

**src/config/ — Configuration Management:**
- Purpose: Load YAML config, validate with Zod, manage hot-reload
- Contains:
  - `schema.ts`: Zod schemas for Config, Rule, ImapConfig, ReviewConfig, Actions, EmailMatch
  - `loader.ts`: YAML parsing, environment variable substitution, validation
  - `repository.ts`: In-memory config state, change listeners, rule/config mutation methods
  - `index.ts`: Barrel export
- Key pattern: Environment variable substitution via `${VAR_NAME}` syntax

**src/imap/ — IMAP Client:**
- Purpose: Abstract ImapFlow library, manage connection lifecycle, provide message fetch/move operations
- Contains:
  - `client.ts`: ImapClient class with connection state machine, auto-reconnect, IDLE/poll, folder operations
  - `messages.ts`: Type definitions (EmailMessage, ReviewMessage) and parsing logic
  - `index.ts`: Barrel export
- Key pattern: EventEmitter-based (`connected`, `newMail`, `error` events)

**src/rules/ — Rule Evaluation:**
- Purpose: Match messages against rules, determine which rule applies
- Contains:
  - `matcher.ts`: `matchRule()` — glob pattern matching (case-insensitive) on sender/recipient/subject
  - `evaluator.ts`: `evaluateRules()` — iterate sorted rules, return first match or null
  - `index.ts`: Barrel export
- Key pattern: Uses `picomatch` for glob; AND logic across match fields

**src/actions/ — Action Execution:**
- Purpose: Execute rule actions (move, delete, skip, review)
- Contains:
  - `index.ts`: `executeAction()` function, ActionResult and ActionContext types
- Key pattern: Try-once-retry-on-folder-create for move operations

**src/monitor/ — Message Arrival Monitor:**
- Purpose: Listen for new IMAP messages, fetch, evaluate rules, execute actions
- Contains:
  - `index.ts`: Monitor class with lifecycle (start/stop), event handlers, message processing loop
- Key pattern: Serialized processing (skip if already processing), state tracking (lastUid, counts)

**src/sweep/ — Review Folder Sweeper:**
- Purpose: Periodically scan review folder, re-evaluate rules, archive or delete old messages
- Contains:
  - `index.ts`: ReviewSweeper class, sweep scheduling, eligibility checking, destination resolution
- Key pattern: Age-based thresholds (separate for read/unread), state tracking for UI

**src/log/ — Activity Log:**
- Purpose: Persist all actions to SQLite, provide query API, maintain state
- Contains:
  - `index.ts`: ActivityLog class with SQLite schema, logging, auto-prune (30 days)
- Key pattern: WAL mode for concurrent access, migration pattern for schema evolution

**src/shared/ — Shared Types:**
- Purpose: Canonical types for API responses, reexported from config schemas
- Contains:
  - `types.ts`: ImapConfigResponse, ActivityEntry, ReviewStatusResponse, StatusResponse
- Key pattern: Frontend and backend share type definitions

**src/web/ — Web Server:**
- Purpose: HTTP API and static SPA serving
- Contains:
  - `server.ts`: Fastify app builder, static file serving, SPA fallback, route registration
  - `routes/`: Per-resource route handlers (rules, activity, status, config)
  - `frontend/`: Client-side SPA code and API client
  - `index.ts`: Barrel export
- Key pattern: Routes registered as functions that take app and dependencies

**src/web/routes/ — API Route Handlers:**
- Contains:
  - `rules.ts`: GET/POST/PUT/DELETE /api/rules, reorder endpoint
  - `activity.ts`: GET /api/activity with pagination
  - `status.ts`: GET /api/status (monitor state)
  - `review.ts`: GET /api/review/status (sweeper state)
  - `imap-config.ts`: GET /api/config/imap, POST /api/config/imap
  - `review-config.ts`: GET /api/config/review, POST /api/config/review
- Key pattern: All routes accept `ServerDeps` for dependency injection

**src/web/frontend/ — Single-Page Application:**
- Contains:
  - `app.ts`: Main application logic, DOM rendering, page navigation, event handlers
  - `api.ts`: Fetch-based HTTP client for all API endpoints
- Key pattern: Vanilla TypeScript (no framework), DOM creation with helper functions

**test/unit/ — Unit Tests:**
- Purpose: Test individual modules in isolation with mocks
- Structure: Mirrors src/ directory (test/unit/config/, test/unit/imap/, etc.)
- Key files:
  - `test/unit/smoke.test.ts`: Basic import checks
  - `test/unit/config/config.test.ts`: Config loading and validation
  - `test/unit/rules/matcher.test.ts`: Glob matching logic
  - `test/unit/rules/evaluator.test.ts`: Rule evaluation order and matching
  - `test/unit/actions/actions.test.ts`: Action execution (move/delete/skip)
  - `test/unit/monitor/monitor.test.ts`: Monitor event handling and state
  - `test/unit/sweep/sweep.test.ts`: Sweep eligibility and destination resolution
  - `test/unit/imap/client.test.ts`: Connection state machine
  - `test/unit/log/activity.test.ts`: Activity logging and queries
  - `test/unit/web/api.test.ts`: Route handlers
  - `test/unit/web/frontend.test.ts`: Frontend API client and UI

**test/integration/ — Integration Tests:**
- Purpose: Test full workflows (message arrives → rules evaluated → action executed)
- Key files:
  - `test/integration/pipeline.test.ts`: Monitor + rules + actions + log
  - `test/integration/sweep.test.ts`: Sweeper eligibility and execution
  - `test/integration/helpers.ts`: Shared test utilities (fake IMAP, config builders)

**dist/ — Compiled Output (generated):**
- Purpose: Compiled JavaScript and bundled frontend
- Contains:
  - `dist/index.js`: Main entry point (from src/index.ts via tsc)
  - `dist/**/*.js`: Compiled source tree
  - `dist/public/`: Bundled frontend (from src/web/frontend via esbuild)
- Generated by: `npm run build` (tsc + esbuild)

**data/ — Runtime Data (not committed):**
- Purpose: Configuration and database at runtime
- Contains:
  - `config.yml`: Email rules, IMAP credentials, folder paths (must be created)
  - `db.sqlite3`: Activity log (auto-created by ActivityLog)
- Location: Controlled by `DATA_PATH` env var (defaults to ./data)

**docs/ — Project Documentation:**
- Purpose: Guides and notes
- Contains: README.md, version docs, implementation plans

## Key File Locations

**Entry Points:**
- `src/index.ts`: Application bootstrap; initializes config, IMAP client, Monitor, ReviewSweeper, web server
- `src/web/server.ts`: Web server builder; registers routes and static serving
- `src/web/frontend/app.ts`: Frontend entry point; initializes page navigation and API polling

**Configuration:**
- `src/config/schema.ts`: Zod schemas for all configuration types
- `src/config/loader.ts`: YAML parsing and environment variable handling
- `src/config/repository.ts`: In-memory config state and hot-reload listeners
- `data/config.yml`: User configuration file (not in repo, must be created)

**Core Logic:**
- `src/imap/client.ts`: IMAP connection lifecycle and operations
- `src/rules/evaluator.ts`: Rule matching and evaluation
- `src/actions/index.ts`: Action execution (move, delete, skip, review)
- `src/monitor/index.ts`: Message arrival processing
- `src/sweep/index.ts`: Review folder periodic cleanup

**Testing:**
- `vitest.config.ts`: Unit test configuration (runs test/unit)
- `vitest.integration.config.ts`: Integration test configuration (runs test/integration)
- `test/unit/`: Unit tests mirroring src/ structure
- `test/integration/helpers.ts`: Shared test utilities

## Naming Conventions

**Files:**
- Source: PascalCase for classes/types, camelCase for functions (within a single `index.ts` per directory)
- Tests: `*.test.ts` (unit) or `*.ts` (integration); match source file name
- Config: `*.yml` (YAML config), `*.ts` (schema)
- Example: `src/rules/matcher.ts` → `test/unit/rules/matcher.test.ts`

**Directories:**
- Lowercase, kebab-case for logical grouping (e.g., `src/web/routes/`, `test/unit/`)
- One class per directory (e.g., Monitor, ImapClient, ReviewSweeper)
- Example: `src/monitor/` contains Monitor class and dependencies

**Functions & Classes:**
- Classes: PascalCase (`ImapClient`, `Monitor`, `ReviewSweeper`, `ConfigRepository`)
- Functions: camelCase (`executeAction`, `evaluateRules`, `matchRule`, `parseMessage`)
- Interfaces/Types: PascalCase (`EmailMessage`, `ReviewMessage`, `ActionResult`, `ServerDeps`)

**Variables & Constants:**
- Variables: camelCase (`connectionStatus`, `messageId`, `lastUid`)
- Constants: UPPER_SNAKE_CASE (`MIN_BACKOFF_MS`, `MAX_BACKOFF_MS`, `MS_PER_DAY`, `PRUNE_DAYS`)

## Where to Add New Code

**New Feature (e.g., new action type):**
- Update schema: `src/config/schema.ts` (add action variant)
- Update evaluator/executor: `src/actions/index.ts` (add case to executeAction)
- Add route: `src/web/routes/` (if API endpoint needed)
- Add tests: `test/unit/actions/actions.test.ts`, `test/integration/pipeline.test.ts`

**New Component/Module:**
- Create directory under `src/` (e.g., `src/notification/`)
- Create `index.ts` and implementation files (e.g., `src/notification/handler.ts`)
- Export public API from `index.ts`
- Add unit tests: `test/unit/notification/`
- Initialize in `src/index.ts` main() if it's a service

**Utilities/Helpers:**
- Shared utilities: `src/shared/` (already contains types; add util functions here)
- Module-internal helpers: Co-locate with module (e.g., helper functions in same file as main class)

**New API Endpoint:**
- Create `src/web/routes/feature.ts` with `registerFeatureRoutes()` function
- Import and call in `src/web/server.ts` buildServer()
- Add types to `src/shared/types.ts` for response shape
- Test: `test/unit/web/api.test.ts`

## Special Directories

**dist/ — Compiled Output:**
- Purpose: TypeScript compiled to JavaScript + bundled frontend
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)
- Rebuild: Run `npm run build` after code changes

**node_modules/ — Dependencies:**
- Purpose: Installed npm packages
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)

**data/ — Runtime Data:**
- Purpose: Configuration and database files at runtime
- Generated: Partially (db.sqlite3 auto-created; config.yml must be created)
- Committed: No (in .gitignore)
- Must exist: Yes (create manually with `mkdir -p data` and add `config.yml`)

**.planning/ — Plan Documents:**
- Purpose: GSD planning documents and codebase analysis
- Generated: Yes (by GSD tooling)
- Committed: Yes (for team reference)
- Contains: Architecture, structure, conventions, testing patterns, concerns

---

*Structure analysis: 2026-04-06*
