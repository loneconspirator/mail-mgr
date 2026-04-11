---
phase: 02-tree-picker
verified: 2026-04-07T21:53:30Z
status: human_needed
score: 9/9 must-haves verified
re_verification: false
human_verification:
  - test: "Visual rendering and interaction of folder picker in browser"
    expected: "Tree picker renders in rule editor modal, expand/collapse works, selection highlights, recent folders appear, picker hides/shows on action type change, save persists selection"
    why_human: "DOM rendering correctness, scroll behavior, visual highlight states, and UX flow cannot be verified programmatically. Human verification was performed per 02-02-SUMMARY.md (Task 3 human checkpoint), but no automated evidence of that approval was captured."
---

# Phase 2: Tree Picker Verification Report

**Phase Goal:** Visual folder selector replaces text input in rule editor
**Verified:** 2026-04-07T21:53:30Z
**Status:** human_needed (automated checks all pass; flagging one human verification item)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /api/activity/recent-folders returns an array of folder path strings ordered by most recently used | VERIFIED | `src/web/routes/activity.ts` line 32-36: route exists, calls `deps.activityLog.getRecentFolders(limit)`, returns result directly |
| 2 | ActivityLog.getRecentFolders() queries the activity table for distinct successful move destinations | VERIFIED | `src/log/index.ts` lines 137-146: method exists with correct SQL (`WHERE folder IS NOT NULL AND folder != '' AND success = 1`, `GROUP BY folder`, `ORDER BY MAX(id) DESC`, `LIMIT ?`) |
| 3 | Frontend api object exposes folders.list() and activity.recentFolders() methods | VERIFIED | `src/web/frontend/api.ts` lines 32-33 and 46-48: both methods exist and call correct URLs |
| 4 | Rule editor modal shows a tree picker instead of a text input for destination folder | VERIFIED | `src/web/frontend/app.ts` line 160: `<div id="m-folder-picker"></div>` replaces old `<input id="m-folder">` |
| 5 | Tree nodes with children show a disclosure toggle that expands/collapses their children | VERIFIED | `src/web/frontend/folder-picker.ts` lines 153-165: toggle span with `\u25BE`/`\u25B8`, click handler toggles `state.expanded` set and re-renders |
| 6 | Recently-used folders appear in a section above the full tree | VERIFIED | `src/web/frontend/folder-picker.ts` lines 121-132: "Recent" heading and section rendered before "All Folders" when `recentFolders.length > 0` |
| 7 | Clicking a folder in the tree selects it and the selected path is used in the rule save payload | VERIFIED | `src/web/frontend/app.ts` lines 183-185 and 205: `onSelect` updates `selectedFolder`, save handler reads `const folder = selectedFolder` |
| 8 | Currently-selected folder is auto-expanded and visually highlighted when editing an existing rule | VERIFIED | `src/web/frontend/folder-picker.ts` lines 84-86: `expandPathTo()` called on `state.selected` before render; `selected` CSS class applied at lines 126 and 150 |
| 9 | Picker shows loading state and error state with retry | VERIFIED | `src/web/frontend/folder-picker.ts` lines 52-53 (loading span) and lines 89-98 (error div with retry button) |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/log/index.ts` | getRecentFolders(limit) method on ActivityLog class | VERIFIED | Lines 137-146; correct SQL with all required clauses |
| `src/web/routes/activity.ts` | GET /api/activity/recent-folders endpoint | VERIFIED | Lines 32-36; limit clamped with `Math.min(Math.max(...))` |
| `src/web/frontend/api.ts` | folders.list() and activity.recentFolders() API methods | VERIFIED | Lines 32-33, 46-48; both methods wired to correct URLs; FolderTreeResponse imported and re-exported |
| `src/web/frontend/folder-picker.ts` | renderFolderPicker() function and tree rendering logic | VERIFIED | 197 lines; exports `renderFolderPicker`, `FolderPickerOptions`, `expandPathTo`, `clearFolderCache` |
| `src/web/frontend/app.ts` | Modified openRuleModal() that uses folder picker instead of text input | VERIFIED | Import at line 3, picker div at line 160, selectedFolder at 167, renderFolderPicker call at 182 |
| `src/web/frontend/styles.css` | CSS for folder picker component | VERIFIED | `.folder-picker`, `.tree-node`, `.tree-node.selected`, `.tree-toggle`, `max-height: 240px` all present |
| `test/unit/web/folder-picker.test.ts` | Unit tests for picker logic | VERIFIED | 11 tests covering expandPathTo (3 tests), renderFolderPicker (8 tests); all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/web/routes/activity.ts` | `src/log/index.ts` | `deps.activityLog.getRecentFolders()` | WIRED | Line 35: `return deps.activityLog.getRecentFolders(limit)` |
| `src/web/frontend/api.ts` | `/api/activity/recent-folders` | fetch request | WIRED | Line 32: `request<string[]>('/api/activity/recent-folders?limit=${limit}')` |
| `src/web/frontend/api.ts` | `/api/folders` | fetch request | WIRED | Line 47: `request<FolderTreeResponse>('/api/folders')` |
| `src/web/frontend/app.ts` | `src/web/frontend/folder-picker.ts` | `import { renderFolderPicker }` | WIRED | Line 3: `import { renderFolderPicker } from './folder-picker.js'`; called at line 182 |
| `src/web/frontend/folder-picker.ts` | `src/web/frontend/api.ts` | `api.folders.list()` and `api.activity.recentFolders()` | WIRED | Lines 74-77: `Promise.all([api.folders.list(), api.activity.recentFolders()])` |
| `src/web/frontend/app.ts` | rule save handler | `selectedFolder` variable captures picker selection | WIRED | Line 167: `let selectedFolder = ...`; line 185: `onSelect: (path) => { selectedFolder = path; }`; line 205: `const folder = selectedFolder` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PICK-01 | 02-02 | Tree picker component replaces text input for folder selection in rule editor | SATISFIED | Text input removed from openRuleModal(); `<div id="m-folder-picker">` renders the picker component |
| PICK-02 | 02-02 | Tree supports expand/collapse for nested folder hierarchy | SATISFIED | Toggle span in renderTreeNode(); state.expanded Set tracks open nodes; re-render on toggle |
| PICK-03 | 02-01, 02-02 | Recently-used folders surfaced at top of picker (derived from activity log) | SATISFIED | ActivityLog.getRecentFolders() + GET /api/activity/recent-folders + "Recent" section rendered above "All Folders" |

