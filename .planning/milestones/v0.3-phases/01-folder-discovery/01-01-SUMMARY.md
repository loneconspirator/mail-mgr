---
phase: 01-folder-discovery
plan: 01
subsystem: api
tags: [imap, folder-hierarchy, caching, fastify, rest-api]

# Dependency graph
requires: []
provides:
  - FolderCache class with TTL-based in-memory caching of IMAP folder tree
  - GET /api/folders endpoint returning nested folder hierarchy
  - ImapClient.listFolders() method wrapping imapflow listTree()
  - FolderNode and FolderTreeResponse shared types
affects: [02-tree-picker, 03-batch-filing]

# Tech tracking
tech-stack:
  added: []
  patterns: [FolderCache dependency injection, Set-to-Array flag conversion, listTree transformation]

key-files:
  created:
    - src/folders/cache.ts
    - src/folders/index.ts
    - src/web/routes/folders.ts
    - test/unit/folders/cache.test.ts
    - test/unit/web/folders.test.ts
  modified:
    - src/shared/types.ts
    - src/imap/client.ts
    - src/web/server.ts
    - src/index.ts
    - test/unit/imap/client.test.ts

key-decisions:
  - "5-minute TTL (300s) for folder cache -- folder structure rarely changes for a 20-year mailbox"
  - "getFolderCache getter pattern on ServerDeps consistent with existing getMonitor/getSweeper pattern"

patterns-established:
  - "FolderCache: in-memory cache with TTL, stale fallback on IMAP disconnect, force-refresh via query param"
  - "ImapFlowLike extension: add method to interface, implement on ImapClient, update mock factory in tests"

requirements-completed: [FOLD-01, FOLD-02]

# Metrics
duration: 4min
completed: 2026-04-06
---

# Phase 1 Plan 1: Folder Discovery API Summary

**FolderCache with 5-min TTL serving IMAP folder hierarchy at GET /api/folders, with stale fallback and force-refresh support**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-07T02:18:16Z
- **Completed:** 2026-04-07T02:22:23Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- FolderCache class caches IMAP folder tree with configurable TTL, returns stale data when IMAP disconnected
- GET /api/folders returns nested FolderTreeResponse with cachedAt timestamp and stale indicator
- ImapClient.listFolders() transforms imapflow ListTreeResponse to FolderNode[] (Set-to-Array flags, root node skipping, recursive children)
- 25 new tests added (15 cache, 5 imap listFolders, 5 route handler)

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, ImapClient extension, and FolderCache with tests** - `92c8b45` (feat)
2. **Task 2: Folder API route and server wiring** - `97a039b` (feat)

## Files Created/Modified
- `src/shared/types.ts` - Added FolderNode and FolderTreeResponse interfaces
- `src/imap/client.ts` - Added listTree to ImapFlowLike, listFolders() and transformTree() to ImapClient
- `src/folders/cache.ts` - FolderCache class with TTL caching, hasFolder search, getResponse
- `src/folders/index.ts` - Barrel exports for folders module
- `src/web/routes/folders.ts` - GET /api/folders route handler with refresh and 503 support
- `src/web/server.ts` - Added getFolderCache to ServerDeps, registered folder routes
- `src/index.ts` - Created FolderCache instance, wired into server deps, rebuild on config change
- `test/unit/folders/cache.test.ts` - 15 tests for FolderCache
- `test/unit/imap/client.test.ts` - 5 new tests for listFolders, updated mock with listTree
- `test/unit/web/folders.test.ts` - 5 tests for folder route handler

## Decisions Made
- Used 5-minute TTL (300,000ms) for folder cache default -- stable mailbox structure doesn't need more frequent updates
- Used getter pattern (`getFolderCache: () => FolderCache`) on ServerDeps consistent with existing conventions
- FolderCache returns stale cached data when IMAP errors out (graceful degradation), only throws when no cache exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing 4 test failures in `test/unit/web/frontend.test.ts` (SPA fallback route tests) -- unrelated to this plan, not introduced by changes

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GET /api/folders endpoint ready for Phase 2 tree picker to consume
- FolderCache.hasFolder() ready for Phase 1 Plan 2 (folder validation on rule save)
- All existing tests continue to pass (251 passing)

---
*Phase: 01-folder-discovery*
*Completed: 2026-04-06*
