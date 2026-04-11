---
phase: 01-folder-discovery
plan: 02
subsystem: api
tags: [fastify, folder-validation, warnings, rules-api]

# Dependency graph
requires:
  - phase: 01-folder-discovery
    plan: 01
    provides: "FolderCache.hasFolder() method, getFolderCache in ServerDeps"
provides:
  - "Non-blocking folder validation warnings on POST/PUT /api/rules"
  - "checkFolderWarnings helper in rules route"
affects: [02-tree-picker, frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Non-blocking validation warnings pattern: save succeeds, warnings returned alongside"]

key-files:
  created: []
  modified:
    - src/web/routes/rules.ts
    - test/unit/web/api.test.ts

key-decisions:
  - "Warnings returned inline with rule response (not separate endpoint) for simplicity"
  - "Empty folder cache returns false from hasFolder, producing warnings -- acceptable since cache populates on first IMAP connect"

patterns-established:
  - "Warning pattern: spread rule into response with optional warnings array only when non-empty"

requirements-completed: [FOLD-03]

# Metrics
duration: 2min
completed: 2026-04-07
---

# Phase 1 Plan 2: Folder Validation Warnings Summary

**Non-blocking folder validation warnings on rule save endpoints using FolderCache.hasFolder() lookup**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-07T02:29:18Z
- **Completed:** 2026-04-07T02:31:06Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- POST /api/rules returns optional `warnings` array when move/review destination folder not found in cache
- PUT /api/rules/:id returns optional `warnings` array for nonexistent destination folders
- Rules save successfully regardless of warnings (non-blocking validation)
- 7 new tests covering all warning scenarios (nonexistent folder, existing folder, skip action, review action, persistence verification, empty cache)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for folder validation warnings** - `5405675` (test)
2. **Task 1 (GREEN): Implement folder validation warnings** - `dd293f0` (feat)

_TDD task: test committed first (RED), then implementation (GREEN). No refactor needed._

## Files Created/Modified
- `src/web/routes/rules.ts` - Added `checkFolderWarnings` helper, updated POST and PUT handlers to include warnings
- `test/unit/web/api.test.ts` - Added mockFolderCache to deps, added 7 tests in "Folder validation warnings" describe block

## Decisions Made
- Warnings returned inline with rule response object rather than a separate validation endpoint -- simpler for the frontend to consume
- When folder cache has no tree data (hasFolder returns false for everything), warnings will fire -- acceptable tradeoff since cache populates on first IMAP connect and empty cache is a transient startup state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Folder validation warnings are wired up and tested
- Frontend can now display warnings when editing rules with nonexistent destination folders
- Ready for tree picker UI integration (Phase 2)

## Self-Check: PASSED

All files exist, all commits verified, all acceptance criteria met.

---
*Phase: 01-folder-discovery*
*Completed: 2026-04-07*
