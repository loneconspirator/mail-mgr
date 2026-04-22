---
phase: 29-pipeline-guards
plan: 02
subsystem: pipeline-guards
tags: [sentinel, guard, imap, processor, tdd]
dependency_graph:
  requires: [29-01]
  provides: [sentinel-guards-all-processors]
  affects: [action-folders, monitor, sweep, batch, tracking]
tech_stack:
  added: []
  patterns: [early-exit-guard, header-detection]
key_files:
  created: []
  modified:
    - src/action-folders/processor.ts
    - src/monitor/index.ts
    - src/sweep/index.ts
    - src/batch/index.ts
    - src/tracking/index.ts
    - test/unit/action-folders/processor.test.ts
    - test/unit/monitor/monitor.test.ts
    - test/unit/sweep/sweep.test.ts
    - test/unit/batch/engine.test.ts
    - test/unit/tracking/tracker.test.ts
decisions:
  - Tracker uses SENTINEL_HEADER constant with parseHeaderLines instead of isSentinelRaw for consistency with existing header parsing
  - Tracker always fetches X-Mail-Mgr-Sentinel header unconditionally (not gated behind envelopeHeader config)
  - Batch sentinel guard placed before reviewMessageToEmailMessage conversion to avoid unnecessary work
metrics:
  duration: 5m
  completed: 2026-04-22T04:55:30Z
  tasks_completed: 2
  tasks_total: 2
  test_count: 8
  files_modified: 10
---

# Phase 29 Plan 02: Pipeline Sentinel Guards Summary

Sentinel header guards added to all 5 message processors preventing sentinel tracking messages from triggering business logic.

## One-liner

Early-exit guards using isSentinel() in all 5 processors (action-folder, monitor, sweep, batch, tracker) with TDD test coverage.

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Sentinel guards for action folder processor and monitor | 3db92f0 | Guard before extractSender returns {ok:true, sender:'sentinel'}; guard before evaluateRules returns void |
| 2 | Sentinel guards for sweeper, batch engine, and move tracker | e2041f9 | continue in sweep loop; continue in both dryRun/execute batch loops; exclude from tracker snapshot with unconditional header fetch |

## Implementation Details

### GUARD-01: Action Folder Processor
- Import `isSentinel` from sentinel barrel
- Guard as first line of `processMessage()` before `ACTION_REGISTRY` lookup
- Returns `{ ok: true, action: actionType, sender: 'sentinel' }` -- safe for poller which only checks `ok`

### GUARD-02: Monitor
- Import `isSentinel` from sentinel barrel
- Guard in private `processMessage()` before `evaluateRules` call
- Returns void immediately; message not counted in `messagesProcessed`

### GUARD-03: Review Sweeper
- Import `isSentinel` from sentinel barrel
- Guard in `runSweep()` loop before `isEligibleForSweep` check
- Uses `continue` to skip sentinel messages silently

### GUARD-04: Batch Engine
- Import `isSentinel` from sentinel barrel
- Guard in `dryRun()` loop before `reviewMessageToEmailMessage` conversion
- Guard in `execute()` chunk loop before `reviewMessageToEmailMessage` conversion

### GUARD-05: Move Tracker
- Import `SENTINEL_HEADER` from sentinel barrel
- Always fetches `X-Mail-Mgr-Sentinel` header (unconditional, not gated on envelopeHeader)
- Parses headers with `parseHeaderLines` and checks `hdrs.has(SENTINEL_HEADER)` before building tracked object
- Sentinel UIDs excluded from snapshot map, preventing false disappearance signals

## Test Coverage

- 3 new processor tests: sentinel guard returns early, normal processing with non-sentinel headers, normal processing with undefined headers
- 1 new monitor test: sentinel message skipped without rule evaluation or activity logging
- 1 new sweep test: sentinel in message list skipped, only normal messages swept
- 2 new batch tests: sentinel excluded from dryRun groups, sentinel skipped in execute loop
- 1 new tracker test: sentinel message excluded from folder snapshot (messagesTracked count)

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All 704 non-frontend tests pass (7 pre-existing frontend build failures unrelated to this plan)
- Each processor file contains `isSentinel` or `SENTINEL_HEADER` import and guard check
- Sentinel messages trigger no business logic in any processor

## Self-Check: PASSED
