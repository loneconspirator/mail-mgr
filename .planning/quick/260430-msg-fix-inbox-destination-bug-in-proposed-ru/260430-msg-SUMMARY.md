---
phase: 260430-msg
plan: 01
subsystem: tracking
tags: [bug-fix, proposal-quality, destination-resolver, defense-in-depth]
requires: []
provides:
  - INBOX-exclusion-in-DestinationResolver
  - INBOX-short-circuit-in-ProposalStore
  - Soma-cleanup-SQL-artifact
affects:
  - src/tracking/destinations.ts
  - src/tracking/proposals.ts
tech-stack:
  added: []
  patterns:
    - Case-insensitive string compare via toUpperCase() === 'INBOX'
    - Two-layer guard (resolver primary, proposal store belt-and-suspenders)
    - SQL cleanup artifact for out-of-band production DB remediation
key-files:
  created:
    - .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql
  modified:
    - src/tracking/destinations.ts
    - src/tracking/proposals.ts
    - test/unit/tracking/destinations.test.ts
    - test/unit/tracking/proposals.test.ts
decisions:
  - "Guard at TWO layers (resolver + proposal store) — diagnosis recommended Strategy A + B together, not either alone, because resolver-level filter prevents future signal pollution but proposal-store guard catches any other call path that might construct destination='INBOX'"
  - "Case-insensitive guard (toUpperCase() === 'INBOX') instead of strict equality — cheap insurance against non-canonical 'inbox' / 'Inbox' that some IMAP servers might emit"
  - "SQL cleanup is a manual artifact for the user — executor cannot reach Soma (192.168.1.90); the user must SSH and apply against the SQLite DB volume after deploying the new build"
  - "Module-scope isInbox helper instead of class-level — destinations.ts has no other class-level utilities; module scope is cleanest and matches the existing COMMON_FOLDERS pattern"
metrics:
  duration: 2min
  tasks: 3
  files: 5
  completed: 2026-04-30
---

# Phase 260430-msg Plan 01: Fix INBOX-destination bug in proposed rules — Summary

Two-layer guard against semantically-meaningless "move to INBOX" proposed rules: DestinationResolver excludes INBOX from fast-pass and deep-scan candidate sets; ProposalStore.upsertProposal short-circuits when destination=INBOX; plus a SQL cleanup artifact for Soma prod DB remediation.

## What Was Built

### Task 1: DestinationResolver INBOX exclusion (TDD)

- Added module-scope `isInbox(folder)` helper in `src/tracking/destinations.ts` (case-insensitive INBOX check via `toUpperCase()`).
- Updated `resolveFast` (lines 68-94): both candidate-population loops (recentFolders and COMMON_FOLDERS) now filter on `!isInbox(folder)` in addition to the existing `folder !== sourceFolder` check.
- Updated `runDeepScan` (lines 121-127): added an unconditional `if (isInbox(folder.path)) continue;` BEFORE the existing `\Noselect` / sourceFolder / commonSet skips inside the `for (const folder of allFolders)` loop.
- Added 3 new test cases under `describe('INBOX exclusion (260430-msg)')` in `test/unit/tracking/destinations.test.ts`: fast-pass exclusion when getRecentFolders returns INBOX, deep-scan exclusion when listFolders returns INBOX, and lowercase 'inbox' case-insensitive variant.
- TDD flow: RED commit (test only) → GREEN commit (source). All 12 destinations tests pass (9 pre-existing + 3 new).

### Task 2: ProposalStore.upsertProposal INBOX short-circuit (TDD)

- Added early-return guard at the very top of `ProposalStore.upsertProposal` in `src/tracking/proposals.ts` (lines 24-29), BEFORE `normalizedRecipient` computation and BEFORE the `db.transaction` is built/run: `if (destination.toUpperCase() === 'INBOX') return;`.
- Added 3 new test cases under `describe('INBOX guard (260430-msg)')` in `test/unit/tracking/proposals.test.ts`: INBOX no-op, lowercase 'inbox' no-op, and 'Archive' negative-control (proves only INBOX is short-circuited).
- TDD flow: RED commit (test only) → GREEN commit (source). All 21 proposals tests pass (18 pre-existing + 3 new).

### Task 3: Soma cleanup SQL artifact

- Created `.planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql` with header comments documenting where (Soma 192.168.1.90 SQLite DB), when (after new build deployed), what (DELETEs scoped strictly to `destination_folder='INBOX'` against `move_signals` and `proposed_rules`), and a safety protocol (snapshot DB first, optional `SELECT COUNT(*)` probes before DELETE).
- Optional commented case-insensitive variants (`UPPER(destination_folder) = 'INBOX'`) included for paranoia.

## Test Results

| Suite | Files | Tests | New tests added |
| ----- | ----- | ----- | --------------- |
| `npx vitest run test/unit/tracking/destinations.test.ts` | 1 | 12 pass | +3 |
| `npx vitest run test/unit/tracking/proposals.test.ts`    | 1 | 21 pass | +3 |
| `npm run test:unit` (full unit suite)                    | 45 | 787 pass | +6 |

Zero regressions. All pre-existing tests still green.

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| src/tracking/destinations.ts | Added isInbox helper + 2 candidate-loop filters + 1 deep-scan skip | +14 / -3 |
| src/tracking/proposals.ts | Added 5-line INBOX short-circuit at top of upsertProposal | +7 / -0 |
| test/unit/tracking/destinations.test.ts | New describe block with 3 cases | +67 / -0 |
| test/unit/tracking/proposals.test.ts | New describe block with 3 cases | +27 / -0 |
| .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql | New artifact | +41 / -0 (new file) |

## Commits

| # | Hash    | Message |
|---|---------|---------|
| 1 | a69250b | test(260430-msg-01): add failing tests for INBOX exclusion in DestinationResolver |
| 2 | 469af5a | feat(260430-msg-01): exclude INBOX from DestinationResolver candidate sets |
| 3 | a391eb1 | test(260430-msg-02): add failing tests for INBOX short-circuit in upsertProposal |
| 4 | 0a76bd9 | feat(260430-msg-02): short-circuit upsertProposal when destination is INBOX |
| 5 | e532e74 | chore(260430-msg-03): add Soma cleanup SQL artifact for INBOX-destinated rows |

## User Action Required (Soma cleanup)

The executor CANNOT reach Soma's prod DB (192.168.1.90). After deploying the new build to Soma:

1. SSH into Soma.
2. Take a snapshot of the SQLite DB volume.
3. Apply `.planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql` against the DB. Optionally run the SELECT probes inside the file's header comments first to count rows that will be deleted (the original "108 moves to INBOX" proposal should be gone after this).
4. Verify the proposed rules UI no longer shows any INBOX-destinated rows.

## Deviations from Plan

None — plan executed exactly as written.

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None — this change reduces noise/pollution in an existing data path; it does not introduce new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

Verified files exist:

- FOUND: src/tracking/destinations.ts (modified, contains isInbox + filter loops)
- FOUND: src/tracking/proposals.ts (modified, contains INBOX short-circuit)
- FOUND: test/unit/tracking/destinations.test.ts (modified, +67 lines)
- FOUND: test/unit/tracking/proposals.test.ts (modified, +27 lines)
- FOUND: .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql (new file)

Verified commits exist:

- FOUND: a69250b
- FOUND: 469af5a
- FOUND: a391eb1
- FOUND: 0a76bd9
- FOUND: e532e74
