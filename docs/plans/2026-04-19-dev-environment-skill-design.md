# Dev Environment Skill Design

## Overview

A project-specific Claude skill (`/dev-env`) that spins up a complete test environment with seeded data for manual development testing without connecting to a real email account.

## Files

All in `.claude/skills/dev-environment/`:

| File | Purpose |
|------|---------|
| `dev-environment.md` | Skill definition — handles start/stop/reset/check |
| `seed-data.yml` | Single source of truth for all test data |
| `seed.ts` | Reads YAML, populates GreenMail via SMTP + SQLite directly |
| `check.ts` | Hits API endpoints, verifies expected state |

## Commands

- `/dev-env start` — Start GreenMail + app, seed data, print URL
- `/dev-env stop` — Kill app, tear down GreenMail, clean up temp dir
- `/dev-env reset` — Stop then start
- `/dev-env check` — Verify environment state via API assertions

## Infrastructure

- GreenMail via existing `docker-compose.test.yaml` (IMAP 3143, SMTP 3025)
- App runs with `DATA_PATH=/tmp/mail-mgr-dev`
- Generated `config.yml` in temp dir points at localhost GreenMail
- Real `data/` directory never touched

## Seed Data

`seed-data.yml` contains:
- **folders** — Created implicitly via email delivery
- **rules** — Baked into generated config.yml
- **emails** — Injected via SMTP to GreenMail
- **move_signals** — Inserted directly into SQLite (expanded from count)
- **proposed_rules** — Inserted directly into SQLite
- **activity** — Inserted directly into SQLite

## Seed Script

- Runs with `npx tsx .claude/skills/dev-environment/seed.ts`
- Reuses `sendTestEmail` from `test/integration/helpers.ts`
- Runs app migration logic before DB inserts
- Generates config.yml with test IMAP credentials

## Check Script

- Runs with `npx tsx .claude/skills/dev-environment/check.ts`
- Hits GET /api/proposed-rules, GET /api/activity, GET /api/status
- Asserts expected counts and data presence
- Reports pass/fail per check
