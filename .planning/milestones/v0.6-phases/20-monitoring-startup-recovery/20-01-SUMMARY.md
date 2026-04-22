---
phase: 20-monitoring-startup-recovery
plan: 01
subsystem: action-folders
tags: [imap, polling, setInterval, action-folders, tdd]

# Dependency graph
requires:
  - phase: 19-action-processing-core
    provides: ActionFolderProcessor with processMessage method
  - phase: 17-configuration-folder-lifecycle
    provides: ActionFolderConfig schema and registry
provides:
  - ActionFolderPoller class with scanAll/start/stop for periodic action folder monitoring
  - Standalone scanAll() for startup pre-scan
affects: [20-02, startup-integration, monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns: [polling-with-overlap-guard, always-empty-invariant-with-single-retry]

key-files:
  created:
    - src/action-folders/poller.ts
  modified:
    - src/action-folders/index.ts
    - test/unit/action-folders/poller.test.ts

key-decisions:
  - "Config errors in scanAll propagate (not swallowed) so callers can handle; per-folder errors are caught and logged"
  - "Single retry cap on always-empty check prevents infinite loops while still recovering transient issues"

patterns-established:
  - "Overlap guard: boolean processing flag with try/finally reset prevents concurrent async operations"
  - "Always-empty invariant: STATUS re-check after processing with single retry and warning on persistence"

requirements-completed: [MON-01, MON-02, FOLD-02, FOLD-03]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 20 Plan 01: ActionFolderPoller Summary

**Poll-based action folder monitoring with STATUS-check, overlap guard, always-empty invariant, and timer lifecycle**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-21T00:00:50Z
- **Completed:** 2026-04-21T00:05:17Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ActionFolderPoller class with scanAll() that STATUS-checks all 4 action folders and processes non-empty ones
- Overlap guard prevents concurrent scanAll calls with boolean flag and try/finally
- Always-empty invariant: STATUS re-check after processing, single retry, warning on persistent messages
- start()/stop() manage setInterval timer with .unref() for clean process exit
- 20 unit tests covering all behaviors (TDD red-green)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for ActionFolderPoller** - `9e4d514` (test)
2. **Task 2: Implement ActionFolderPoller to pass all tests** - `c4b282a` (feat)

## Files Created/Modified
- `src/action-folders/poller.ts` - ActionFolderPoller class with scanAll/start/stop
- `src/action-folders/index.ts` - Re-exports ActionFolderPoller and ActionFolderPollerDeps
- `test/unit/action-folders/poller.test.ts` - 20 unit tests for all poll behaviors

## Decisions Made
- Config-level errors (getActionFolderConfig throws) propagate out of scanAll rather than being swallowed - callers (the interval callback) already catch and log these
- Per-folder IMAP errors are caught within the loop so one folder failure doesn't block others
- Single retry cap on always-empty invariant prevents infinite loops while still recovering from race conditions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test mock ordering for sequential per-folder processing**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test mocks assumed all STATUS checks happen first, then re-checks. Actual implementation does initial check + re-check per folder sequentially.
- **Fix:** Reordered mock return values to match actual call sequence (initial -> re-check -> next folder)
- **Files modified:** test/unit/action-folders/poller.test.ts
- **Verification:** All 20 tests pass
- **Committed in:** c4b282a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test setup)
**Impact on plan:** Test mock ordering correction, no impact on implementation design.

## Issues Encountered
- Overlap guard tests with fake timers caused timeouts due to never-resolving promises interacting with vitest's timer mocking. Resolved by using real timers for those specific tests and collecting resolve callbacks for cleanup.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ActionFolderPoller ready for integration into application startup (plan 20-02)
- scanAll() is standalone and awaitable for startup pre-scan use case
- Full test coverage ensures safe refactoring

---
*Phase: 20-monitoring-startup-recovery*
*Completed: 2026-04-21*
