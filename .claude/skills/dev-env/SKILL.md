---
name: dev-env
description: Start/stop/reset/check a local dev environment with GreenMail test IMAP server and seeded data
allowed-tools:
  - Bash(scripts/dev-env/start.sh *)
  - Bash(scripts/dev-env/stop.sh *)
  - Bash(scripts/dev-env/wait-for-port.sh *)
  - Bash(DATA_PATH=/tmp/mail-mgr-dev npx tsx scripts/dev-env/check.ts)
  - Bash(docker ps --filter name=greenmail *)
  - Bash(lsof -ti:3001)
  - Bash(lsof -ti:3143)
  - Bash(cat /tmp/mail-mgr-dev/app.pid)
  - Read
---

# Dev Environment Skill

Manages a local development environment with a test IMAP server (GreenMail) and seeded data so you can test the web UI and features without connecting to a real email account.

## Scripts

All heavy lifting is handled by shell scripts in `scripts/dev-env/` (shared with the test suite — do NOT duplicate them under this skill directory). Do NOT freestyle shell commands for starting, stopping, or waiting — use these scripts.

| Script | Purpose |
|--------|---------|
| `scripts/dev-env/start.sh` | Start GreenMail, seed data, launch app, wait for readiness |
| `scripts/dev-env/stop.sh` | Kill app, stop GreenMail, clean up `/tmp/mail-mgr-dev` |
| `scripts/dev-env/wait-for-port.sh <port> <label> [timeout]` | Wait for a TCP port to accept connections |

## Commands

### `/dev-env start`

Run the start script:
```bash
scripts/dev-env/start.sh
```
The script handles everything: starting GreenMail, waiting for IMAP, checking for port conflicts, seeding data, launching the app, and waiting for readiness. It prints a summary when done.

### `/dev-env stop`

Run the stop script:
```bash
scripts/dev-env/stop.sh
```
The script handles everything: killing the app (PID file + port fallback), stopping GreenMail, and cleaning up the data directory. Safe to run even if nothing is running.

### `/dev-env reset`

1. Run the stop script: `scripts/dev-env/stop.sh`
2. Run the start script: `scripts/dev-env/start.sh`
3. Report: "Dev environment has been reset with fresh data."

### `/dev-env check`

1. Verify the app is running by checking port 3001: `lsof -ti:3001`
2. Run the check script:
   ```bash
   DATA_PATH=/tmp/mail-mgr-dev npx tsx scripts/dev-env/check.ts
   ```
3. Report results to the user

## Important Details

- The dev app runs on port **3001** (not 3000) to avoid conflicts with a production instance
- All data lives in `/tmp/mail-mgr-dev/` — the real `data/` directory is never touched
- The seed data is defined in `scripts/dev-env/seed-data.yml` — edit that file to change what gets populated
- The seed script is at `scripts/dev-env/seed.ts`
- The check script is at `scripts/dev-env/check.ts`
- GreenMail credentials: user=`user`, pass=`pass`, host=`localhost`

## Seed Data File

The seed data YAML file (`scripts/dev-env/seed-data.yml`) contains:
- **rules** — Baked into the generated config.yml
- **emails** — Sent via SMTP to GreenMail
- **move_signals** — Inserted into SQLite (with `count` expansion)
- **proposed_rules** — Inserted into SQLite
- **activity** — Inserted into SQLite

To add more test data, edit that file. Changes take effect on next `/dev-env reset`.
