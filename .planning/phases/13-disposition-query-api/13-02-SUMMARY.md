---
phase: 13-disposition-query-api
plan: 02
subsystem: web/dispositions
tags: [predicate-fix, code-review, gap-closure, security]
dependency_graph:
  requires: [13-01]
  provides: [complete-isSenderOnly-predicate, safe-query-param-handling]
  affects: [disposition-views]
tech_stack:
  added: []
  patterns: [typeof-narrowing-for-query-params, afterEach-cleanup]
key_files:
  created: []
  modified:
    - src/web/routes/dispositions.ts
    - test/unit/web/dispositions.test.ts
decisions:
  - "readStatus 'any' treated as equivalent to undefined for sender-only check"
  - "Query param narrowed from unknown via typeof guard instead of unsafe string cast"
metrics:
  duration: 116s
  completed: "2026-04-20T05:04:33Z"
  tasks: 2
  files: 2
---

# Phase 13 Plan 02: Gap Closure and Code Review Fixes Summary

Complete isSenderOnly predicate checking all 6 EmailMatch fields with safe query param narrowing and proper test teardown.

## What Was Done

### Task 1: Fix isSenderOnly predicate (TDD)

Fixed the `isSenderOnly` predicate which only checked 3 of 6 EmailMatch fields (sender, recipient, subject). Added checks for deliveredTo, visibility, and readStatus. The readStatus field uses special logic: `'any'` is treated as equivalent to undefined (passes sender-only), while `'read'` and `'unread'` correctly exclude a rule.

Added 6 new unit tests covering each new field check and 3 new integration test rules (r8: sender+deliveredTo excluded, r9: sender+readStatus:any included, r10: sender+readStatus:read excluded).

**Commit:** 8d00dba

### Task 2: Code Review Findings (WR-02, IN-01, IN-02)

- **WR-02:** Added `getMoveTracker` and `getProposalStore` stubs to the test `makeDeps` function, satisfying the full `ServerDeps` interface.
- **IN-01:** Replaced unsafe `Record<string, string>` cast with `Record<string, unknown>` and `typeof` guard for safe query param narrowing.
- **IN-02:** Added `await app?.close()` in `afterEach` to prevent Fastify instance resource leaks across tests. Promoted `app` to module-level variable.

**Commit:** 1d9805a

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `npx vitest run test/unit/web/dispositions.test.ts` -- 25/25 tests passing
- `grep "m.deliveredTo === undefined" src/web/routes/dispositions.ts` -- match found
- `grep "m.visibility === undefined" src/web/routes/dispositions.ts` -- match found
- `grep "m.readStatus === undefined || m.readStatus === 'any'" src/web/routes/dispositions.ts` -- match found
- `grep "getMoveTracker" test/unit/web/dispositions.test.ts` -- match found
- `grep "typeof raw === 'string'" src/web/routes/dispositions.ts` -- match found
- `grep "app?.close()" test/unit/web/dispositions.test.ts` -- match found
- Full suite: 471/478 pass (7 pre-existing failures in frontend.test.ts due to missing dist/public static files in worktree -- unrelated)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 8d00dba | feat(13-02): fix isSenderOnly to check all 6 EmailMatch fields |
| 2 | 1d9805a | fix(13-02): address code review findings WR-02, IN-01, IN-02 |
