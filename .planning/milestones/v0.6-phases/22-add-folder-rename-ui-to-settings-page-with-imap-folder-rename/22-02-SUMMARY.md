---
phase: 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename
plan: "02"
title: "Folder Management Settings Card UI"
one_liner: "Settings card with tree picker folder selection, inline rename field, INBOX/Actions blocking, special-use warnings, and toast feedback"
completed: 2026-04-21T02:15:26Z
duration_seconds: 119
tasks_completed: 2
tasks_total: 2
key_files:
  created: []
  modified:
    - src/web/frontend/styles.css
    - src/web/frontend/app.ts
decisions:
  - "Used existing boolean toast(msg, isError) signature instead of plan's string-based toast(msg, type) to match codebase conventions"
  - "Constructed full newPath from parent segments + new name for api.folders.rename() which expects full paths"
  - "CSS file located at src/web/frontend/styles.css not src/web/public/styles.css as plan specified"
tags: [frontend, ui, folder-rename, settings]
requirements: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08]
---

# Phase 22 Plan 02: Folder Management Settings Card UI Summary

Settings card with tree picker folder selection, inline rename field, INBOX/Actions blocking, special-use warnings, and toast feedback.

## What Was Done

### Task 1: Add CSS and build Folder Management settings card
- Added CSS classes to `src/web/frontend/styles.css`: `.rename-section`, `.field-error`, `.folder-selected`, `.rename-disabled-hint`, `.rename-warning`
- Added `renderFolderRenameCard()` async function to `src/web/frontend/app.ts`
- Imported `clearFolderCache` from folder-picker module
- Card includes tree picker for folder selection with `onSelect` callback
- INBOX shows "INBOX cannot be renamed" disabled message
- Actions/ prefix folders show "System folders cannot be renamed" disabled message
- Special-use folders (Sent, Drafts, Trash, Junk, Archive) show yellow warning
- Inline editable name field pre-filled with leaf folder name
- Client-side validation: empty name, unchanged name, path separator characters
- Rename button calls `api.folders.rename(oldPath, newPath)` with constructed full path
- Collision errors (409 "already exists") shown inline via field-error div
- Other errors shown via toast
- `clearFolderCache()` called and tree re-rendered on both success and failure
- "Keep Current Name" cancel button hides rename section
- Called from `renderSettings()` after sweep settings card

### Task 2: Verify folder rename UI end-to-end
- Auto-approved in auto mode

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 77a9ad2 | feat(22-02): add Folder Management settings card with rename UI |

## Deviations from Plan

### Adapted to Codebase Patterns

**1. [Rule 3 - Blocking] CSS file path correction**
- **Found during:** Task 1
- **Issue:** Plan referenced `src/web/public/styles.css` but actual file is `src/web/frontend/styles.css`
- **Fix:** Used correct path
- **Files modified:** src/web/frontend/styles.css

**2. [Rule 1 - Bug] Toast function signature mismatch**
- **Found during:** Task 1
- **Issue:** Plan used `toast(msg, 'success')` string-based API but existing `toast()` uses `isError` boolean
- **Fix:** Used `toast(msg)` for success and `toast(msg, true)` for errors
- **Files modified:** src/web/frontend/app.ts

**3. [Rule 1 - Bug] Full path construction for rename API**
- **Found during:** Task 1
- **Issue:** Plan called `api.folders.rename(selectedPath, newName)` but API expects full paths for both arguments
- **Fix:** Constructed `newPath` from parent path segments + delimiter + new name
- **Files modified:** src/web/frontend/app.ts

## Verification

- `npm run build` exits 0
- `npx vitest run` passes all 584 tests (37 test files)
- All acceptance criteria strings found in modified files

## Self-Check: PASSED
