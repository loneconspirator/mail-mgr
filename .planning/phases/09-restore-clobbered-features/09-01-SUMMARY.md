---
phase: 09-restore-clobbered-features
plan: 01
subsystem: foundation
tags: [restore, types, imap, config, migrations, folders]
dependency_graph:
  requires: []
  provides: [shared-types, imap-envelope, config-review-crud, migrations, folder-cache, recent-folders-api]
  affects: [sweep, batch, routes, frontend]
tech_stack:
  added: []
  patterns: [additive-merge, pre-clobber-restoration]
key_files:
  created:
    - src/log/migrations.ts
    - src/folders/cache.ts
    - src/folders/index.ts
  modified:
    - src/shared/types.ts
    - src/imap/messages.ts
    - src/imap/index.ts
    - src/imap/client.ts
    - src/config/repository.ts
    - src/log/index.ts
    - src/web/routes/activity.ts
decisions: []
metrics:
  duration: 4m
  completed: 2026-04-12
  tasks: 2
  files: 10
---

# Phase 09 Plan 01: Restore Foundation Layer Summary

Restored Layer 0 and Layer 1 dependencies: shared types with folder/batch/dry-run interfaces, IMAP message parsing with envelope recipient and visibility classification, IMAP client folder listing and header fetching, config repository review CRUD, DB migrations module, activity recent-folders API endpoint, and folder cache module with TTL-based IMAP tree caching.

## What Changed

### Task 1: Restore shared types, IMAP messages, IMAP barrel, and migrations
- **src/shared/types.ts**: Added FolderNode, FolderTreeResponse, DryRunMessage, DryRunGroup, BatchStatus, BatchStatusResponse, DryRunResponse interfaces (all additive, Phase 8 EnvelopeStatus preserved)
- **src/imap/messages.ts**: Added `headers?: Buffer` to ImapFetchResult, `envelopeRecipient`/`visibility` to ReviewMessage, added `classifyVisibility()` function, enhanced `parseMessage()` with optional `envelopeHeader` parameter for envelope recipient extraction
- **src/imap/index.ts**: Added `classifyVisibility` to barrel exports
- **src/log/migrations.ts**: Restored complete migrations module with `runMigrations()` and schema_version tracking table
- Commit: `f40e31d`

### Task 2: Restore IMAP client methods, config review methods, activity recent-folders, and folder cache
- **src/imap/client.ts**: Added `listTree` to ImapFlowLike interface, `getHeaderFields()` private method, header fields in fetch queries for both `fetchNewMessages` and `fetchAllMessages`, envelope-aware `parseRawToReviewMessage`, `listFolders()` with tree transformation
- **src/config/repository.ts**: Added `reviewListeners` field, `getReviewConfig()`, `updateReviewConfig()`, `onReviewConfigChange()` methods with Zod validation
- **src/log/index.ts**: Added `getRecentFolders()` method querying distinct successful folder destinations
- **src/web/routes/activity.ts**: Added `GET /api/activity/recent-folders` endpoint with limit parameter
- **src/folders/cache.ts**: Restored FolderCache class with TTL-based caching, stale fallback, folder path search
- **src/folders/index.ts**: Restored barrel export for FolderCache
- Commit: `937d9ae`

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `npm run build` exits 0
- All 253 tests pass (14 test files)
- All acceptance criteria from both tasks verified through successful build and test run

## Self-Check: PASSED

All 10 files exist, both commits found (f40e31d, 937d9ae), all content patterns verified.
