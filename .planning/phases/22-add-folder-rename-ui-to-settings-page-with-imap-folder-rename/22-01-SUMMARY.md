---
phase: 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename
plan: 01
subsystem: imap, web-api, frontend
tags: [folder-rename, imap, api, validation]
dependency_graph:
  requires: []
  provides: [imap-rename-method, folder-rename-api, frontend-rename-method]
  affects: [src/imap/client.ts, src/folders/cache.ts, src/web/routes/folders.ts, src/web/frontend/api.ts]
tech_stack:
  added: []
  patterns: [tdd, fastify-route-injection-testing]
key_files:
  created:
    - test/unit/imap/client-rename.test.ts
    - test/unit/web/folders-rename.test.ts
  modified:
    - src/imap/client.ts
    - src/folders/cache.ts
    - src/web/routes/folders.ts
    - src/web/frontend/api.ts
decisions:
  - "renameFolder uses withMailboxLock on INBOX following createMailbox pattern"
  - "Route builds full new path from oldPath parent + newPath leaf name"
  - "D-07 cache refresh on failure uses getTree(true) as best-effort"
metrics:
  duration_seconds: 160
  completed: "2026-04-21T02:10:49Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 14
  files_modified: 4
  files_created: 2
---

# Phase 22 Plan 01: IMAP Folder Rename Backend Summary

IMAP folder rename plumbing from ImapClient through FolderCache to API route with full input validation and frontend API method.

## What Was Built

### Task 1: ImapClient and FolderCache renameFolder methods
- Added `mailboxRename` to `ImapFlowLike` interface
- Added `ImapClient.renameFolder(oldPath, newPath)` using `withMailboxLock('INBOX')` pattern
- Added `FolderCache.renameFolder(oldPath, newPath)` that delegates to ImapClient then refreshes cache
- 5 unit tests: correct delegation, INBOX lock acquisition, not-connected error, cache refresh, error propagation

### Task 2: POST /api/folders/rename route with validation
- Input validation: required fields, path separator rejection, control char rejection, length cap (255), empty-after-trim check
- INBOX block (case-insensitive) per D-04
- Actions/ prefix block per D-04
- Collision detection via `cache.hasFolder()` per D-08
- Cache refresh on failure per D-07
- Frontend `api.folders.rename()` method added
- 9 unit tests covering all validation paths, success case, error case, and D-07 refresh behavior

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **renameFolder lock pattern**: Used `withMailboxLock('INBOX')` matching the existing `createMailbox` pattern
2. **Full path construction**: Route builds full new path by splitting oldPath on delimiter and replacing last segment with newPath
3. **D-07 error refresh**: Uses `cache.getTree(true)` rather than `cache.refresh()` directly, wrapped in try/catch for best-effort

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | df79829 | Add renameFolder to ImapClient and FolderCache |
| 2 | a663d57 | Add POST /api/folders/rename route with validation |

## Verification

All 19 tests pass across 3 test files (client-rename, folders-rename, folders).
