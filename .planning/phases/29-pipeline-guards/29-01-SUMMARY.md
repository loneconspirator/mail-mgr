---
phase: 29-pipeline-guards
plan: 01
subsystem: sentinel-detection
tags: [sentinel, imap, headers, detection]
dependency_graph:
  requires: []
  provides: [isSentinel, isSentinelRaw, SENTINEL_HEADER, headers-on-message-types]
  affects: [src/sentinel, src/imap/client.ts, src/imap/messages.ts]
tech_stack:
  added: []
  patterns: [header-based-detection, always-fetch-sentinel-header]
key_files:
  created:
    - src/sentinel/detect.ts
    - test/unit/sentinel/detect.test.ts
  modified:
    - src/sentinel/index.ts
    - src/imap/client.ts
    - src/imap/messages.ts
    - test/unit/imap/client.test.ts
    - test/unit/imap/messages.test.ts
decisions:
  - "SENTINEL_HEADER uses lowercase 'x-mail-mgr-sentinel' matching parseHeaderLines normalization"
  - "getHeaderFields() always returns array (never undefined) ensuring sentinel header always fetched"
  - "Headers parsed once and stored on message types, avoiding redundant parsing in processors"
metrics:
  duration: "217s"
  completed: "2026-04-22"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 17
  files_changed: 7
---

# Phase 29 Plan 01: Sentinel Detection Utility and IMAP Header Infrastructure Summary

Sentinel header detection with isSentinel/isSentinelRaw utilities and IMAP infrastructure extended to always fetch and parse X-Mail-Mgr-Sentinel header on all message types.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Create sentinel detection utility and tests (TDD) | e480206 | detect.ts with isSentinel/isSentinelRaw, barrel export, 9 tests |
| 2 | Extend IMAP fetch and message types for sentinel header | 07f6bc7 | getHeaderFields always returns sentinel header, headers Map on EmailMessage/ReviewMessage, 8 new tests |

## Implementation Details

### Task 1: Sentinel Detection Utility (TDD)
- Created `src/sentinel/detect.ts` with three exports: `SENTINEL_HEADER` constant, `isSentinel()` for parsed header Maps, `isSentinelRaw()` for raw Buffers
- `isSentinel()` checks Map.has() for the lowercase sentinel key -- simple, no regex or string parsing
- `isSentinelRaw()` delegates to `parseHeaderLines()` then checks the parsed Map
- Updated barrel `src/sentinel/index.ts` to re-export all three
- 9 unit tests covering undefined, empty, missing key, present key, raw buffer variants

### Task 2: IMAP Header Infrastructure
- Changed `getHeaderFields()` return type from `string[] | undefined` to `string[]` -- always includes `X-Mail-Mgr-Sentinel`
- Added optional `headers?: Map<string, string>` to both `EmailMessage` and `ReviewMessage` interfaces
- Refactored `parseMessage()` to always parse headers when Buffer present (previously only parsed inside envelopeHeader conditional)
- Refactored `parseRawToReviewMessage()` similarly
- Updated `reviewMessageToEmailMessage()` to pass through headers field
- 8 new tests across client.test.ts and messages.test.ts

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
