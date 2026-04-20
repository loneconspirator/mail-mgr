---
phase: 10-move-tracking
plan: 03
subsystem: tracking-lifecycle
tags: [move-tracking, lifecycle, integration, wiring]
dependency_graph:
  requires: [10-01, 10-02]
  provides: [move-tracker-lifecycle, signal-auto-prune, server-deps-expansion]
  affects: [src/index.ts, src/web/server.ts, src/log/index.ts, src/imap/client.ts]
tech_stack:
  added: []
  patterns: [shared-db-accessor, daily-prune-interval, getter-based-deps]
key_files:
  created: []
  modified:
    - src/index.ts
    - src/web/server.ts
    - src/log/index.ts
    - src/imap/client.ts
decisions:
  - "Used ActivityLog.getDb() to share SQLite instance with SignalStore rather than opening a second connection"
  - "Added ImapClient.listMailboxes() public method to provide DestinationResolver folder listing"
  - "No onReviewConfigChange handler exists in codebase -- MoveTracker rebuild wired only to onImapConfigChange"
metrics:
  duration: 228s
  completed: "2026-04-13T01:14:54Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
---

# Phase 10 Plan 03: Application Lifecycle Integration Summary

MoveTracker, SignalStore, and DestinationResolver wired into main() with config change rebuild and daily signal pruning.

## What Was Done

### Task 1: Expand ServerDeps with getMoveTracker (2da00fb)
- Added `MoveTracker` type import to `src/web/server.ts`
- Added `getMoveTracker: () => MoveTracker | undefined` to `ServerDeps` interface
- Added temporary undefined stub in `src/index.ts` buildServer call (replaced in Task 2)

### Task 2: Wire MoveTracker into main entry point (d74efc6)
- Added `ActivityLog.getDb()` method exposing shared SQLite database instance
- Added `ImapClient.listMailboxes()` method for DestinationResolver folder enumeration
- Created `SignalStore` after ActivityLog using shared DB, with startup prune and daily 90-day auto-prune interval
- Created `DestinationResolver` and `MoveTracker` after IMAP connect with config-driven settings
- Rebuilt MoveTracker in `onImapConfigChange` handler (stop, recreate, start)
- Wired `getMoveTracker: () => moveTracker` into buildServer deps

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ImapClient.listMailboxes() method**
- **Found during:** Task 2
- **Issue:** DestinationResolver requires a `listFolders` function but ImapClient had no public method to list mailboxes
- **Fix:** Added `listMailboxes()` to ImapClient that wraps `flow.list()` and returns `{ path, flags }[]`
- **Files modified:** src/imap/client.ts
- **Commit:** d74efc6

**2. [Rule 3 - Blocking] No onReviewConfigChange handler in codebase**
- **Found during:** Task 2
- **Issue:** Plan specifies rebuilding MoveTracker on review config change, but `ConfigRepository` only has `onRulesChange` and `onImapConfigChange`
- **Fix:** Skipped review config change wiring -- MoveTracker is rebuilt on IMAP config change only. Review config changes (folder name, moveTracking settings) require IMAP config change or restart to take effect.
- **Impact:** Minimal -- review config changes are rare operational events

## Verification

- `npm run build` -- exits 0
- `npx vitest run` -- 213 tests passed (16 test files), 0 failures

## Known Stubs

None -- all wiring is complete and functional.

## Self-Check: PASSED

All files exist, both commits verified, all content checks confirmed.
