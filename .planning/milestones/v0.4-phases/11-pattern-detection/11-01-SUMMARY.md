---
phase: 11-pattern-detection
plan: 01
subsystem: tracking
tags: [pattern-detection, proposals, signals, sqlite]
dependency_graph:
  requires: [move_signals table, SignalStore, MoveTracker]
  provides: [ProposalStore, PatternDetector, proposed_rules table, ProposedRule types]
  affects: [src/tracking/index.ts, src/shared/types.ts, src/log/migrations.ts]
tech_stack:
  added: []
  patterns: [read-modify-write transaction, optional dependency injection, TDD red-green]
key_files:
  created:
    - src/tracking/proposals.ts
    - src/tracking/detector.ts
    - test/unit/tracking/proposals.test.ts
    - test/unit/tracking/detector.test.ts
  modified:
    - src/log/migrations.ts
    - src/shared/types.ts
    - src/tracking/index.ts
key_decisions:
  - "Used read-modify-write transaction for upsert instead of INSERT ON CONFLICT (COALESCE in expression index is unreliable)"
  - "PatternDetector is optional dependency on MoveTracker for backward compatibility"
metrics:
  duration: 204s
  completed: 2026-04-13T06:20:38Z
  tasks: 2
  files_created: 4
  files_modified: 3
  tests_added: 21
---

# Phase 11 Plan 01: Pattern Detection Engine Summary

ProposalStore with read-modify-write upsert handling strength tracking, dismissed resurface, and approved-skip; PatternDetector wired into MoveTracker signal path for real-time proposal updates.

## Tasks Completed

| # | Name | Commit | Test |
|---|------|--------|------|
| 1 | Database migration, shared types, ProposalStore with tests | 7de2a83 | 17 pass |
| 2 | PatternDetector class, MoveTracker hook, and tests | 3d9fff4 | 4 pass (49 total tracking) |

## What Was Built

### Migration (20260413_001)
- `proposed_rules` table with sender/envelope_recipient/source_folder composite key
- Unique index using COALESCE for NULL envelope_recipient handling
- Status index for filtering approved proposals

### ProposalStore (`src/tracking/proposals.ts`)
- `upsertProposal()` with read-modify-write in transaction: finds existing by key, skips approved, handles dismissed resurface (flips to active after 5 signals), tracks per-destination counts in JSON, computes dominant destination
- `getProposals()` returns non-approved proposals with computed strength, sorted by strength DESC
- `getById()`, `approveProposal()`, `dismissProposal()` for lifecycle management
- `getExampleSubjects()` joins against move_signals for recent example messages

### PatternDetector (`src/tracking/detector.ts`)
- `processSignal()` extracts ProposalKey from MoveSignal and calls upsertProposal
- Normalizes undefined envelopeRecipient to null

### MoveTracker Integration (`src/tracking/index.ts`)
- Optional `patternDetector` in MoveTrackerDeps interface
- After each signal log, retrieves the full signal and calls processSignal
- Backward compatible -- existing code without patternDetector works unchanged

### Shared Types (`src/shared/types.ts`)
- ProposedRule, ProposalKey, ExampleMessage, ProposedRuleCard interfaces

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-11-01 (SQL injection) | All SQL uses parameterized queries via better-sqlite3 prepared statements |
| T-11-02 (JSON tampering) | JSON.parse wrapped in try/catch with fallback to empty object; JSON.stringify for writes |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx vitest run test/unit/tracking/ --bail 1` -- 49 tests pass (5 suites)
- `npm run build` -- TypeScript compilation succeeds
- ProposalStore handles all lifecycle states: active, approved, dismissed, resurfaced
- PatternDetector is wired into MoveTracker signal path

## Self-Check: PASSED

All created files exist, all commits verified.
