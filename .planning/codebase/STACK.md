# Technology Stack

**Analysis Date:** 2026-04-06

## Languages

**Primary:**
- TypeScript 5.9.3 - Entire codebase, strict mode enabled
- JavaScript - Node.js runtime

**Secondary:**
- YAML - Configuration files (`config/default.yml`)
- HTML/CSS - Frontend static assets
- SQL - SQLite queries in database layer

## Runtime

**Environment:**
- Node.js 25.2.1 (as of analysis)
- CommonJS module system (`"type": "commonjs"` in package.json)

**Package Manager:**
- npm 11.6.2
- Lockfile: `package-lock.json` (inferred from npm usage)

## Frameworks

**Core:**
- Fastify 5.7.4 - HTTP server framework
  - Purpose: REST API server for configuration, activity, and status endpoints
  - Location: `src/web/server.ts`

**Static File Serving:**
- @fastify/static 9.0.0 - Serve bundled frontend assets
  - Location: `src/web/server.ts` via `fastifyStatic` registration

**Frontend Building:**
- esbuild 0.27.2 - TypeScript to JavaScript bundler
  - Config: `esbuild.mjs`
  - Entry: `src/web/frontend/app.ts`
  - Output: `dist/public/app.js` (minified, IIFE bundle)

**Testing:**
- Vitest 4.0.18 - Test runner for unit and integration tests
  - Config files: `vitest.config.ts` (unit tests), `vitest.integration.config.ts` (integration tests)
  - Test location: `test/` directory
  - Commands: `npm test` (unit), `npm test:integration`

## Key Dependencies

**Critical:**
- imapflow 1.2.8 - IMAP protocol client
  - Why it matters: Core dependency for email retrieval and manipulation (move, create folders, fetch)
  - Factory pattern wrapper in `src/imap/client.ts` for testability
  - Imported in `src/index.ts` and wrapped by `ImapClient` class

- better-sqlite3 12.6.2 - Embedded SQLite database
  - Why it matters: Local persistence for activity logs and state (no external DB required)
  - Schema in `src/log/index.ts`
  - Uses WAL mode for concurrent access safety

**Configuration & Validation:**
- zod 4.3.6 - Runtime TypeScript schema validation
  - Location: `src/config/schema.ts`
  - Validates full app config (IMAP, server, rules, review settings)

- yaml 2.8.2 - YAML parser/serializer
  - Location: `src/config/loader.ts`
  - Loads `config.yml` and preserves `${VAR}` references on save

**Logging:**
- pino 10.3.0 - Structured JSON logger
  - Initialized in `src/index.ts` as `pino({ name: 'mail-mgr' })`
  - Passed to core modules (Monitor, ReviewSweeper, etc.)

**Utilities:**
- picomatch 4.0.3 - Glob pattern matching
  - Used for email rule matching (sender, recipient, subject patterns)
  - Location: Likely in `src/rules/matcher.ts`

## Configuration

**Environment:**
- Sourced from `.env` file at startup
  - Load via: `node --env-file=.env` in `npm start`
  - Dev mode: `tsx watch --env-file=.env src/index.ts`

**Environment Variables:**
- `DATA_PATH` - Directory for config file and SQLite database
  - Default: `./data`
  - Config file: `{DATA_PATH}/config.yml`
  - Database: `{DATA_PATH}/db.sqlite3`

- `IMAP_PASSWORD` (example) - IMAP credentials
  - Referenced in `config/default.yml` as `${IMAP_PASSWORD}`
  - Substitution in `src/config/loader.ts` via `substituteEnvVars()`

**Build Configuration:**
- `tsconfig.json`
  - Target: ES2022
  - Module: NodeNext
  - Strict mode enabled
  - Output: `dist/` directory
  - Source: `src/` directory

- `esbuild.mjs`
  - Bundles frontend TypeScript → single `app.js`
  - Copies static files (`index.html`, `styles.css`) to `dist/public/`

## Platform Requirements

**Development:**
- Node.js 25.2.1+ (TypeScript support via tsx)
- npm 11.6.2+
- better-sqlite3 requires build tools (Python, C++ compiler for native module compilation)

**Production:**
- Node.js 25.2.1+
- SQLite (bundled with better-sqlite3)
- Filesystem access for `DATA_PATH` (config file, database)
- IMAP server connectivity (external email provider)

---

*Stack analysis: 2026-04-06*
