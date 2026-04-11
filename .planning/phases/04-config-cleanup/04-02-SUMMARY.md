---
phase: 04-config-cleanup
plan: 02
subsystem: web-ui, monitor, sweep
tags: [sweep-settings, cursor-toggle, stale-sweeper, tree-picker, frontend]
dependency_graph:
  requires: [04-01]
  provides: [editable-sweep-settings, cursor-toggle, stale-sweeper-fix]
  affects: [src/web/frontend/app.ts, src/monitor/index.ts, src/index.ts, src/web/routes/review-config.ts]
tech_stack:
  added: []
  patterns: [tree-picker-reuse, conditional-state-persistence]
key_files:
  created: []
  modified:
    - src/web/frontend/app.ts
    - src/monitor/index.ts
    - src/index.ts
    - src/web/routes/review-config.ts
    - test/unit/monitor/monitor.test.ts
decisions:
  - Stale sweeper bug confirmed real - async gap between stop() and reassignment allows getSweeper() to return stopped instance
  - Used ReviewSweeper | undefined typing instead of any cast to close the timing gap
  - Cursor toggle uses SQLite state table (getState/setState) rather than config file to avoid config reload side effects
metrics:
  duration: ~4min
  completed: "2026-04-11T00:57:55Z"
  tasks_completed: 3
  tasks_total: 4
  tests_added: 4
  tests_total: 347
---

# Phase 04 Plan 02: Sweep Settings UI, Cursor Toggle, and Stale Sweeper Fix Summary

Editable sweep settings card with tree pickers for folder selection, stale sweeper timing gap closure via undefined guard, and conditional lastUid persistence controlled by cursor toggle checkbox.

## Completed Tasks

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Editable sweep settings card with tree pickers | 1f63b55 | src/web/frontend/app.ts |
| 2 | Fix stale sweeper reference (CONF-03) | 1643ca2 | src/index.ts |
| 3 (RED) | Cursor toggle failing tests | a6dd3b5 | test/unit/monitor/monitor.test.ts |
| 3 (GREEN) | Cursor toggle implementation | 8378207 | src/monitor/index.ts, src/web/routes/review-config.ts |

## Task 4: Checkpoint (human-verify)

Awaiting human verification of the sweep settings UI, cursor toggle, and stale sweeper fix.

## What Changed

### Task 1: Editable Sweep Settings Card
- Replaced read-only `<dl class="sweep-info">` sweep card with editable form
- Three tree pickers (Review Folder, Archive Folder, Trash Folder) using existing `renderFolderPicker` component
- Three numeric inputs (Sweep Interval hours, Read Max Age days, Unread Max Age days)
- Cursor toggle checkbox wired to `/api/settings/cursor` endpoint
- Save handler sends complete `sweep` sub-object to avoid shallow merge pitfall in `updateReviewConfig`
- Added `ReviewConfig` type import for payload typing

### Task 2: Stale Sweeper Fix
- Confirmed the stale sweeper bug is real: between `sweeper.stop()` and the async `getSpecialUseFolder` call, `getSweeper()` returns a stopped instance
- Changed `let sweeper` to `let sweeper: ReviewSweeper | undefined` (no `as any` cast)
- Set `sweeper = undefined` before async gap in both `onReviewConfigChange` and `onImapConfigChange`
- Added undefined guards on `sweeper.stop()`, `sweeper.updateRules()` calls
- Routes already handle `getSweeper()` returning undefined gracefully

### Task 3: Cursor Toggle (TDD)
- Added `cursorEnabled` field to Monitor class
- Constructor reads `getState('cursorEnabled')` -- defaults to enabled when unset
- When disabled, constructor sets `lastUid = 0` regardless of stored value
- `processNewMessages` only persists lastUid when cursor is enabled
- Added `GET/PUT /api/settings/cursor` endpoints in review-config routes
- Frontend loads cursor state and wires checkbox in sweep settings card
- 4 new tests cover: disabled ignores stored UID, disabled skips persistence, default behavior, enabled behavior

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **Stale sweeper is a real bug**: The async gap in `onReviewConfigChange` between `stop()` and `new ReviewSweeper()` allows routes to get a stopped sweeper instance. Fixed with `undefined` guard.
2. **No `as any` needed**: Using `ReviewSweeper | undefined` type makes `sweeper = undefined` assignment valid without any cast.
3. **Cursor state in SQLite state table**: Using `activityLog.getState/setState` keeps the cursor toggle independent of config file changes and avoids triggering config reload listeners.

## Verification

- `node esbuild.mjs` exits 0
- `npx vitest run` exits 0 (347 tests, all passing)
- No `as any` cast in modified code paths (existing `as any` in review-config route handler was pre-existing)

## Self-Check: PASSED

All modified files exist. All 4 commits verified in git log.
