---
phase: 03-batch-filing-engine
plan: 03
subsystem: batch-frontend
tags: [batch, frontend, spa, workflow-ui, css]
dependency_graph:
  requires: [batch-api-routes, batch-shared-types, folder-picker]
  provides: [batch-page-ui, batch-nav-integration, batch-activity-badge]
  affects: [app.ts, api.ts, index.html, styles.css]
tech_stack:
  added: []
  patterns: [state-machine-ui, dom-polling, xss-safe-rendering, collapsible-groups]
key_files:
  created: []
  modified:
    - src/web/frontend/app.ts
    - src/web/frontend/api.ts
    - src/web/frontend/index.html
    - src/web/frontend/styles.css
decisions:
  - No-match group identified by action=skip and empty destination, rendered last with muted styling
  - Progress polling uses in-place DOM updates (no full re-render) for smooth UX during batch execution
  - All user-supplied content (from, subject, folder names) uses textContent/createTextNode for XSS prevention
metrics:
  duration: 183s
  completed: "2026-04-08T19:01:28Z"
  tasks_completed: 2
  tasks_total: 3
  test_count: 318
  files_created: 0
  files_modified: 4
---

# Phase 03 Plan 03: Batch Filing Frontend Summary

Complete batch filing SPA page with multi-step workflow state machine: folder selection via tree picker, dry-run preview with grouped expandable results, execution with live progress bar polling, cancel support, and results summary with stats grid.

## What Was Built

### Batch API Client (`src/web/frontend/api.ts`)

Added `batch` namespace to the api object with four methods:
- `dryRun(sourceFolder)` - POST to `/api/batch/dry-run`
- `execute(sourceFolder)` - POST to `/api/batch/execute`
- `cancel()` - POST to `/api/batch/cancel`
- `status()` - GET `/api/batch/status`

Added type imports and re-exports for `BatchStatusResponse`, `DryRunResponse`, `DryRunGroup`.

### Nav Integration (`src/web/frontend/index.html`, `src/web/frontend/app.ts`)

- Added "Batch" nav button with `data-page="batch"`
- Added `batchPollTimer` state variable with cleanup in `clearApp()`
- Added batch page routing in `navigate()` function

### Batch Workflow State Machine (`src/web/frontend/app.ts`)

**renderBatch()** - Entry point that checks server state on mount:
- `executing` -> shows progress view
- `previewing` with results -> shows preview
- `completed`/`cancelled`/`error` -> shows results
- Otherwise -> shows idle folder selector

**renderBatchIdle()** - Source folder selection:
- Renders folder picker via `renderFolderPicker()`
- "Preview Dry Run" button, disabled until folder selected
- Checks if batch already running and shows info text

**startDryRun()** - Loading state with pulse animation, calls API, handles errors with toast

**renderBatchPreview()** - Grouped dry-run results:
- Summary line with matched/total counts
- Collapsible groups with toggle triangles (Unicode arrows)
- Expandable message tables (From, Subject, Rule columns)
- No-match group rendered last with muted styling
- Action bar: Back button + Run Batch button

**renderBatchExecuting()** - Live progress:
- Progress bar with percentage-width fill
- Inline counts (Moved/Skipped/Errors) with red error highlighting
- Cancel button that disables and shows "Cancelling..."
- 2-second polling interval with in-place DOM updates

**renderBatchResults()** - Completion summary:
- Status-specific heading with color-coded badge (green/yellow/red)
- Stats grid reusing `.review-stats` layout
- Remaining count shown on cancellation
- "New Batch" button to restart workflow

### Activity Badge (`src/web/frontend/app.ts`)

Activity log entries with `source='batch'` display an amber `[batch]` badge, parallel to existing `[sweep]` badge pattern.

### CSS Classes (`src/web/frontend/styles.css`)

All classes from UI-SPEC added verbatim:
- `.progress-bar` / `.progress-bar-fill` - batch execution progress
- `.dry-run-group` / `.dry-run-group-header` / `.dry-run-group-messages` - collapsible preview groups
- `.badge-batch` - amber activity badge
- `.batch-counts` / `.error-count` - inline execution stats
- `.loading-pulse` with `@keyframes pulse` - dry-run loading animation
- `.btn:disabled` / `.btn[disabled]` - disabled button state

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| f25b4b6 | feat | Add batch API client, nav wiring, and activity badge |
| a71f703 | feat | Implement full batch workflow UI with CSS |

## Task 3: Pending

Task 3 (checkpoint:human-verify) is pending: human verification required. This task validates the complete batch filing workflow end-to-end in browser.

## Deviations from Plan

None - plan executed exactly as written.

## Known Pre-existing Issues

- `test/unit/web/frontend.test.ts` has 4 failing tests (pre-existing, missing `getFolderCache` and `getBatchEngine` in mock deps). Not caused by this plan's changes.

## Known Stubs

None. All render functions are fully implemented with real API calls and DOM rendering.

## Self-Check: PASSED
