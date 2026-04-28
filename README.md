# mail-mgr

An email rule engine that monitors an IMAP mailbox, matches incoming messages against configurable glob-pattern rules, and executes actions like moving messages to folders. Includes a web UI for managing rules, viewing activity, and configuring IMAP settings. The system also learns from manual moves, proposing new rules based on observed user behavior.

For system design, modules, integrations, and use cases, see [`specs/architecture.md`](./specs/architecture.md) and the [`specs/`](./specs/README.md) directory.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Development](#development)
- [Testing](#testing)
- [Docker Deployment](#docker-deployment)
- [Further Reading](#further-reading)

## Installation

**Prerequisites:** Node.js 22+, npm

```bash
git clone <repo-url>
cd mail-mgr
npm install
npm run build
npm start
```

Build runs `tsc` (TypeScript → `dist/`) then `esbuild` (frontend SPA → `dist/public/app.js`). The server starts on `http://localhost:3000` by default. On first run a default `config.yml` is created in the data directory.

## Configuration

Configuration lives in `$DATA_PATH/config.yml` (defaults to `./data/config.yml`).

```yaml
imap:
  host: imap.example.com
  port: 993
  tls: true
  auth:
    user: you@example.com
    pass: ${IMAP_PASSWORD}
  idleTimeout: 300000    # IDLE cycle interval (ms), default 5 min
  pollInterval: 60000    # Polling fallback interval (ms), default 1 min

server:
  port: 3000
  host: 0.0.0.0

rules: []
```

Any config value can reference environment variables with `${VAR_NAME}` syntax. References are preserved when config is saved through the web UI.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATA_PATH` | Directory for config.yml and db.sqlite3 | `./data` |
| `IMAP_PASSWORD` | IMAP password (referenced in config) | - |
| `NODE_ENV` | Set to `production` in Docker | - |

Rule format, matching semantics, and supported actions are documented in the relevant module specs — see [`specs/modules/mod-0004-rule-evaluator.md`](./specs/modules/mod-0004-rule-evaluator.md), [`mod-0005-rule-matcher.md`](./specs/modules/mod-0005-rule-matcher.md), and [`mod-0006-action-executor.md`](./specs/modules/mod-0006-action-executor.md).

## Development

```bash
npm install
npm run dev           # tsx watch, auto-restarts on source changes
npm run build:frontend
```

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript 5.9 |
| Web framework | Fastify 5.7 |
| IMAP | imapflow 1.2 |
| Database | SQLite (better-sqlite3) |
| Config validation | Zod |
| Pattern matching | picomatch |
| Logging | pino |
| Frontend | Vanilla TypeScript, esbuild |
| Testing | Vitest, GreenMail |

For the source layout and module responsibilities, see [`specs/architecture.md`](./specs/architecture.md) and the per-module specs in [`specs/modules/`](./specs/modules/).

## Testing

### Unit Tests

```bash
npm test              # one-shot
npm run test:watch    # watch mode
```

### Integration Tests

Integration tests run against a real IMAP server (GreenMail) in Docker. Docker must be installed and running.

```bash
docker compose -f docker-compose.test.yaml up -d   # SMTP :3025, IMAP :3143, user:pass@localhost
npm run test:integration
docker compose -f docker-compose.test.yaml down
```

- `vitest.config.ts` — unit test config (excludes `test/integration/`)
- `vitest.integration.config.ts` — integration test config (only `test/integration/`)

Each integration test maps to a named integration in [`specs/integrations/`](./specs/integrations/). Acceptance tests for use cases live alongside, referenced from [`specs/use-cases/`](./specs/use-cases/).

## Docker Deployment

```bash
docker compose up -d
# or with the IMAP password inline:
IMAP_PASSWORD=your-password docker compose up -d
```

Or create a `.env` file containing `IMAP_PASSWORD=your-password`.

The Docker setup uses a multi-stage build on `node:22-alpine`, runs as non-root user `mailmgr`, persists data in a named volume at `/data`, seeds `config.yml` from the default template on first run, exposes port 3000, and restarts automatically unless stopped.

```bash
docker compose down
```

## Further Reading

- [`specs/architecture.md`](./specs/architecture.md) — module map, entity relationships, data flow, integration chains
- [`specs/README.md`](./specs/README.md) — spec system overview (use cases, integrations, modules, invariants, failure modes)
- [`specs/use-cases/`](./specs/use-cases/) — end-to-end user-facing flows
- [`specs/integrations/`](./specs/integrations/) — module interaction chains
- [`specs/modules/`](./specs/modules/) — per-module contracts and responsibilities
