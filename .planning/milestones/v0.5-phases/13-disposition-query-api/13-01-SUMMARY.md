---
phase: 13-disposition-query-api
plan: 01
subsystem: web-api
tags: [api, filtering, dispositions, tdd]
dependency_graph:
  requires: []
  provides: [GET /api/dispositions, isSenderOnly, isValidDispositionType]
  affects: [src/web/server.ts]
tech_stack:
  added: []
  patterns: [predicate-filter, query-param-validation, allowlist-validation]
key_files:
  created:
    - src/web/routes/dispositions.ts
    - test/unit/web/dispositions.test.ts
  modified:
    - src/web/server.ts
decisions:
  - Adapted isSenderOnly to check only fields in current schema (sender, recipient, subject) -- deliveredTo, visibility, readStatus do not exist in EmailMatch type
  - Route registration done in Task 1 GREEN phase since tests require it to pass
metrics:
  duration: 3m 21s
  completed: 2026-04-20T04:49:23Z
  tasks: 2
  files: 3
---

# Phase 13 Plan 01: Disposition Query API Summary

Sender-only rule filtering endpoint with type-based query param and allowlist validation via TDD.

## What Was Built

- **`isSenderOnly(rule)`** predicate that returns true when a rule matches only on sender (no recipient/subject criteria)
- **`isValidDispositionType(type)`** type guard that validates against allowlist `['skip', 'delete', 'review', 'move']`
- **`GET /api/dispositions`** endpoint returning filtered sender-only rules
- **`GET /api/dispositions?type=skip`** optional query parameter filters by action type
- **Invalid type returns 400** with error message and valid types list
- Disabled sender-only rules are included in results
- Multi-criteria rules are excluded from all responses

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | TDD isSenderOnly predicate and GET /api/dispositions route | 91572c2 (RED), 6157889 (GREEN) | dispositions.ts, dispositions.test.ts, server.ts |
| 2 | Register disposition route and run full suite | 6157889 (included in Task 1) | server.ts (already modified) |

## Test Results

- 19 tests in `test/unit/web/dispositions.test.ts` -- all passing
- 19 tests in `test/unit/web/api.test.ts` -- all passing (no regressions)
- 7 pre-existing failures in `test/unit/web/frontend.test.ts` (static file serving, unrelated to this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schema mismatch: plan references nonexistent fields**
- **Found during:** Task 1
- **Issue:** Plan references `deliveredTo`, `visibility`, and `readStatus` fields in `EmailMatch` type, but the actual schema (`src/config/schema.ts`) only has `sender`, `recipient`, `subject`. These fields do not exist.
- **Fix:** Adapted `isSenderOnly` to check only the three fields that actually exist. Removed test cases for nonexistent fields (deliveredTo, visibility, readStatus variations). The predicate correctly identifies sender-only rules based on the actual schema.
- **Files modified:** src/web/routes/dispositions.ts, test/unit/web/dispositions.test.ts

**2. [Rule 3 - Blocking] Route registration needed for Task 1 tests**
- **Found during:** Task 1 GREEN phase
- **Issue:** Route handler tests use `buildServer` + `app.inject()`, which requires the route to be registered in server.ts. Without registration, all route tests return 404.
- **Fix:** Moved route registration (Task 2 work) into Task 1 GREEN phase. Task 2 became a verification-only task.
- **Files modified:** src/web/server.ts

**3. [Rule 3 - Blocking] Test makeDeps structure mismatch**
- **Found during:** Task 1 RED phase
- **Issue:** Plan's test helper pattern used `monitor` property, but actual `ServerDeps` interface uses `getMonitor()`, `getSweeper()`, `getFolderCache()`, `getBatchEngine()` function properties.
- **Fix:** Updated `makeDeps` to match the actual `ServerDeps` interface from `api.test.ts`.
- **Files modified:** test/unit/web/dispositions.test.ts

## Known Stubs

None -- all functionality is fully wired.

## Self-Check: PASSED

- [x] src/web/routes/dispositions.ts exists
- [x] test/unit/web/dispositions.test.ts exists
- [x] Commit 91572c2 exists (RED phase)
- [x] Commit 6157889 exists (GREEN phase)
