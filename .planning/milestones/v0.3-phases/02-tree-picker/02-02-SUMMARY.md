---
phase: 02-tree-picker
plan: 02
subsystem: ui
tags: [dom, tree-picker, imap-folders, esbuild, jsdom]

requires:
  - phase: 02-tree-picker/01
    provides: api.folders.list() and api.activity.recentFolders() frontend API methods
  - phase: 01-folder-discovery
    provides: GET /api/folders endpoint returning FolderNode tree
provides:
  - Interactive folder picker component replacing text input in rule editor modal
  - Tree navigation with expand/collapse disclosure toggles
  - Recently-used folders section from activity log
  - Selection state with visual highlighting
  - Loading and error+retry states
affects: [batch-filing, config-cleanup]

tech-stack:
  added: [jsdom (devDependency for DOM unit tests)]
  patterns: [DOM component with h() helper, module-level cache with TTL, scroll position preservation on re-render]

key-files:
  created:
    - src/web/frontend/folder-picker.ts
    - test/unit/web/folder-picker.test.ts
  modified:
    - src/web/frontend/app.ts
    - src/web/frontend/styles.css

key-decisions:
  - "Duplicated h() DOM helper in folder-picker.ts rather than extracting shared module — keeps module self-contained"
  - "Folder tree cached 60s, recent folders always fetched fresh — tree is expensive IMAP call, recents are cheap SQLite query"
  - "Scroll position saved/restored on re-render to prevent jump-to-top on expand/collapse"

patterns-established:
  - "DOM component pattern: exported renderX(opts) function, internal state object, re-render via full rebuild with scroll preservation"
  - "Frontend caching: module-level variables with TTL check, selective cache (expensive data cached, cheap data fetched fresh)"

requirements-completed: [PICK-01, PICK-02, PICK-03]

duration: 15min
completed: 2026-04-07
---

# Plan 02-02: Folder Picker Component Summary

**Interactive tree picker with expand/collapse, recent folders, and selection state replacing text input in rule editor modal**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (2 automated + 1 human verification)
- **Files modified:** 4
- **Files created:** 2

## Accomplishments
- Folder picker component with full tree navigation and disclosure toggles
- Recently-used folders section above tree for quick access
- Selection state with blue highlight, persists across action type toggles
- Loading state, error state with retry button
- Auto-expand to currently selected folder when editing existing rules
- 11 unit tests for picker logic using jsdom environment
- CSS styles for tree nodes, hover, selection, headings, scroll containment

## Task Commits

1. **Task 1: Create folder-picker.ts component** - `bdf53ca` (feat)
2. **Task 2: Integrate picker into modal + CSS** - `c6d05c7` (feat)
3. **Task 3: Human browser verification** - verified by user, bugfixes in `da609fb`

## Files Created/Modified
- `src/web/frontend/folder-picker.ts` - Tree picker component with renderFolderPicker(), expand/collapse, recent folders, caching
- `src/web/frontend/app.ts` - Modified openRuleModal() to use picker instead of text input
- `src/web/frontend/styles.css` - CSS for .folder-picker, .tree-node, .tree-toggle, selection states
- `test/unit/web/folder-picker.test.ts` - 11 unit tests for picker rendering, selection, expand/collapse, error state

## Decisions Made
- Duplicated h() helper locally rather than extracting to shared module (simpler, h() is only 10 lines)
- Cache folder tree but always fetch fresh recents (folder tree is expensive IMAP call, recents are cheap)
- Added jsdom as devDependency for DOM-based unit tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Blocking] Modal crash on open — detached DOM node**
- **Found during:** Task 3 (human verification)
- **Issue:** document.getElementById() calls for modal elements ran before modal was appended to DOM body, causing null reference crash
- **Fix:** Moved overlay.append(modal) + document.body.append(overlay) before getElementById calls
- **Files modified:** src/web/frontend/app.ts
- **Verification:** Modal opens without errors
- **Committed in:** da609fb

**2. [UX] Scroll position lost on expand/collapse**
- **Found during:** Task 3 (human verification)
- **Issue:** renderPickerContent() cleared innerHTML destroying scroll state, causing jump-to-top on every toggle
- **Fix:** Save scrollTop before re-render, restore after append
- **Files modified:** src/web/frontend/folder-picker.ts
- **Verification:** Expand/collapse preserves scroll position
- **Committed in:** da609fb

**3. [UX] Recent folders showing stale data**
- **Found during:** Task 3 (human verification)
- **Issue:** Recent folders were cached alongside folder tree with 60s TTL, never refreshing
- **Fix:** Always fetch recent folders fresh (cheap query), only cache folder tree
- **Files modified:** src/web/frontend/folder-picker.ts
- **Verification:** New rule actions appear in recents on next picker open
- **Committed in:** da609fb

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 UX)
**Impact on plan:** All fixes necessary for correct functionality. No scope creep.

## Issues Encountered
- jsdom devDependency was added in worktree but not installed in main working tree — required npm install after merge

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Folder picker complete, all PICK-xx requirements satisfied
- Ready for Phase 3 (batch filing) which will reuse the folder picker for batch source/destination selection

---
*Phase: 02-tree-picker*
*Completed: 2026-04-07*
