---
quick-id: 260501-ej8
title: Document INV-002 (INBOX never proposed) and enforce in IX-003
type: docs+test
todo-source: .planning/todos/pending/2026-05-01-document-inv-002-inbox-never-proposed.md
key-files:
  created:
    - specs/invariants/inv-002-inbox-never-proposed-destination.md
  modified:
    - specs/modules/mod-0009-destination-resolver.md
    - specs/modules/mod-0012-proposal-store.md
    - specs/integrations/ix-003-user-move-detection-and-destination-resolution.md
    - test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts
commits:
  - 79671e7 docs(specs): add INV-002 (INBOX never proposed), update MOD-0009/MOD-0012/IX-003
  - c31d478 test(IX-003.8): assert INBOX never resolved as destination
metrics:
  duration: ~25 minutes
  completed-date: 2026-05-01
---

# Quick Task 260501-ej8: Document INV-002 + Enforce in IX-003 — Summary

## One-liner

Codified "INBOX is never a proposed destination" as INV-002 (with cross-links into MOD-0009, MOD-0012, IX-003) and added an integration test that reproduces the exact 260430-msg poisoned-recent-folders state to prevent regression.

## What was done

### Task 1 — Spec docs (commit 79671e7)

Created INV-002 spec document modeled on INV-001's structure:

- `specs/invariants/inv-002-inbox-never-proposed-destination.md` — id `INV-002`, title `INBOX is never a proposed move destination`, three `enforcement` entries (two `code-discipline` refs to `src/tracking/destinations.ts#isInbox` and `src/tracking/proposals.ts#upsertProposal`, one `integration-test` ref to the IX-003 test file), `modules: [MOD-0007, MOD-0009, MOD-0012]`, full Statement / Why / Enforcement / Known violation modes sections referencing the 260430-msg incident and `.planning/debug/108-moves-to-inbox-proposed-rule.md`.

Updated three downstream specs to keep the bidirectional INV index consistent (which `validate-invariant` greps):

- `specs/modules/mod-0009-destination-resolver.md` — `invariants-enforced: [INV-001]` → `[INV-001, INV-002]`; added a Notes bullet describing the case-insensitive INBOX filter applied via `isInbox(folder)` in both fast-pass and deep-scan paths.
- `specs/modules/mod-0012-proposal-store.md` — `invariants-enforced: []` → `[INV-002]`; extended the `upsertProposal` Interface Summary line to call out the `destination.toUpperCase() === 'INBOX'` early-return; added a Notes bullet noting this is defense-in-depth and the primary guard lives in MOD-0009.
- `specs/integrations/ix-003-user-move-detection-and-destination-resolution.md` — added `invariants-enforced: [INV-002]` frontmatter; added `IX-003.8` named interaction; added postcondition asserting confirmed move signals never carry `destinationFolder === 'INBOX'`.

### Task 2 — Integration assertion (commit c31d478)

Added `IX-003.8` test to `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts`:

