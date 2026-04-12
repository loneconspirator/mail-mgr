---
phase: 08-extended-matchers-ui
plan: 01
subsystem: imap-discovery, web-api, config
tags: [discovery, envelope-header, api, restore]
dependency_graph:
  requires: []
  provides: [envelope-api, discovery-module, envelopeHeader-config]
  affects: [imap-config, web-server, frontend-api]
tech_stack:
  added: []
  patterns: [consensus-probing, in-progress-guard]
key_files:
  created:
    - src/imap/discovery.ts
    - src/web/routes/envelope.ts
    - test/unit/imap/discovery.test.ts
  modified:
    - src/imap/messages.ts
    - src/imap/index.ts
    - src/config/schema.ts
    - src/index.ts
    - src/web/server.ts
    - src/shared/types.ts
    - src/web/frontend/api.ts
    - test/unit/web/api.test.ts
decisions:
  - Restored parseHeaderLines to messages.ts since discovery depends on it for header buffer parsing
  - Added in-progress flag to POST /api/config/envelope/discover to mitigate T-08-01 DoS threat
metrics:
  duration: 237s
  completed: "2026-04-12T16:06:35Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 12
  files_changed: 11
---

# Phase 08 Plan 01: Envelope Discovery Backend and API Summary

Restored envelope header discovery module lost in Phase 7 commit f453be7, added envelopeHeader to IMAP config schema, created GET/POST envelope API endpoints, and added frontend API wrapper methods.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | 0c760e2 | Failing tests for discovery module and envelopeHeader schema |
| 1 (GREEN) | 0be2423 | Restore discovery module, add envelopeHeader to config schema |
| 2 (RED) | 419a0b5 | Failing tests for envelope API routes |
| 2 (GREEN) | f01ed85 | Create envelope API routes and frontend API wrapper methods |

## Task Details

### Task 1: Restore discovery module, add envelopeHeader to config schema, restore lifecycle integration

- Recreated `src/imap/discovery.ts` with `probeEnvelopeHeaders` and `CANDIDATE_HEADERS` exports
- Restored `parseHeaderLines` function in `messages.ts` (needed by discovery for header buffer parsing)
- Added `envelopeHeader: z.string().optional()` to `imapConfigSchema`
- Updated `src/imap/index.ts` barrel to re-export discovery and parseHeaderLines
- Integrated discovery into `src/index.ts`: runs after connect on startup and on IMAP config change, wrapped in try/catch so failure doesn't block operation
- 9 tests: consensus logic, null cases, header validation, schema compatibility

### Task 2: Create envelope API routes and frontend API wrapper methods

- Added `EnvelopeStatus` interface to `src/shared/types.ts`
- Created `src/web/routes/envelope.ts` with GET /api/config/envelope (returns current envelopeHeader) and POST /api/config/envelope/discover (triggers probe and persists result)
- Added in-progress flag to prevent concurrent discovery calls (T-08-01 DoS mitigation)
- Registered routes in `src/web/server.ts`
- Added `getEnvelopeStatus()` and `triggerDiscovery()` to frontend `api.ts`
- 3 tests: null state, configured state, error shape on POST without IMAP

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored parseHeaderLines to messages.ts**
- **Found during:** Task 1
- **Issue:** `parseHeaderLines` was removed from messages.ts during Phase 7 refactoring but discovery.ts depends on it
- **Fix:** Re-added the function to messages.ts and exported it from imap barrel
- **Files modified:** src/imap/messages.ts, src/imap/index.ts

## Verification

- `npx vitest run test/unit/imap/discovery.test.ts` -- 9 tests pass
- `npx vitest run test/unit/web/api.test.ts` -- 19 tests pass
- `npx vitest run test/unit/config/config.test.ts` -- 46 tests pass
- `grep "envelopeHeader" src/config/schema.ts` -- field exists
- `grep "registerEnvelopeRoutes" src/web/server.ts` -- routes registered
- `grep "getEnvelopeStatus" src/web/frontend/api.ts` -- frontend method exists

## Pre-existing Issues (Out of Scope)

- `test/unit/web/frontend.test.ts` has 4 pre-existing failures (SPA static file serving tests that require built frontend assets). Not caused by this plan's changes.

## Self-Check: PASSED
