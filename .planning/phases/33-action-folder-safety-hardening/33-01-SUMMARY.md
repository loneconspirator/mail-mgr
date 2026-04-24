---
phase: 33-action-folder-safety-hardening
plan: 01
subsystem: action-folders
tags: [bugfix, safety, logging, tdd]
dependency_graph:
  requires: []
  provides: [post-move-activity-logging, duplicate-early-return, diagnostic-logging]
  affects: [action-folder-processor]
tech_stack:
  added: []
  patterns: [pending-activities-accumulator, post-effect-logging]
key_files:
  created: []
  modified:
    - src/action-folders/processor.ts
    - test/unit/action-folders/processor.test.ts
decisions:
  - "Used pendingActivities array to accumulate log entries before move, flushing after success/failure"
  - "Diagnostic logging goes to pino only (not activity log) -- ops debugging, not user audit trail"
  - "Duplicate path gets fully self-contained move+log+return sequence for all cases including conflict+duplicate"
metrics:
  duration: 143s
  completed: 2026-04-24T23:32:08Z
  tasks_completed: 1
  tasks_total: 1
  test_count: 47
  tests_passed: 47
---

# Phase 33 Plan 01: Processor Bug Fixes and Diagnostic Logging Summary

Post-move activity logging with success tracking, duplicate path early return, and structured diagnostic logging for action folder message tracing.

## What Was Done

### Task 1: Fix processor bugs (D-05, D-06) and add diagnostic logging (D-07)

**TDD RED:** Added 12 new tests covering:
- Call order verification (moveMessage before logActivity) for VIP, Block, remove, and conflict paths
- Move failure logging with `success: false`
- Duplicate path early return with own move+log+return for both VIP and Block
- Duplicate move failure with `success: false`
- Diagnostic log field verification (uid, messageId, sender, subject, actionType, folder)
- Sentinel and unparseable sender exclusion from diagnostic log

**TDD GREEN:** Restructured `processMessage` in `processor.ts`:
1. **D-05:** Introduced `pendingActivities` array to accumulate activity log entries. All `logActivity` calls now happen after `moveMessage` succeeds. On move failure, activities are logged with `success: false`. `buildActionResult` now accepts a `success` parameter (default `true`).
2. **D-06:** Duplicate detection path now has its own `moveMessage` + `logActivity` + `return` sequence. No fall-through to the shared move at the bottom. Handles conflict+duplicate combo correctly.
3. **D-07:** Added `logger.info` diagnostic log after sender extraction, before business logic. Includes `uid`, `messageId`, `sender`, `subject`, `actionType`, `folder`. Not emitted for sentinels (guard returns before) or unparseable senders (guard returns before diagnostic log).

**Commits:**
- `5d5ab39` test(33-01): add failing tests for post-move logging, duplicate early return, diagnostic logging
- `ce2abe0` feat(33-01): fix processor bugs and add diagnostic logging (D-05, D-06, D-07)

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **Pending activities pattern:** Used `Array<PendingActivity>` to accumulate activities before the move, then flush after. This handles conflict resolution (2 activities) cleanly.
2. **Diagnostic log destination:** Pino structured logging only, not activity log. Diagnostic data is for ops debugging of phantom messages, not user-visible audit trail.
3. **Duplicate + conflict combo:** When both conflict removal and duplicate detection occur, the duplicate path handles flushing all pending conflict activities before returning.

## Verification

- `npx vitest run test/unit/action-folders/processor.test.ts` -- 47 tests, all passing
- All existing tests continue to pass (no regressions)
- New tests cover post-move ordering, failure logging, diagnostic output, and edge cases

## Self-Check: PASSED
