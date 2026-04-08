---
phase: 03-batch-filing-engine
plan: 01
subsystem: batch-engine
tags: [batch, tdd, domain-logic, state-machine]
dependency_graph:
  requires: [rules-evaluator, actions-executor, imap-messages]
  provides: [batch-engine, batch-types]
  affects: [activity-log]
tech_stack:
  added: []
  patterns: [chunked-processing, cooperative-cancellation, dry-run-preview, state-machine]
key_files:
  created:
    - src/batch/index.ts
    - test/unit/batch/engine.test.ts
  modified: []
decisions:
  - Used type assertion for 'batch' source tag in logActivity (actual union type update deferred to Plan 02)
  - CHUNK_SIZE=25 as module-level constant matching research recommendation
metrics:
  duration: 144s
  completed: "2026-04-08T05:49:30Z"
  tasks_completed: 1
  tasks_total: 1
  test_count: 25
  files_created: 2
---

# Phase 03 Plan 01: BatchEngine Core Domain Engine Summary

BatchEngine class with TDD-driven chunked processing, dry-run preview grouping, cooperative cancellation, and per-message error isolation using 25-message chunks with setImmediate yields.

## What Was Built

### BatchEngine (`src/batch/index.ts`)

Core domain class for retroactive rule application against all messages in a source folder.

**State machine:** idle -> dry-running -> previewing (or error) for dry runs; idle -> executing -> completed/cancelled/error for execution.

**Key methods:**
- `dryRun(sourceFolder)` - Evaluates all messages against rules, groups results by destination/action type with per-message detail (uid, from, subject, date, ruleName). No IMAP mutations.
- `execute(sourceFolder)` - Fetches all messages, processes in chunks of 25 with `setImmediate` yields between chunks. Per-message errors are counted but never abort the batch.
- `cancel()` - Sets a flag checked between chunks. Already-moved messages are not undone.
- `getState()` - Returns a shallow copy of current state with progress counters.
- `updateRules(rules)` - Hot-swaps the rule array.

**Exported types:** `BatchEngine`, `BatchDeps`, `BatchState`, `BatchStatus`, `DryRunGroup`, `DryRunMessage`, `BatchResult`

### Tests (`test/unit/batch/engine.test.ts`)

25 test cases covering:
- BATC-01: Evaluates all messages in source folder
- BATC-02: First-match-wins without age constraints
- BATC-03: Chunked execution with per-message error isolation
- BATC-05: Cancel stops after current chunk
- BATC-06: Dry-run mode with grouped results
- State machine transitions
- Running guard prevents concurrent operations
- logActivity called with 'batch' source

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 8c199ef | test | Add failing tests for BatchEngine (TDD RED) |
| f4ad7da | feat | Implement BatchEngine with full functionality (TDD GREEN) |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
