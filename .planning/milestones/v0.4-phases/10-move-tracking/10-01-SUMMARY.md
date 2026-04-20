---
phase: 10-move-tracking
plan: 01
subsystem: tracking-data-layer
tags: [database, migration, config, signals]
dependency_graph:
  requires: []
  provides: [move_signals-table, SignalStore, moveTrackingConfig]
  affects: [src/log/migrations.ts, src/tracking/signals.ts, src/config/schema.ts, src/config/index.ts]
tech_stack:
  added: []
  patterns: [versioned-migrations, parameterized-sql, zod-config-schema]
key_files:
  created:
    - src/log/migrations.ts
    - src/tracking/signals.ts
    - test/unit/log/migrations.test.ts
    - test/unit/tracking/signals.test.ts
  modified:
    - src/config/schema.ts
    - src/config/index.ts
decisions:
  - Used schema_migrations tracking table for versioned migration system instead of extending inline ALTER TABLE pattern
key_decisions:
  - "Created formal migration system with schema_migrations table for tracking applied versions -- more scalable than inline ALTER TABLE"
metrics:
  duration: 3m19s
  completed: "2026-04-13T00:56:25Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 13
  files_changed: 6
---

# Phase 10 Plan 01: Move Signals Data Layer Summary

Versioned migration system with move_signals table, SignalStore CRUD class, and moveTracking config schema extension for scan interval and enabled toggle.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Database migration and SignalStore class (TDD) | dd566c7, 5414cf1 | src/log/migrations.ts, src/tracking/signals.ts, test/unit/log/migrations.test.ts, test/unit/tracking/signals.test.ts |
| 2 | Config schema extension for moveTracking | 545e8aa | src/config/schema.ts, src/config/index.ts |

## What Was Built

### Migration System (src/log/migrations.ts)

Created a formal versioned migration system with `Migration` interface, `migrations` array, and `runMigrations()` function. Tracks applied versions in a `schema_migrations` table so each migration runs exactly once. First migration (`20260412_001`) creates `move_signals` table with 11 columns (id, timestamp, message_id, sender, envelope_recipient, list_id, subject, read_status, visibility, source_folder, destination_folder) and 3 indexes (idx_signals_timestamp, idx_signals_sender, idx_signals_destination).

### SignalStore (src/tracking/signals.ts)

CRUD class for move_signals table with four methods:
- `logSignal(input)` -- INSERT with 9 parameterized fields, returns row id
- `getSignals(limit)` -- SELECT in reverse chronological order
- `getSignalByMessageId(id)` -- lookup by message_id, returns null if not found
- `prune(days=90)` -- DELETE signals older than threshold, returns count

All SQL uses `db.prepare(...).run/get/all(...)` with `?` placeholders -- no string interpolation of user data (T-10-01 mitigation).

### Config Schema (src/config/schema.ts)

Added `moveTrackingConfigSchema` with:
- `enabled: z.boolean().default(true)` -- move tracking on by default (D-10)
- `scanInterval: z.number().int().positive().default(30)` -- 30-second default (D-02, D-03)

Nested under `reviewConfigSchema.moveTracking` with defaults so existing configs are backward-compatible. `MoveTrackingConfig` type exported via barrel file.

## Decisions Made

1. **Formal migration system over inline ALTER TABLE** -- Created `schema_migrations` tracking table rather than extending the existing try/catch ALTER TABLE pattern in ActivityLog. This supports multiple future migrations cleanly and is idempotent.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- `npx vitest run test/unit/log/migrations.test.ts` -- 4 tests passed
- `npx vitest run test/unit/tracking/signals.test.ts` -- 9 tests passed
- `npx vitest run test/unit/config` -- 47 tests passed
- `npm run build` -- succeeded

## Self-Check: PASSED

- [x] src/log/migrations.ts exists
- [x] src/tracking/signals.ts exists
- [x] test/unit/log/migrations.test.ts exists
- [x] test/unit/tracking/signals.test.ts exists
- [x] src/config/schema.ts modified with moveTrackingConfigSchema
- [x] Commits dd566c7, 5414cf1, 545e8aa verified in git log
