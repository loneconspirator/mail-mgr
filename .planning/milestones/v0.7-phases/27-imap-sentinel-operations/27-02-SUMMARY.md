---
phase: 27-imap-sentinel-operations
plan: 02
subsystem: sentinel
tags: [imap, sentinel, self-test, tdd]
dependency_graph:
  requires: [27-01]
  provides: [appendSentinel, findSentinel, deleteSentinel, runSentinelSelfTest]
  affects: [sentinel/index.ts]
tech_stack:
  added: []
  patterns: [try-catch-finally cleanup, graceful degradation, round-trip self-test]
key_files:
  created:
    - src/sentinel/imap-ops.ts
    - test/unit/sentinel/imap-ops.test.ts
  modified:
    - src/sentinel/index.ts
decisions:
  - SentinelStore.upsert called with positional args (messageId, folderPath, folderPurpose) matching actual store API, not object form from plan
  - Self-test cleanup uses finally block with best-effort delete that silently catches errors
  - findSentinel returns first UID from search results (consistent with single-sentinel-per-folder model)
metrics:
  duration: 102s
  completed: 2026-04-22T03:29:16Z
  tasks: 2/2
  files: 3
---

# Phase 27 Plan 02: Sentinel IMAP Operations Summary

TDD-built IMAP operation wrappers for sentinel lifecycle (append/find/delete) plus startup self-test that validates SEARCH HEADER support via full round-trip

## What Was Done

### Task 1: TDD sentinel IMAP operations and self-test (RED then GREEN)

**RED phase** wrote 16 failing tests covering all four functions: appendSentinel (append, store integration, no-store, INBOX rejection), findSentinel (header search, UID return, empty result), deleteSentinel (UID delete, store cleanup, no-store), and runSentinelSelfTest (success, search-empty, cleanup-on-failure, append-error, search-throws, delete-fails).

**GREEN phase** implemented `src/sentinel/imap-ops.ts` with:
- `appendSentinel` — builds sentinel via `buildSentinelMessage`, appends via `client.appendMessage`, optionally tracks in store
- `findSentinel` — searches by `X-Mail-Mgr-Sentinel` header, returns first UID or undefined
- `deleteSentinel` — deletes by UID via `client.deleteMessage`, optionally removes from store
- `runSentinelSelfTest` — full APPEND/SEARCH/DELETE round-trip; returns boolean (never throws); cleans up in finally block

**Commits:** `ce9f8fb` (RED), `3db26da` (GREEN)

### Task 2: Update sentinel barrel exports and verify full suite

Added re-exports of all four functions and `AppendSentinelResult` type to `src/sentinel/index.ts`. Full sentinel test suite passes (60 tests across format, store, imap-ops).

**Commit:** `bc189fd`

## Verification Results

- `npx vitest run test/unit/sentinel/imap-ops.test.ts` — 16/16 passed
- `npx vitest run test/unit/sentinel/` — 60/60 passed (format 27 + store 17 + imap-ops 16)
- `npx vitest run` — 659/666 passed; 7 failures all in `test/unit/web/frontend.test.ts` (pre-existing, unrelated to sentinel work)
- `src/sentinel/imap-ops.ts` imports from `../imap/index.js` and `./format.js`
- `runSentinelSelfTest` uses try/catch/finally with cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SentinelStore.upsert signature mismatch**
- **Found during:** Task 1 GREEN phase
- **Issue:** Plan specified `store.upsert({ messageId, folderPath, folderPurpose })` but actual store API uses positional args `upsert(messageId, folderPath, folderPurpose)`
- **Fix:** Used correct positional argument signature in both implementation and tests
- **Files modified:** src/sentinel/imap-ops.ts, test/unit/sentinel/imap-ops.test.ts

## Self-Check: PASSED
