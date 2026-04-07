# External Integrations

**Analysis Date:** 2026-04-06

## APIs & External Services

**IMAP (Email Protocol):**
- Service: IMAP4rev1 email server
  - What it's used for: Email retrieval, filtering, moving messages, folder management
  - SDK/Client: imapflow 1.2.8
  - Connection config in `src/config/schema.ts` - ImapConfig (host, port, tls, auth)
  - Wrapper class: `ImapClient` in `src/imap/client.ts`

## Data Storage

**Databases:**
- SQLite (via better-sqlite3 12.6.2)
  - Purpose: Activity log and application state persistence
  - Location: `{DATA_PATH}/db.sqlite3` (default: `./data/db.sqlite3`)
  - Client: better-sqlite3 (embedded, no external server needed)
  - Schema: `src/log/index.ts` (activity table for action history, state table for key-value storage)
  - Features: WAL mode enabled for concurrent access safety

**File Storage:**
- Local filesystem only
  - Config file: `{DATA_PATH}/config.yml`
  - Database: `{DATA_PATH}/db.sqlite3`
  - Static assets: `dist/public/` (HTML, CSS, JS bundles)
  - No cloud storage integration (S3, GCS, etc.)

**Caching:**
- In-memory cache only (specialUseCache in ImapClient)
  - Caches IMAP special-use folders (Trash, etc.) to avoid repeated lookups
  - Location: `src/imap/client.ts` line 48 - `specialUseCache: Map<string, string | null>`

## Authentication & Identity

**Auth Provider:**
- Custom (no third-party auth service)
  - IMAP credentials provided directly in config
  - `src/config/schema.ts` - `imapAuthSchema` defines user/pass fields
  - Credentials sourced from environment variable: `${IMAP_PASSWORD}` in config.yml
  - Web API has no authentication layer (local network assumed or network isolation)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, DataDog, etc.)

**Logs:**
- Pino 10.3.0 structured JSON logging
  - Initialized in `src/index.ts` as `pino({ name: 'mail-mgr' })`
  - Logged to stdout (standard Node.js logging)
  - Activity log: SQLite table in `src/log/index.ts` tracks actions performed on emails

## CI/CD & Deployment

**Hosting:**
- Not specified - Docker deployment assumed (standard Node.js container)
- Listens on `server.host` and `server.port` from config (default: `0.0.0.0:3000`)

**CI Pipeline:**
- None detected
  - No GitHub Actions, GitLab CI, or similar

## Environment Configuration

**Required env vars:**
- `IMAP_PASSWORD` - IMAP account password (referenced in `config/default.yml` as `${IMAP_PASSWORD}`)
  - Sourced from `.env` file via `node --env-file=.env` or `--env-file=.env`

**Optional env vars:**
- `DATA_PATH` - Override default data directory
  - Default: `./data`
  - Used in `src/config/loader.ts` (getConfigPath) and `src/log/index.ts` (fromDataPath)

**Secrets location:**
- `.env` file (not committed to git)
  - Credentials substituted into config during load via `substituteEnvVars()` in `src/config/loader.ts`
  - IMAP password masked in API responses (PASSWORD_MASK = '****' in `src/web/routes/imap-config.ts`)

## Webhooks & Callbacks

**Incoming:**
- None (no webhook endpoints)
- Web routes are RESTful API only: rules, activity, status, config endpoints

**Outgoing:**
- None detected
- No external API calls to third-party services
- Does not send notifications, alerts, or callbacks to external systems

## External Dependencies Summary

**Total external service dependencies: 1**
- IMAP mail server (required at runtime)

**No dependencies on:**
- Cloud APIs (AWS, GCP, Azure)
- Third-party auth (OAuth, SAML, JWT services)
- Notification services (email, SMS, webhooks)
- Monitoring/observability platforms
- CDNs or asset delivery networks

---

*Integration audit: 2026-04-06*
