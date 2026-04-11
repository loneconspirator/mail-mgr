---
phase: 03-batch-filing-engine
plan: 02
subsystem: batch-api-wiring
tags: [batch, api, fastify, wiring, database-indexes]
dependency_graph:
  requires: [batch-engine, activity-log, server-deps, config-repository]
  provides: [batch-api-routes, batch-shared-types, batch-app-wiring]
  affects: [activity-log, server-deps, main-entry-point]
tech_stack:
  added: []
  patterns: [fire-and-forget-execution, zod-request-validation, dependency-getter-pattern]
key_files:
  created:
    - src/web/routes/batch.ts
    - test/unit/web/batch.test.ts
  modified:
    - src/log/index.ts
    - src/web/server.ts
    - src/index.ts
    - src/shared/types.ts
    - src/batch/index.ts
    - test/unit/log/activity.test.ts
decisions:
  - Fire-and-forget pattern for POST /api/batch/execute with .catch() error logging
  - Zod validation with min(1) max(500) on sourceFolder to bound input
  - Removed type assertion hack from BatchEngine now that union type is properly updated
metrics:
  duration: 191s
  completed: "2026-04-08T05:57:41Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 34
  files_created: 2
---

# Phase 03 Plan 02: Batch API Routes and Application Wiring Summary

Four batch API endpoints with Zod validation, activity log batch source support with performance indexes, and full BatchEngine lifecycle wiring into the application entry point and config change handlers.

## What Was Built

### Batch API Routes (`src/web/routes/batch.ts`)

Four endpoints for frontend-driven batch operations:

- **POST /api/batch/dry-run** - Accepts `{ sourceFolder }`, calls `engine.dryRun()`, returns `{ results: DryRunGroup[] }`. Returns 409 if batch already running.
- **POST /api/batch/execute** - Accepts `{ sourceFolder }`, fires engine.execute() without awaiting (fire-and-forget with error logging), returns `{ status: 'started' }`. Returns 409 if batch already running.
- **POST /api/batch/cancel** - Calls `engine.cancel()`, returns `{ status: 'cancelling' }`.
- **GET /api/batch/status** - Returns `engine.getState()` for polling.

All POST endpoints with body use Zod schema validation: `sourceFolder: z.string().min(1).max(500)`.

### Activity Log Updates (`src/log/index.ts`)

- Updated `logActivity` signature to accept `'batch'` as a valid source tag (`'arrival' | 'sweep' | 'batch'`)
- Added `idx_activity_source` index on `activity(source)` for filtering by source type
- Added `idx_activity_folder_success` index on `activity(folder, success)` for batch-scale query performance

### Application Wiring (`src/index.ts`)

- BatchEngine instantiated with IMAP client, activity log, rules, and folder paths
- `batchEngine.updateRules(rules)` added to `configRepo.onRulesChange` callback
- BatchEngine recreated with new IMAP client on `configRepo.onImapConfigChange`
- `getBatchEngine: () => batchEngine` added to `buildServer` deps

### ServerDeps Update (`src/web/server.ts`)

- Added `getBatchEngine: () => BatchEngine` to ServerDeps interface
- Registered `registerBatchRoutes(app, deps)` in `buildServer`

### Shared Types (`src/shared/types.ts`)

- Added `DryRunMessage`, `DryRunGroup`, `BatchStatus`, `BatchStatusResponse`, `DryRunResponse` for frontend consumption

### Tests (`test/unit/web/batch.test.ts`, `test/unit/log/activity.test.ts`)

- 9 batch route tests: dry-run success, dry-run validation (empty/missing), execute fire-and-forget, execute 409 conflict, cancel, status, dry-run 409 conflict
- 4 new activity log tests: batch source insert, batch entries in getRecentActivity, idx_activity_source existence, idx_activity_folder_success existence

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 6732870 | test | Add failing tests for batch source and database indexes (TDD RED) |
| 14ccd22 | feat | Add batch source to activity log and database indexes (TDD GREEN) |
| 669ce00 | test | Add failing tests for batch API routes (TDD RED) |
| 433f62e | feat | Add batch API routes, ServerDeps wiring, and app integration (TDD GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed type assertion hack in BatchEngine**
- **Found during:** Task 1
- **Issue:** Plan 01 used `'batch' as 'arrival' | 'sweep'` type assertion since the union wasn't updated yet
- **Fix:** Removed the assertion now that the union properly includes `'batch'`
- **Files modified:** src/batch/index.ts
- **Commit:** 14ccd22

## Known Pre-existing Issues

- `test/unit/web/frontend.test.ts` has 4 failing tests (pre-existing, missing `getFolderCache` in mock deps). Not caused by this plan's changes.

## Self-Check: PASSED
