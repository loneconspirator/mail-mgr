---
phase: quick
plan: 01
subsystem: batch
tags: [batch-engine, imap, config-reload]

provides:
  - BatchEngine rebuild on review config change
  - Consistent resolved trash folder usage across all config change handlers
affects: [batch, sweep, config]

tech-stack:
  added: []
  patterns: [config-change-rebuild]

key-files:
  created: []
  modified: [src/index.ts]

key-decisions:
  - "BatchEngine rebuild placed after sweeper.start() for natural read order"
  - "No stop/start lifecycle needed for BatchEngine — just reassign"

patterns-established: []

requirements-completed: []

duration: 3min
completed: 2026-04-11
---

# Quick Task 260411-fmv: Rebuild BatchEngine on Review Config Change Summary

**BatchEngine now rebuilds with fresh reviewConfig, reviewFolder, and resolved trashFolder when review config changes; onImapConfigChange also fixed to use resolved trash folder**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-11T18:17:45Z
- **Completed:** 2026-04-11T18:20:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- BatchEngine is rebuilt in onReviewConfigChange with updated config values and resolved trash folder
- Fixed onImapConfigChange to use resolved `newTrash` for BatchEngine instead of raw config value
- All 347 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Rebuild BatchEngine in onReviewConfigChange handler** - `c0c918d` (fix)

## Files Created/Modified
- `src/index.ts` - Added BatchEngine rebuild in onReviewConfigChange; fixed trashFolder in onImapConfigChange

## Decisions Made
- BatchEngine rebuild placed after `sweeper.start()` for natural read order (stop old sweeper, resolve trash, rebuild sweeper, start sweeper, rebuild batchEngine)
- No stop/start lifecycle needed — BatchEngine runs on-demand, so simple reassignment is sufficient

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config change handlers are now consistent: both onReviewConfigChange and onImapConfigChange rebuild all stateful components (monitor, sweeper, batchEngine)
- No blockers
