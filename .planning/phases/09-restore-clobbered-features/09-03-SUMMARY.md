---
phase: 09-restore-clobbered-features
plan: 03
subsystem: backend-wiring
tags: [restore, routes, server, monitor, main-entry, tests]
dependency_graph:
  requires: [shared-types, imap-envelope, config-review-crud, migrations, folder-cache, ReviewSweeper, BatchEngine]
  provides: [review-route, review-config-route, batch-routes, folder-route, full-server-deps, monitor-envelope, main-entry-wiring]
  affects: [frontend, integration-tests]
tech_stack:
  added: []
  patterns: [additive-merge, pre-clobber-restoration, server-deps-expansion]
key_files:
  created:
    - src/web/routes/review.ts
    - src/web/routes/review-config.ts
    - src/web/routes/batch.ts
    - src/web/routes/folders.ts
    - test/unit/web/batch.test.ts
    - test/unit/web/folders.test.ts
    - test/unit/log/migrations.test.ts
    - test/unit/folders/cache.test.ts
  modified:
    - src/web/routes/rules.ts
    - src/web/server.ts
    - src/monitor/index.ts
    - src/index.ts
    - test/unit/web/api.test.ts
decisions:
  - Used pre-clobber saveConfig pattern for envelope header persistence in main entry (consistent with pre-clobber architecture)
  - Updated folders.test.ts mock deps to include full ServerDeps interface instead of partial cast
metrics:
  duration: 6m
  completed: 2026-04-12
  tasks: 2
  files: 13
---

# Phase 09 Plan 03: Restore Backend Wiring Summary

Restored 4 deleted route handlers (review, review-config, batch, folders), merged server.ts with full ServerDeps interface preserving Phase 8 envelope routes, added monitor envelope/cursor support, and wired the main entry point with complete lifecycle management for sweeper, batch engine, and folder cache.

## Task Results

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Restore route handlers, merge server.ts, and restore monitor envelope support | 15b0e9d | Done |
| 2 | Restore main entry wiring and remaining test files | 53a2964 | Done |

## What Changed

### Task 1: Restore route handlers, merge server.ts, and restore monitor envelope support
- **src/web/routes/review.ts**: Restored review status API route with getSweeper() dep
- **src/web/routes/review-config.ts**: Restored review config CRUD and cursor toggle settings endpoints
- **src/web/routes/batch.ts**: Restored batch API routes (dry-run, execute, cancel, status) with Zod validation
- **src/web/routes/folders.ts**: Restored folder tree API route with force-refresh support and 503 fallback
- **src/web/routes/rules.ts**: Added checkFolderWarnings helper and FolderCache integration to POST/PUT handlers
- **src/web/server.ts**: Merged with full ServerDeps (getSweeper, getFolderCache, getBatchEngine), registered all 9 route handlers including Phase 8 registerEnvelopeRoutes
- **src/monitor/index.ts**: Added envelopeHeader field passed to parseMessage, cursorEnabled toggle with conditional UID persistence, per-message try/catch for resilience
- Commit: `15b0e9d`

### Task 2: Restore main entry wiring and remaining test files
- **src/index.ts**: Restored from pre-clobber with full lifecycle wiring: ReviewSweeper, BatchEngine, FolderCache creation; onRulesChange propagation to sweeper/batch; onReviewConfigChange listener for sweeper/batch rebuild; onImapConfigChange with envelope discovery (Phase 8 preserved); getSweeper/getFolderCache/getBatchEngine passed to buildServer
- **test/unit/web/batch.test.ts**: Restored 10 tests covering dry-run, execute, cancel, status endpoints
- **test/unit/web/folders.test.ts**: Restored 5 tests covering folder tree retrieval, refresh, and 503 fallback
- **test/unit/log/migrations.test.ts**: Restored 7 tests covering schema_version creation, idempotent migration, bootstrap column detection
- **test/unit/folders/cache.test.ts**: Restored 14 tests covering TTL caching, stale fallback, hasFolder path matching
- **test/unit/web/api.test.ts**: Fixed mock deps to include getSweeper, getFolderCache, getBatchEngine (Rule 3)
- Commit: `53a2964`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] api.test.ts mock missing new ServerDeps fields**
- **Found during:** Task 2 verification
- **Issue:** Existing api.test.ts POST/PUT rule tests returned 400 because checkFolderWarnings calls deps.getFolderCache() which was undefined in the mock
- **Fix:** Added getSweeper, getFolderCache, getBatchEngine mock implementations to makeDeps()
- **Files modified:** test/unit/web/api.test.ts
- **Commit:** 53a2964

**2. [Rule 3 - Blocking] folders.test.ts mock needed full ServerDeps**
- **Found during:** Task 2 (pre-clobber test had partial mock with `monitor` field)
- **Fix:** Updated createMockDeps to provide all ServerDeps fields (getMonitor, getSweeper, getFolderCache, getBatchEngine) instead of partial cast
- **Files modified:** test/unit/web/folders.test.ts
- **Commit:** 53a2964

## Verification Results

- Build: npm run build passes (exit 0)
- Tests: 350/354 pass (19 test files pass, 1 pre-existing failure in actions.test.ts)
- Pre-existing failures: 4 tests in actions.test.ts from Plan 02's ActionContext sourceFolder changes (out of scope)
- All 4 restored test files pass: batch (10), folders (5), migrations (7), cache (14) = 36 tests
- All acceptance criteria verified

## Self-Check: PASSED
