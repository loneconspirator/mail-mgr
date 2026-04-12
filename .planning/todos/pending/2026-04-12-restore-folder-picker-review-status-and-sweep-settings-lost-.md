---
created: "2026-04-12T18:30:15.692Z"
title: Restore folder picker, review status, and sweep settings lost in Phase 7 clobber
area: ui
files:
  - src/web/frontend/folder-picker.ts
  - src/web/frontend/app.ts
  - src/web/frontend/api.ts
  - src/web/routes/review-config.ts
  - test/unit/web/folder-picker.test.ts
---

## Problem

Same clobber commit `f453be7` (Phase 07-01) that wiped the Batch UI also destroyed several other features:

**Deleted files:**
- `src/web/frontend/folder-picker.ts` — entire folder picker component (tree rendering, search, recent folders)
- `src/web/routes/review-config.ts` — review config API route
- `test/unit/web/folder-picker.test.ts` — folder picker tests

**Removed from `app.ts`:**
- Folder picker integration in rule editor modal (replaced `renderFolderPicker()` call with plain text input)
- Review status card in settings (review folder stats, next sweep time, last sweep summary)
- Sweep settings card (editable sweep config per D-01, D-02)
- Sweep/batch activity badges (`badge-sweep`, `badge-batch` for sourced entries)
- `ReviewConfig` import and `api.review.status()` / `api.config.getReview()` / `api.config.updateReview()` calls

**Removed from `api.ts`:**
- `ReviewConfig`, `ReviewStatusResponse`, `FolderTreeResponse` type exports
- `review` API namespace (`status`, `getReview`, `updateReview`)
- `folders.tree()` endpoint call (used by folder picker)

**Last known good state:** `f453be7^` (parent of the clobber commit).

## Solution

1. Restore deleted files from `git show f453be7^:path`
2. Re-integrate folder picker into rule editor modal (currently uses plain `<input>`)
3. Restore review status and sweep settings cards in `renderSettings()`
4. Restore missing API client methods and type exports in `api.ts`
5. Restore activity badge logic for sweep/batch sourced entries
6. Adapt restored code for Phase 08 changes (new match fields, action types, envelope discovery)
7. Build and run tests

Note: This todo is related to but separate from the Batch UI restore todo — they share the same root cause (f453be7 clobber) but cover different feature areas.
