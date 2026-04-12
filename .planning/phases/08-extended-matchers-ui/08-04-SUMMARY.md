---
phase: 08-extended-matchers-ui
plan: 04
subsystem: ui
tags: [frontend, rule-editor, imap-discovery, action-types]

requires:
  - phase: 08-extended-matchers-ui
    provides: "Extended matcher UI fields (plans 01-03)"
provides:
  - "Rule editor supports all four action types (move, review, skip, delete)"
  - "Conditional folder field visibility based on action type"
  - "Discovery POST works without Content-Type on bodiless requests"
affects: []

tech-stack:
  added: []
  patterns:
    - "Dynamic action payload construction based on select value"
    - "Conditional Content-Type header in shared fetch wrapper"

key-files:
  created: []
  modified:
    - src/web/frontend/app.ts
    - src/web/frontend/api.ts

key-decisions:
  - "Used Record<string, string> for dynamic action payload to avoid complex union type in frontend"
  - "Folder group visibility toggled via display style rather than DOM removal"

patterns-established:
  - "Show/hide form groups based on select value with change listener + initial fire"

requirements-completed: [UI-01, UI-03]

duration: 1min
completed: 2026-04-12
---

# Phase 08 Plan 04: Gap Closure Summary

**Rule editor supports all action types with conditional folder field, and discovery POST no longer sends bad Content-Type**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-12T18:18:11Z
- **Completed:** 2026-04-12T18:19:21Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Rule editor action dropdown now shows Move, Review, Skip, and Delete options with pre-selection on edit
- Folder field hidden for Skip/Delete actions, required only for Move, optional for Review
- Name field no longer required (was incorrectly mandatory)
- Save handler builds correct discriminated action payload per type
- Discovery POST no longer sends Content-Type: application/json on bodiless requests

## Task Commits

Each task was committed atomically (combined into single commit since both are small fixes):

1. **Task 1 + Task 2: Rule editor fixes and discovery POST fix** - `783aab7` (fix)

## Files Created/Modified
- `src/web/frontend/app.ts` - Rule editor modal: all action types, conditional folder, dynamic payload
- `src/web/frontend/api.ts` - request() only sets Content-Type when body exists

## Decisions Made
- Combined both tasks into a single atomic commit since they are small related UI fixes
- Used Record<string, string> for action payload to keep frontend types simple (backend validates via Zod)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All UAT gaps from Phase 08 verification are now closed
- Rule editor fully functional for all action types
- Discovery re-run button works correctly

---
*Phase: 08-extended-matchers-ui*
*Completed: 2026-04-12*
