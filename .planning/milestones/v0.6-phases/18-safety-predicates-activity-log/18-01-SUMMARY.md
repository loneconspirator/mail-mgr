---
phase: 18-safety-predicates-activity-log
plan: 01
subsystem: database
tags: [sqlite, activity-log, move-tracking, action-folders]

requires:
  - phase: 10-move-tracking
    provides: "isSystemMove and activity log source column"
provides:
  - "logActivity accepts 'action-folder' as valid source parameter"
  - "isSystemMove recognizes action-folder entries as system moves"
affects: [19-action-folder-processor, move-tracking]

tech-stack:
  added: []
  patterns: ["source union type extension for new system move origins"]

key-files:
  created: []
  modified:
    - src/log/index.ts
    - test/unit/log/activity.test.ts

key-decisions:
  - "Extended existing source union type rather than adding separate flag -- keeps IN clause as single point of system-move detection"

patterns-established:
  - "Source union extension: add new system-initiated move sources to both the type union and the IN clause"

requirements-completed: [LOG-01, LOG-02]

duration: 1min
completed: 2026-04-20
---

# Phase 18 Plan 01: Activity Log Action-Folder Source Summary

**Extended logActivity source union and isSystemMove IN clause to recognize action-folder operations as system moves**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-20T22:25:39Z
- **Completed:** 2026-04-20T22:27:04Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- logActivity now accepts 'action-folder' as a fourth source value alongside arrival/sweep/batch
- isSystemMove SQL IN clause includes 'action-folder' so MoveTracker excludes action-folder moves from user-move detection
- 5 new tests covering source storage, rule metadata, and isSystemMove behavior

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing tests for action-folder source** - `dd29d1c` (test)
2. **Task 1 GREEN: Extend logActivity and isSystemMove** - `35744dc` (feat)

_TDD task: test commit followed by implementation commit_

## Files Created/Modified
- `src/log/index.ts` - Extended source union type on logActivity, added 'action-folder' to isSystemMove IN clause
- `test/unit/log/activity.test.ts` - Added 'action-folder source' describe block with 5 tests

## Decisions Made
- Extended existing source union type rather than adding a separate boolean flag -- keeps the IN clause as the single point of system-move detection per D-01

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test timestamps for isSystemMove time-window checks**
- **Found during:** Task 1 GREEN phase
- **Issue:** makeResult() default timestamp (2026-02-24) falls outside isSystemMove's 1-day window, causing false negatives
- **Fix:** Passed `{ timestamp: new Date() }` to makeResult() in isSystemMove tests
- **Files modified:** test/unit/log/activity.test.ts
- **Verification:** All 20 tests pass
- **Committed in:** 35744dc (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test fix necessary for correctness. No scope creep.

## Issues Encountered
- Pre-existing failures in test/unit/web/frontend.test.ts (7 tests) -- unrelated to this plan, not addressed

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Activity log ready for action-folder processor (Phase 19) to log operations with source='action-folder'
- MoveTracker will correctly exclude action-folder moves from user-initiated move detection

---
*Phase: 18-safety-predicates-activity-log*
*Completed: 2026-04-20*