- Updated the file header comment block to list IX-003.8 alongside .1–.7.
- Added a new `copyMessage(fromFolder, toFolder, uid)` helper alongside the existing `userMovesMessage` / `permanentlyDelete` helpers. Uses an independent ImapFlow connection (so the copy doesn't pass through ActivityLog, mirroring the existing `userMovesMessage` pattern).
- Added a new `it('IX-003.8 ...')` test case after the IX-003.7 test inside the existing describe block.

The test reproduces the production bug's preconditions:

1. Seeds ActivityLog with `INSERT INTO activity (..., folder='INBOX', source='action-folder')` rows so `getRecentFolders(10)` includes INBOX (sanity-asserted).
2. Sends a message to INBOX via `sendTestEmail`, then `copyMessage('INBOX', REVIEW_FOLDER, uid)` so the same Message-ID exists in both INBOX and REVIEW.
3. Runs a baseline scan, then `userMovesMessage(REVIEW_FOLDER, FAST_DEST, uid)` — INBOX copy stays put.
4. Runs two more scans to drive the two-scan confirmation; the resolver fires.
5. Primary assertion: any signal in `signalStore.getSignals()` AND any signal returned by `getSignalByMessageId(messageId)` MUST have `destinationFolder.toUpperCase() !== 'INBOX'`.
6. Secondary assertion: calls `destinationResolver.resolveFast(messageId, REVIEW_FOLDER)` directly and asserts the return value (when non-null) has `.toUpperCase() !== 'INBOX'`.

No mocks of any unit under test — matches the existing IX-003.1–IX-003.7 real-component pattern via the GreenMail harness.

## Verification

All grep-verifiable acceptance criteria from the todo passed:

```
specs/invariants/inv-002-inbox-never-proposed-destination.md            (exists)
grep -l "INV-002"  specs/modules/mod-0009-destination-resolver.md       (matches)
grep -l "INV-002"  specs/modules/mod-0012-proposal-store.md             (matches)
grep -l "IX-003.8" specs/integrations/ix-003-...md                      (matches)
grep -l "IX-003.8" test/integration/ix-003-...test.ts                   (matches)
```

Test runs:

- `npm run test:unit -- test/unit/tracking/` — 57/57 pass (5 files: proposals, tracker, signals, destinations, detector).
- `npm run test:integration -- test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` — **8/8 pass** (was 7 before this task; IX-003.8 is the new one).

## Deviations from plan

### None for the plan itself

The plan executed exactly as written. INV-002 mirrors INV-001's structure, all four spec files updated atomically in one commit, the integration test landed in a separate commit per the plan's commit-ordering requirement, and both commit messages match the constraint-specified strings exactly.

### Pre-existing failures discovered (out of scope)

Running the full `npm run test:unit` surfaced 7 pre-existing failures in `test/unit/web/frontend.test.ts` (all "expected 404 to be 200" for `/app.js`, `/app.css`, etc. — frontend bundle not built in this worktree). Verified pre-existing by stashing my changes and re-running at commit 79671e7 (Task 1 only): same 7 failures, same line numbers. Filed as a deferred item at `.planning/quick/260501-ej8-document-inv-002-inbox-never-proposed-an/deferred-items.md`. Not caused by this task; outside its docs+test scope.

### Worktree base reset (pre-execution housekeeping)

The `<worktree_branch_check>` initial check found `git merge-base HEAD c04478a` returned `e38a7a5` (older), so I ran `git reset --soft c04478a0...` per the documented Windows-edge-case fix, then `git stash` + `git stash drop` to discard stale working-tree state from a previous worktree session. After cleanup, the working tree at `c04478a` was clean and matched the expected baseline (the todo file at `.planning/todos/pending/2026-05-01-document-inv-002-inbox-never-proposed.md` was present, `specs/invariants/` contained only `inv-001-...`, etc.). All subsequent work proceeded on this clean baseline.

## Decisions made

- **Used `messageCopy` (not IMAP APPEND) to plant the same Message-ID into INBOX and REVIEW.** APPEND would require synthesizing a raw RFC 822 message body and computing a Message-ID — fragile and error-prone. Copying from INBOX to REVIEW with `messageCopy` produces two folder entries that share the original SMTP-assigned Message-ID, which is exactly the production-bug condition.
- **Test asserts a contract, not a specific destination.** The test's primary assertion is `destinationFolder !== 'INBOX'`, not `destinationFolder === 'Archive'`. INV-002 says "never INBOX" — it does NOT mandate any particular alternate. If a future refactor changes which folder the resolver picks, the test should still pass as long as the INBOX exclusion holds.
- **Three `enforcement` entries on INV-002, not two.** The todo's example showed two (resolver code + integration test), but the resolver fix touches `isInbox` AND `upsertProposal` — both are `code-discipline` references to specific symbols. I included both because `validate-invariant` checks every `enforcement[].ref` for back-link, and we want both code paths registered. The integration test is the third entry.

## Threat flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. This task only adds documentation and one test case; the production code paths it documents have been on `main` since 260430-msg.

## Known stubs

None. This task introduces no UI rendering and no placeholder data flows.

## Self-Check: PASSED

**Files created (verified on disk):**

- `specs/invariants/inv-002-inbox-never-proposed-destination.md` — FOUND

**Files modified (verified by grep):**

- `specs/modules/mod-0009-destination-resolver.md` — INV-002 present
- `specs/modules/mod-0012-proposal-store.md` — INV-002 present
- `specs/integrations/ix-003-user-move-detection-and-destination-resolution.md` — IX-003.8 present
- `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` — IX-003.8 present

**Commits (verified by `git log`):**

- 79671e7 — FOUND (`docs(specs): add INV-002 ...`)
- c31d478 — FOUND (`test(IX-003.8): assert INBOX never resolved as destination`)

**Test runs:**

- Tracking unit tests: 57/57 PASS
- IX-003 integration test: 8/8 PASS (new IX-003.8 included)
