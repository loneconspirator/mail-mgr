---
phase: 28-sentinel-planting-lifecycle
plan: 02
subsystem: sentinel
tags: [sentinel, lifecycle, startup, config-handlers, integration]
dependency_graph:
  requires: [collectTrackedFolders, reconcileSentinels, runSentinelSelfTest, SentinelStore]
  provides: [sentinel-startup-integration, sentinel-config-change-wiring]
  affects: [src/index.ts]
tech_stack:
  added: []
  patterns: [fire-and-forget-async, self-test-gate, reconcile-on-change]
key_files:
  created: []
  modified:
    - src/index.ts
decisions:
  - "onRulesChange uses fire-and-forget (.catch) since callback is sync"
  - "onActionFolderConfigChange restructured to eliminate early returns so sentinel reconciliation always runs"
  - "Sentinel self-test placed after trash resolution, before ensureActionFolders"
  - "Initial reconciliation placed after ensureActionFolders, before monitor.start"
metrics:
  duration: "1m 45s"
  completed: "2026-04-22T04:11:06Z"
  tasks: 1
  files_created: 0
  files_modified: 1
  lines_added: 56
---

# Phase 28 Plan 02: Sentinel Lifecycle Wiring Summary

Sentinel lifecycle wired into src/index.ts: self-test gates planting on startup and IMAP reconnect, initial reconciliation runs after action folders exist, all 4 config change handlers trigger reconciliation.

## What Was Built

### Startup Integration
- `sentinelEnabled = await runSentinelSelfTest(...)` runs after IMAP connect and trash resolution but before ensureActionFolders
- Initial `reconcileSentinels(...)` runs after ensureActionFolders completes but before `monitor.start()`
- If self-test fails, `sentinelEnabled` stays false and all sentinel operations are no-op

### Config Change Handlers
- **onRulesChange**: fire-and-forget reconciliation with `.catch()` (sync callback constraint)
- **onReviewConfigChange**: awaited reconciliation after sweeper/batchEngine rebuild
- **onActionFolderConfigChange**: reconciliation runs regardless of enabled/disabled state (catches orphan cleanup); handler restructured from early-return to if/else to ensure sentinel code always executes
- **onImapConfigChange**: full self-test + reconciliation with the new IMAP client after MoveTracker rebuild

### Barrel Exports
Already complete from Plan 01 (collectTrackedFolders, reconcileSentinels exported from sentinel/index.ts).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 2b6354a | Wire sentinel lifecycle into startup and config handlers |

## Test Results

- 80 sentinel tests passing (lifecycle + format + imap-ops + store)
- TypeScript compilation clean (npx tsc --noEmit exits 0)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Restructured onActionFolderConfigChange to avoid early returns**
- **Found during:** Task 1
- **Issue:** Original handler used early returns for disabled/failed states, which would skip sentinel reconciliation at the end
- **Fix:** Converted to if/else structure so sentinel reconciliation always executes regardless of action folder state
- **Files modified:** src/index.ts
- **Commit:** 2b6354a

**2. [Rule 1 - Already done] Barrel exports already present**
- **Found during:** Task 1 Step 1
- **Issue:** Plan specified adding barrel exports but Plan 01 already added them as a deviation
- **Fix:** Skipped Step 1 (no change needed)
- **Files modified:** none

## Known Stubs

None - all integration points are fully wired with no placeholder logic.
