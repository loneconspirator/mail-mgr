---
phase: 28-sentinel-planting-lifecycle
plan: 01
subsystem: sentinel
tags: [sentinel, lifecycle, tdd, planting, reconciliation]
dependency_graph:
  requires: [sentinel-store, sentinel-imap-ops, sentinel-format, config-schema]
  provides: [collectTrackedFolders, reconcileSentinels]
  affects: [sentinel-barrel-index]
tech_stack:
  added: []
  patterns: [pure-function-config-extraction, diff-and-reconcile, per-item-error-isolation]
key_files:
  created:
    - src/sentinel/lifecycle.ts
    - test/unit/sentinel/lifecycle.test.ts
  modified:
    - src/sentinel/index.ts
decisions:
  - "Rules processed before review/sweep/action folders for first-purpose-wins ordering"
  - "Logger interface uses structured logging (obj + msg) matching pino conventions"
  - "Store-only cleanup when IMAP findSentinel returns undefined for orphans"
metrics:
  duration: "3m 38s"
  completed: "2026-04-22T04:05:51Z"
  tasks: 2
  files_created: 2
  files_modified: 1
  test_count: 20
  lines_added: 449
---

# Phase 28 Plan 01: Sentinel Lifecycle Core Summary

collectTrackedFolders enumerates folders from rules/review/sweep/action-folders config; reconcileSentinels diffs tracked vs store and plants/removes with per-folder error isolation.

## What Was Built

### collectTrackedFolders(config: Config): Map<string, FolderPurpose>
Pure function that extracts all folders needing sentinel tracking from a Config object. Sources: enabled move/review rules, review.folder, review.defaultArchiveFolder, and actionFolders (when enabled). INBOX is always excluded. First-purpose-wins deduplication ensures each folder path maps to exactly one purpose.

### reconcileSentinels(tracked, store, client, logger): Promise<{planted, removed, errors}>
Async function that diffs a tracked folder map against the SentinelStore, calling appendSentinel for missing folders and findSentinel+deleteSentinel for orphaned ones. Per-folder try/catch ensures one IMAP failure doesn't abort the entire reconciliation (mitigates T-28-02). When an orphaned sentinel isn't found on IMAP, falls back to store-only cleanup via deleteByMessageId.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 888648a | TDD collectTrackedFolders - 11 test cases |
| 2 | a53757b | TDD reconcileSentinels - 9 test cases with error isolation |
| - | d18607c | Export lifecycle functions from sentinel barrel |

## Test Results

- 20 new tests in test/unit/sentinel/lifecycle.test.ts
- 80 total sentinel tests passing (lifecycle + format + imap-ops + store)
- Pre-existing frontend test failures (test/unit/web/frontend.test.ts) unrelated to this plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Barrel export for lifecycle functions**
- **Found during:** Post-Task 2 verification
- **Issue:** New lifecycle.ts functions were not exported from sentinel/index.ts barrel
- **Fix:** Added `export { collectTrackedFolders, reconcileSentinels } from './lifecycle.js'`
- **Files modified:** src/sentinel/index.ts
- **Commit:** d18607c

## Known Stubs

None - both functions are fully implemented with no placeholder logic.
