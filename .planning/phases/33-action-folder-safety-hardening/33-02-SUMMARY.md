---
phase: 33-action-folder-safety-hardening
plan: 02
subsystem: action-folders
tags: [performance, imap, sentinel, poller]
dependency_graph:
  requires: []
  provides: [sentinel-aware-skip]
  affects: [action-folder-polling]
tech_stack:
  added: []
  patterns: [sentinel-count-guard, debug-level-skip-logging]
key_files:
  created: []
  modified:
    - src/action-folders/poller.ts
    - test/unit/action-folders/poller.test.ts
decisions:
  - Use debug (not info) level for skip logs since they fire every 15 seconds per folder
  - Count-based skip is intentionally upstream of all processing/retry logic
metrics:
  duration: 3m28s
  completed: "2026-04-24T23:32:14Z"
  tasks: 1
  files: 2
---

# Phase 33 Plan 02: Sentinel-Aware Skip Summary

Sentinel-aware poller skip eliminates ~4 IMAP fetchAllMessages round-trips per poll cycle when folders contain only their sentinel message.

## What Changed

The `ActionFolderPoller.scanAll()` method now checks `status.messages` count before fetching:
- `messages === 0`: logs debug "sentinel missing, skipping" and continues
- `messages === 1`: logs debug "only sentinel, skipping fetch" and continues  
- `messages > 1`: proceeds with fetchAllMessages as before

This is a pure optimization -- no behavioral change for folders with real messages.

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for sentinel-aware skip | 271d51b | test/unit/action-folders/poller.test.ts |
| 1 (GREEN) | Implement sentinel-aware skip | d2657ce | src/action-folders/poller.ts, test/unit/action-folders/poller.test.ts |

## Test Results

- 23 tests pass (was 17 before, added 4 new sentinel tests, updated 2 existing)
- New tests: sentinel-only skip, empty folder debug log, mixed folder scenario, 2-message fetch
- Updated tests: all tests that previously mocked `messages: 1` now use `messages: 2` to avoid sentinel skip

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock ordering in multi-folder and warning tests**
- **Found during:** Task 1 GREEN phase
- **Issue:** Several existing tests had status mock call ordering that assumed re-checks happen after all initial status calls, but the actual code does re-checks inline per folder
- **Fix:** Reordered mock return values to match inline re-check flow (vip-initial, vip-recheck, block-initial, block-recheck, ...)
- **Files modified:** test/unit/action-folders/poller.test.ts
- **Commit:** d2657ce

## Verification

```
npx vitest run test/unit/action-folders/poller.test.ts
# 23 tests pass, 0 failures
```

## Self-Check: PASSED
