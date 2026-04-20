---
phase: 10-move-tracking
plan: 04
subsystem: tracking
tags: [sqlite, imap, move-tracking, deep-scan, migrations]

requires:
  - phase: 10-move-tracking/02
    provides: MoveTracker core engine and SignalStore
  - phase: 10-move-tracking/03
    provides: Application lifecycle integration wiring

provides:
  - Runtime-functional move_signals table creation via runMigrations
  - Deep-scan resolved messages logged as signals instead of silently dropped
  - IMAP client disconnected on config reload preventing connection leaks
  - Signal prune interval uses .unref() for clean process shutdown

affects: []

tech-stack:
  added: []
  patterns:
    - "pendingDeepScanMeta map separates deep-scan metadata from pendingConfirmation"
    - ".unref() on non-critical intervals for clean shutdown"

key-files:
  created: []
  modified:
    - src/log/index.ts
    - src/tracking/index.ts
    - src/index.ts
    - test/unit/tracking/tracker.test.ts

key-decisions:
  - "Used separate pendingDeepScanMeta map rather than reusing pendingConfirmation for deep-scan metadata"

patterns-established:
  - "runMigrations called in ActivityLog constructor ensures all migration-based tables exist at runtime"

requirements-completed: [LEARN-01, LEARN-02]

duration: 3min
completed: 2026-04-13
---

# Phase 10 Plan 04: Gap Closure Summary

**Fixed 5 runtime bugs: move_signals table creation, deep-scan signal drop, IMAP connection leak, unmanaged interval, unnecessary optional chaining**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-13T01:47:56Z
- **Completed:** 2026-04-13T01:51:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- move_signals table now created at runtime when ActivityLog constructs (CR-01)
- Deep-scan resolved messages produce logged signals via pendingDeepScanMeta map (CR-02)
- Old IMAP client disconnected on config reload preventing connection leaks (WR-01)
- Signal prune interval uses .unref() for clean Node.js process exit (WR-02)
- Removed unnecessary optional chaining where Zod defaults guarantee presence (IN-01)
- Added test proving deep-scan signal logging works end-to-end

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire runMigrations into ActivityLog and fix deep-scan signal drop** - `dc501b0` (fix)
2. **Task 2: Fix connection leak and unmanaged interval in main entry** - `febe7a3` (fix)

## Files Created/Modified
- `src/log/index.ts` - Added runMigrations import and call in constructor
- `src/tracking/index.ts` - Added pendingDeepScanMeta map, rewired runDeepScan and countPendingDeepScan
- `src/index.ts` - let imapClient, disconnect on reload, .unref() on interval, direct property access
- `test/unit/tracking/tracker.test.ts` - New test for deep-scan signal logging (CR-02 verification)

## Decisions Made
- Used separate pendingDeepScanMeta map rather than reusing pendingConfirmation for deep-scan metadata -- keeps concerns separated and avoids key format mismatch (pendingConfirmation keys are folder:uid, deep scan needs messageId)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Deep-scan test initially failed because tracker.start() was needed to register the deep scan timer before advanceTimersByTimeAsync could trigger it. Fixed by calling start() and draining the initial scan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Move tracking is fully functional at runtime -- all 5 gap closure items resolved
- 214 tests passing, build succeeds
- Ready for pattern detection phase (statistical analysis on logged signals)

---
*Phase: 10-move-tracking*
*Completed: 2026-04-13*
