---
phase: quick
plan: 260419-ltm
subsystem: rules/web
tags: [conflict-detection, proposed-rules, rule-ordering]
dependency_graph:
  requires: []
  provides: [conflict-checker, approve-conflict-guard]
  affects: [proposed-rules-approve, frontend-proposal-cards]
tech_stack:
  added: []
  patterns: [picomatch-glob-matching, api-error-class-with-conflict-payload]
key_files:
  created:
    - src/rules/conflict-checker.ts
    - test/unit/rules/conflict-checker.test.ts
  modified:
    - src/shared/types.ts
    - src/web/routes/proposed-rules.ts
    - src/web/frontend/api.ts
    - src/web/frontend/app.ts
    - src/web/frontend/styles.css
    - test/unit/web/proposed-rules.test.ts
decisions:
  - Exact match conflicts block approval entirely (reordering cannot fix duplicates)
  - Shadow conflicts offer Save Ahead to insert new rule before the shadowing rule
  - ApiError class used instead of plain Error to carry conflict payload to frontend
metrics:
  duration: 4min
  completed: 2026-04-19
  tasks: 2
  files: 8
---

# Quick Task 260419-ltm: Prevent Redundant Proposed Rules and Handle Rule Ordering Conflicts Summary

Conflict detection module with exact-match and shadow detection using picomatch glob matching, integrated into approve endpoint with 409 responses and frontend inline notices with Save Ahead reorder option.

## What Was Done

### Task 1: Conflict detection module and approve endpoint (TDD)

- Created `src/rules/conflict-checker.ts` with `checkProposalConflict` function
- Detects exact matches (same sender + deliveredTo, no extra narrowing fields)
- Detects shadow conflicts (broader glob rule catches proposal's sender)
- Ignores disabled rules; case-insensitive matching
- Updated approve endpoint to return 409 with conflict details
- `insertBefore` query param enables shadow override with automatic reorder
- Validates insertBefore rule ID exists (T-quick-01 threat mitigation)
- Added `ProposalConflict` type to shared/types.ts
- 9 unit tests for conflict-checker, 4 for approve endpoint conflicts

### Task 2: Frontend conflict handling

- Created `ApiError` class in api.ts to carry conflict payload from 409 responses
- Added `approveInsertBefore` API method for shadow override
- Approve button handler detects 409 conflicts and shows inline notice:
  - Exact match: persistent notice, Approve disabled, Modify/Dismiss still work
  - Shadow: notice with Save Ahead button to insert before shadowing rule
- CSS for `.proposal-conflict-notice` with amber/warning styling

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | e39bdb3 | Failing tests for conflict detection |
| 1 (GREEN) | 692f151 | Conflict detection module and approve endpoint guard |
| 2 | 8bbccec | Frontend conflict handling with Save Ahead option |

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All 453 tests pass (28 test files)
- TypeScript build succeeds with no errors
- 9 new conflict-checker tests + 4 new approve endpoint conflict tests

## Self-Check: PASSED
