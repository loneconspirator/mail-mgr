

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Mail Manager**

An automated email organization system that monitors IMAP mailboxes, routes messages using pattern-matching rules, and manages a two-stream intake model (Inbox for action items, Review for batch processing). Designed for individual use — one instance per mailbox, any IMAP provider. Includes a web UI for rule management, activity logging, and system status.

**Core Value:** Dramatically reduce inbox volume without losing visibility — messages that need attention stay in Inbox, everything else is automatically routed, reviewed in batches, and archived.

### Constraints

- **IMAP-only:** No message header modification, no flags beyond standard IMAP flags. Organization is folder placement only.
- **Folder-based clients:** Must work within folder-based mail clients (Mac Mail, Thunderbird, etc.). No tags, labels, or virtual folders.
- **Single instance:** No auth, no multi-tenancy. One instance per mailbox.
- **Batch filing scale:** Must handle applying rules to folders with thousands of messages. Needs progress reporting and the ability to cancel mid-run.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - Entire codebase, strict mode enabled
- JavaScript - Node.js runtime
- YAML - Configuration files (`config/default.yml`)
- HTML/CSS - Frontend static assets
- SQL - SQLite queries in database layer
## Runtime
- Node.js 25.2.1 (as of analysis)
- CommonJS module system (`"type": "commonjs"` in package.json)
- npm 11.6.2
- Lockfile: `package-lock.json` (inferred from npm usage)
## Frameworks
- Fastify 5.7.4 - HTTP server framework
- @fastify/static 9.0.0 - Serve bundled frontend assets
- esbuild 0.27.2 - TypeScript to JavaScript bundler
- Vitest 4.0.18 - Test runner for unit and integration tests
## Key Dependencies
- imapflow 1.2.8 - IMAP protocol client
- better-sqlite3 12.6.2 - Embedded SQLite database
- zod 4.3.6 - Runtime TypeScript schema validation
- yaml 2.8.2 - YAML parser/serializer
- pino 10.3.0 - Structured JSON logger
- picomatch 4.0.3 - Glob pattern matching
## Configuration
- Sourced from `.env` file at startup
- `DATA_PATH` - Directory for config file and SQLite database
- `IMAP_PASSWORD` (example) - IMAP credentials
- `tsconfig.json`
- `esbuild.mjs`
## Platform Requirements
- Node.js 25.2.1+ (TypeScript support via tsx)
- npm 11.6.2+
- better-sqlite3 requires build tools (Python, C++ compiler for native module compilation)
- Node.js 25.2.1+
- SQLite (bundled with better-sqlite3)
- Filesystem access for `DATA_PATH` (config file, database)
- IMAP server connectivity (external email provider)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- All lowercase with hyphens for multi-word: `client.ts`, `activity.ts`, `review-config.ts`
- Index files named `index.ts` for module exports
- No suffix conventions (not `service.ts`, `handler.ts`, etc.)
- Example: `src/config/repository.ts`, `src/web/routes/review-config.ts`
- camelCase for all function names
- Verb-first naming: `matchRule()`, `executeAction()`, `evaluateRules()`, `moveMessage()`
- Helper/private functions same naming as public: `executeMove()` (private), `matchRule()` (public)
- Async functions explicitly marked with `async` keyword
- Example: `src/rules/matcher.ts` exports `matchRule()`
- camelCase for all variables and constants
- Descriptive names: `activityLog`, `imapClient`, `reviewFolder`, `trashFolder`
- Numeric constants with underscores for readability: `MIN_BACKOFF_MS = 1_000`, `MAX_BACKOFF_MS = 60_000`
- Boolean variables start with verb or state: `autoReconnect`, `idleSupported`, `usable`
- Example from `src/imap/client.ts`: `private backoffMs`, `private reconnectTimer`, `private pollTimer`
- PascalCase for all types, interfaces, and classes
- Descriptive singular nouns: `EmailMessage`, `ImapConfig`, `ReviewConfig`, `ActivityEntry`
- Suffix conventions: `*Result`, `*Context`, `*Deps`, `*State` for specific patterns
- Union types use `|`: `ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'`
- Example: `src/config/schema.ts` defines `moveActionSchema`, `ReviewActionSchema`
- PascalCase, prefixed with `I` NOT used (e.g., `EmailMessage` not `IEmailMessage`)
- Event interfaces end in `Events`: `ImapClientEvents`
- Props/dependency interfaces end in `Props`, `Deps`, `Context`: `ActionContext`, `MonitorDeps`, `SweepDeps`
- Response types end in `Response`: `ImapConfigResponse`, `ActivityEntry` (shared API types in `src/shared/types.ts`)
## Code Style
- No explicit ESLint or Prettier config detected — appears to follow implicit TypeScript conventions
- Consistent with 2-space indentation throughout codebase
- Line length not formally constrained; typical range 80-120 characters
- No trailing semicolons at end of lines (not a formal rule, just observed inconsistently)
- Strict TypeScript mode enabled (`"strict": true` in `tsconfig.json`)
- Type annotations required for function parameters and returns
- No `any` type usage observed
- `unknown` type used for external library interfaces when not fully typed
- All function parameters typed: `function matchRule(rule: Rule, message: EmailMessage): boolean`
- Return types always explicit: `executeAction(...): Promise<ActionResult>`
- Type predicates used: `message.from.address`
- Type guards with `instanceof` and `is` checks: `err instanceof Error ? err : new Error(String(err))`
## Import Organization
- No alias configuration detected
- Relative paths used throughout: `'../config/index.js'`, `'./client.js'`, `'../../src/imap/index.js'`
- Index files explicitly imported: `from '../config/index.js'` (not just `from '../config'`)
- `.js` extension required on all local imports (ESM): `from './index.js'`
- CommonJS fallback in `package.json`: `"type": "commonjs"`
- Import syntax: `import X from 'Y'` and `import type { X } from 'Y'`
- Type-only imports separated: `import type { Rule } from '../config/index.js'`
## Error Handling
- Try-catch blocks with typed error handling
- Error messages thrown as `Error` instances: `throw new Error('Not connected')`
- Error context included: `throw new Error(\`Validation failed: ${issues.join(', ')}\`)`
- Fallback error normalization: `const error = err instanceof Error ? err : new Error(String(err))`
- Example from `src/config/repository.ts`:
- `.catch()` handlers at application entry point: `main().catch((err) => { logger.fatal(err, ...); })`
- Explicit async/await with try-catch in functions
- Promise rejection handled: `mockRejectedValue(new Error('...'))`
- Pino logger used throughout: `import pino from 'pino'`
- Logger created with name: `const logger = pino({ name: 'mail-mgr' })`
- Logging levels: `logger.info()`, `logger.error()`, `logger.debug()`, `logger.fatal()`
- Context objects passed to logger: `logger.error({ uid: msg.uid, error }, 'message')`
## Comments
- Architecture/workflow comments with prefixes: `// H1:`, `// H2:`, `// H3:` in `src/index.ts` explain initialization sequence
- Inline comments explain non-obvious behavior: `// best-effort logout`, `// noop failure will trigger error/close handlers`
- Comments on logic at feature boundaries, not on trivial operations
- JSDoc blocks used for public functions and types
- Format: `/** description */` above function definitions
- Example from `src/rules/matcher.ts`:
- No `@param` or `@returns` tags observed — plain description style
- Example from `src/actions/index.ts`:
## Function Design
- Functions typically 10-50 lines
- Complex logic extracted into helper functions
- Example: `executeMove()` is private helper for `executeAction()` in `src/actions/index.ts`
- Maximum 3-4 parameters; use objects for multiple options
- Destruturing from objects common: `const { action } = rule`
- Type parameters used: `async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T>`
- Always typed explicitly
- Objects returned with consistent shape: `ActionResult` type defines all return fields
- Discriminated unions for variants: `action: 'move' | 'review' | 'skip' | 'delete'` in results
- Used for I/O operations: network calls, file access, database operations
- Return `Promise<T>` explicitly typed
- Parallel execution with `Promise.all()` where applicable
- Retry logic implemented: see `executeMove()` which retries with folder creation
## Module Design
- Explicit export lists (not default exports except for classes in rare cases)
- Barrel files in `index.ts` consolidate exports from module
- Example from `src/imap/index.ts`:
- Used to create clean module boundaries
- Located at `index.ts` in each logical module: `src/config/index.ts`, `src/imap/index.ts`, `src/log/index.ts`
- Re-export types and implementations for public API
- Dependencies passed as constructor parameters or function arguments
- Interfaces define dependency shape: `MonitorDeps`, `ActionContext`, `SweepDeps`
- Example from `src/monitor/index.ts`:
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Clean separation between IMAP connectivity, rule evaluation, action execution, and HTTP API
- Event-driven processing: `Monitor` listens for new mail and processes asynchronously
- Hot-reload configuration with graceful worker restart
- Dual sweep mechanisms: immediate rule-based actions on arrival, scheduled review folder cleanup
- Database-backed activity log for audit trail
## Layers
- Purpose: Load, validate, and manage application config with hot-reload support
- Location: `src/config/`
- Contains: YAML loader, schema validation (Zod), in-memory repository, environment variable substitution
- Depends on: File system, `zod` validation
- Used by: All other layers via dependency injection
- Purpose: Abstract IMAP protocol operations, connection lifecycle, and message fetch/move
- Location: `src/imap/`
- Contains: Connection state machine, auto-reconnect with exponential backoff, IDLE/poll support, message parsing
- Depends on: `imapflow` library, email header parsing
- Used by: `Monitor`, `ReviewSweeper`, route handlers
- Purpose: Evaluate rules against messages and execute corresponding actions (move, delete, skip, review)
- Location: `src/rules/`, `src/actions/`
- Contains: Glob pattern matching (case-insensitive), rule evaluation, move/delete/review action execution
- Depends on: IMAP client, message types, `picomatch` for glob patterns
- Used by: `Monitor`, `ReviewSweeper`
- Purpose: Listen for new IMAP messages, fetch them, evaluate rules, execute actions at arrival time
- Location: `src/monitor/index.ts`
- Contains: Event listener, serialized processing, UID tracking, state exposure for API
- Depends on: IMAP client, rules evaluator, action executor, activity log
- Used by: Main entry point, status API
- Purpose: Periodically scan review folder, re-evaluate rules after retention threshold, archive or delete messages
- Location: `src/sweep/index.ts`
- Contains: Scheduled sweep loop, age-based eligibility check, sweep destination resolution
- Depends on: IMAP client, rules evaluator, activity log, configuration
- Used by: Main entry point, review status API
- Purpose: HTTP routes for configuration management, activity log, and status monitoring
- Location: `src/web/routes/`
- Contains: 6 route registrars (rules, activity, status, IMAP config, review config, review status)
- Depends on: Fastify, repository/log, Monitor and ReviewSweeper instances
- Used by: Frontend SPA, external monitoring
- Purpose: Single-page application for rule management, activity viewing, system status
- Location: `src/web/frontend/`
- Contains: TypeScript SPA with DOM rendering, API client, state management
- Depends on: Web API routes
- Used by: Web browsers
- Purpose: Persist all rule actions to SQLite for audit and API retrieval
- Location: `src/log/index.ts`
- Contains: SQLite schema, activity logging, state persistence, auto-pruning (30-day retention)
- Depends on: `better-sqlite3`, file system
- Used by: `Monitor`, `ReviewSweeper`, activity API
## Data Flow
- **Monitor state:** `connectionStatus`, `lastProcessedAt`, `messagesProcessed`
- **ReviewSweeper state:** folder path, message counts (total/unread/read), next sweep time, last sweep summary
- **Persistent state:** Last processed UID, sweep summaries stored in SQLite state table
## Key Abstractions
- Purpose: Canonical message format for rule matching and action context
- Examples: `src/imap/messages.ts`
- Pattern: Parsed IMAP envelope into normalized `{ uid, messageId, from, to, cc, subject, date, flags }`
- Purpose: Declarative email handling
- Examples: `src/config/schema.ts`
- Pattern: Rules have `match` conditions (sender/recipient/subject globs) and `action` (move/review/skip/delete)
- Purpose: Message format for review folder scanning (includes internal date, needed for age calculation)
- Examples: `src/imap/messages.ts`
- Pattern: Lighter than EmailMessage, used only in sweep context
- Purpose: Provide client, folder paths to action executor
- Examples: `src/actions/index.ts`
- Pattern: Contains IMAP client, review folder path, trash folder path for move/delete operations
- Purpose: Inject dependencies into Fastify routes
- Examples: `src/web/server.ts`
- Pattern: Passed to route registrars; routes call `deps.getMonitor()`, `deps.getSweeper()` for current instances
## Entry Points
- Location: `src/index.ts`
- Triggers: Node.js process start
- Responsibilities:
- Location: `src/web/server.ts` → `buildServer()`
- Triggers: Called from main()
- Responsibilities: Instantiate Fastify, register static file serving, register all route handlers, return app instance
- Location: `src/web/routes/*.ts`
- Triggers: Fastify request matching `/api/*`
- Responsibilities: Extract query/body, call repository or service, format response
## Error Handling
- **Message Move Failures:** `executeAction()` in `src/actions/index.ts` catches initial failure, attempts folder creation, retries move, returns success/error result
- **IMAP Connection Errors:** ImapClient catches connection errors, schedules exponential backoff reconnect (1s→60s), emits `error` event to Monitor
- **Config Validation:** Schema validation via Zod; on failure, throws with detailed issue list
- **Route Handler Errors:** Caught, returned as 400 with error details (for validation) or 500 (for unexpected)
- **Activity Log Errors:** Non-blocking — failures to log don't abort message processing
- **Sweep Errors:** Caught and counted; individual message failures don't stop sweep loop
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| grant-permissions |  | `.claude/skills/grant-permissions/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
