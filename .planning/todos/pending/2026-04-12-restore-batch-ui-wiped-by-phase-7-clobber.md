---
created: "2026-04-12T18:28:31.880Z"
title: Restore batch UI wiped by Phase 7 clobber
area: ui
files:
  - src/web/frontend/app.ts
  - src/web/frontend/index.html
  - src/web/frontend/api.ts
---

## Problem

Commit `f453be7` (Phase 07-01, `feat(07-01): extend emailMatchSchema with deliveredTo, visibility, readStatus`) replaced the entire contents of `src/web/frontend/app.ts`, reducing it from ~825 lines to ~325. This wiped out:

- The entire Batch page (`renderBatch`, `renderBatchExecuting`, `renderBatchPreview` — ~370 lines added in Phase 03-03 commits `a71f703` and `f25b4b6`)
- Batch nav wiring (`else if (page === 'batch') renderBatch()` in `navigate()`)
- Batch poll timer (`batchPollTimer` state variable and cleanup in `clearApp()`)
- Batch-related activity badges (`badge-batch` for sourced entries)
- Batch API client imports (`BatchStatusResponse`, `DryRunGroup` types from `api.ts`)
- The `<button class="nav-btn" data-page="batch">Batch</button>` nav button in `index.html`

The "restore" commit `c7ea8c7` only fixed minor issues (`rule.name ?? ''`) and did not detect or restore the missing Batch functionality.

**Last known good state:** `f453be7^` (parent of the clobber commit) contains the full Batch UI.

## Solution

1. Extract the Batch-related code from `git show f453be7^:src/web/frontend/app.ts` — the `renderBatch`, `renderBatchExecuting`, `renderBatchPreview` functions, poll timer, nav wiring, and activity badge logic.
2. Re-integrate into current `app.ts`, adapting for any Phase 08 changes (new match fields, action types).
3. Restore the Batch nav button in `index.html`.
4. Verify batch API types still exist in `api.ts` (imports for `BatchStatusResponse`, `DryRunGroup`).
5. Verify the batch API routes still exist in `src/web/routes/`.
6. Build and test.