All three requirement IDs are mapped to Phase 2 in REQUIREMENTS.md traceability table. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/web/frontend/folder-picker.ts` | 39 | `(el as any)[k] = v` | Info | Necessary for DOM property assignment; same pattern used in app.ts; not a stub |

No blockers or meaningful warnings found. The `(el as any)` pattern is a deliberate TypeScript bypass in the h() DOM helper, consistent with the same helper in app.ts.

### Human Verification Required

#### 1. Browser Smoke Test

**Test:** Start the app, open the web UI, navigate to Rules, click "New Rule", select "Archive to folder" action type.
**Expected:** Folder picker renders with a scrollable tree of IMAP folders. Disclosure triangles expand/collapse nested folders. Clicking a folder highlights it. Switching action type away and back preserves the selection. Saving the rule persists the picker-selected folder path.
**Why human:** DOM rendering, CSS visual states (hover, selection highlight, scroll containment), and UX flow correctness cannot be verified programmatically. The SUMMARY documents that human verification (Task 3) was completed and bugfixes applied in commit `da609fb`, but no structured approval record was captured.

### Gaps Summary

None. All automated checks pass. The human_needed flag is raised only because the plan explicitly included a `checkpoint:human-verify` gate (Plan 02-02, Task 3) and the SUMMARY confirms it was executed, but this verification run cannot independently confirm the browser test was approved. If the user confirms Task 3 was approved, status can be upgraded to passed.

---

_Verified: 2026-04-07T21:53:30Z_
_Verifier: Claude (gsd-verifier)_
