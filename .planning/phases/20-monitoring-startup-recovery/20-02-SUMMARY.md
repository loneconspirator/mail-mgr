---
phase: 20-monitoring-startup-recovery
plan: 02
subsystem: action-folders
tags: [lifecycle, startup, polling, config-change, shutdown]

# Dependency graph
requires:
  - phase: 20-monitoring-startup-recovery
    plan: 01
    provides: ActionFolderPoller class with scanAll/start/stop
provides:
  - ActionFolderPoller wired into startup, config change, and IMAP change lifecycle
  - Startup ordering guarantee: scanAll completes before monitor.start
affects: [startup-sequence, config-reload, imap-reconnect]

# Tech tracking
tech-stack:
  added: []
  patterns: [startup-ordering-guarantee, config-change-stop-rebuild, graceful-prescan-failure]

key-files:
  modified:
    - src/index.ts

key-decisions:
  - "Pre-scan failure logged and continued (D-09) -- does not block monitor.start"
  - "Poller stop/rebuild on both action-folder config change and IMAP config change"
  - "No explicit shutdown handler needed -- timer.unref() in poller.ts handles graceful exit"

requirements-completed: [MON-01, MON-02, FOLD-02, FOLD-03]

# Metrics
duration: 2min
completed: 2026-04-21
---

# Phase 20 Plan 02: Lifecycle Integration Summary

**ActionFolderPoller wired into startup pre-scan, periodic polling, config/IMAP change handlers with correct ordering guarantees**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-21T00:07:51Z
- **Completed:** 2026-04-21T00:09:32Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Reordered startup sequence: resolvedTrash -> ensureActionFolders -> scanAll -> poller.start -> monitor.start (D-05/D-07)
- Pre-scan wrapped in try/catch for graceful degradation -- failure logs error and continues (D-09/T-20-04)
- Action folder config change handler stops existing poller, rebuilds with new config (D-14/T-20-05)
- IMAP config change handler stops poller, rebuilds with new IMAP client after reconnect (D-15)
- Module-level `actionFolderPoller` variable tracks lifecycle alongside sweeper/moveTracker

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire ActionFolderPoller into index.ts lifecycle** - `5d9d9cb` (feat)

## Files Modified
- `src/index.ts` - ActionFolderPoller imported, instantiated in startup, config change, and IMAP change handlers; startup order corrected

## Decisions Made
- Pre-scan failure is gracefully degraded (logged, not thrown) per D-09 -- monitor.start proceeds regardless
- Poller rebuilt on both action-folder config change AND IMAP config change to handle all reconfiguration paths
- No explicit process signal shutdown handler added -- poller timer uses .unref() (matching MoveTracker pattern) so process exits cleanly

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all code paths are fully wired with real implementations.

## Pre-existing Test Failures

7 tests in `test/unit/web/frontend.test.ts` fail on the base commit (static file serving returns 404). These are unrelated to this plan's changes and exist before any modifications.

---
*Phase: 20-monitoring-startup-recovery*
*Completed: 2026-04-21*
