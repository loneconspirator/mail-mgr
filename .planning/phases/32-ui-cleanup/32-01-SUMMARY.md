---
phase: 32-ui-cleanup
plan: 01
subsystem: ui
tags: [fastify, imap, folder-rename, settings-page, dead-code-removal]

# Dependency graph
requires:
  - phase: 31-sentinel-healer
    provides: "Automatic folder rename healing via sentinel messages"
provides:
  - "Clean settings page without manual folder rename card"
  - "Reduced API surface (POST /api/folders/rename removed)"
  - "Trimmed CSS without rename-related classes"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Subtractive cleanup after feature supersession"]

key-files:
  created: []
  modified:
    - src/web/routes/folders.ts
    - src/web/frontend/app.ts
    - src/web/frontend/api.ts
    - src/web/frontend/styles.css

key-decisions:
  - "Hard-deleted rename endpoint entirely (no deprecation period) per D-01"
  - "Kept low-level IMAP renameFolder() primitive in cache.ts per D-03"

patterns-established:
  - "Subtractive cleanup: remove superseded UI/API code when automation replaces manual features"

requirements-completed: [UI-01, UI-02]

# Metrics
duration: 3min
completed: 2026-04-22
---

# Phase 32 Plan 01: Remove Folder Rename Feature Summary

**Removed manual folder rename UI card, API endpoint, and CSS -- ~400 lines of dead code eliminated after sentinel auto-healing made it unnecessary**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-22T19:51:52Z
- **Completed:** 2026-04-22T19:55:14Z
- **Tasks:** 2
- **Files modified:** 4 modified, 1 deleted

## Accomplishments
- Deleted POST /api/folders/rename endpoint and findNode helper from folders.ts
- Removed ~180-line renderFolderRenameCard function from app.ts frontend
- Removed api.folders.rename client method from api.ts
- Deleted 5 rename-related CSS classes from styles.css
- Deleted test/unit/web/folders-rename.test.ts (tested removed endpoint)
- TypeScript compiles clean, all tests pass (except pre-existing frontend.test.ts failures unrelated to this change)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove folder rename API endpoint and test file** - `07d2484` (feat)
2. **Task 2: Remove folder rename UI card, API client method, and CSS** - `a3e687f` (feat)

## Files Created/Modified
- `src/web/routes/folders.ts` - Trimmed to GET /api/folders only (removed POST /rename and findNode helper)
- `src/web/frontend/app.ts` - Removed renderFolderRenameCard function and clearFolderCache import
- `src/web/frontend/api.ts` - Removed api.folders.rename method
- `src/web/frontend/styles.css` - Removed .rename-section, .field-error, .folder-selected, .rename-disabled-hint, .rename-warning
- `test/unit/web/folders-rename.test.ts` - Deleted (tested removed endpoint)

## Decisions Made
- Hard-deleted rename endpoint with no deprecation (per D-01) since sentinel auto-healing fully replaces manual renames
- Kept IMAP-level renameFolder() primitive in cache.ts untouched (per D-03) as it may be needed by sentinel healer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing test failures in test/unit/web/frontend.test.ts (7 tests failing due to /app.js returning 404). Confirmed these failures exist on the base commit before any changes. Not caused by this plan's modifications.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Settings page is cleaner with reduced maintenance surface
- No blockers for future phases

---
*Phase: 32-ui-cleanup*
*Completed: 2026-04-22*
