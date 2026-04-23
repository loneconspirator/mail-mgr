---
phase: 30-scanning-rename-detection
plan: 01
subsystem: sentinel-scanner
tags: [sentinel, scanner, imap, rename-detection, tdd]
dependency_graph:
  requires: [sentinel-store, sentinel-imap-ops, imap-client]
  provides: [sentinel-scanner]
  affects: [phase-31-auto-healing]
tech_stack:
  added: []
  patterns: [discriminated-union, move-tracker-lifecycle, two-tier-scan]
key_files:
  created:
    - src/sentinel/scanner.ts
    - test/unit/sentinel/scanner.test.ts
  modified: []
decisions:
  - "ScanReport returned from runScanForTest for direct test access rather than only via callback"
  - "Lazy-load folder list on first deep scan to avoid unnecessary listMailboxes calls when all sentinels are in place"
  - "Per-folder error handling in deep scan increments error counter and continues rather than aborting"
metrics:
  duration: 184s
  completed: 2026-04-22
  tasks: 1/1
  tests: 28
---

# Phase 30 Plan 01: SentinelScanner Core Logic Summary

TDD implementation of SentinelScanner class with two-tier IMAP scanning (fast-path + deep scan), MoveTracker-pattern lifecycle, and discriminated union result types for folder rename detection.

## What Was Built

### SentinelScanner class (`src/sentinel/scanner.ts`)

- **Type system:** `ScanResult` discriminated union with three variants (`found-in-place`, `found-in-different-folder`, `not-found`) and `ScanReport` aggregate type
- **Fast-path scan:** Checks each sentinel's expected folder via `findSentinel()` header search
- **Deep scan:** When fast-path misses, searches all IMAP folders (filtering INBOX, skipping already-checked expected folder) with short-circuit on first match
- **Lifecycle:** `start()/stop()/getState()/runScanForTest()` following MoveTracker pattern with fire-and-forget initial scan and configurable interval
- **Guards:** Running guard prevents concurrent scans; client.state check skips disconnected state
- **Error handling:** Per-folder errors during deep scan are caught and counted; transient IMAP errors (NoConnection, ETIMEOUT) logged at debug level
- **Detection only:** Scanner never mutates SentinelStore (no upsert/update/delete calls)
- **Callback:** Optional `onScanComplete` callback receives `ScanReport` after each scan

### Test suite (`test/unit/sentinel/scanner.test.ts`)

28 tests covering all behaviors: type correctness, fast-path, deep scan with short-circuit, INBOX filtering, timer lifecycle, running guard, transient error handling, detection-only constraint, and onScanComplete callback.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 6248b6f | test | Add failing tests for SentinelScanner (RED phase) |
| a8a8672 | feat | Implement SentinelScanner with two-tier scan and timer lifecycle (GREEN phase) |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
