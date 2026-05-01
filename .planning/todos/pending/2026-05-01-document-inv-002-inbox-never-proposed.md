---
title: Document INBOX-never-proposed invariant (INV-002), update MOD-0009 + MOD-0012, enforce in IX-003
created: 2026-05-01
type: docs+test
related:
  - .planning/debug/108-moves-to-inbox-proposed-rule.md
  - .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/260430-msg-SUMMARY.md
priority: medium
estimate: ~30 minutes (no production code changes)
---

# Task: Document INV-002 and enforce in IX-003 integration test

## Context (read these first, do not skim)

A bug shipped on Soma (192.168.1.90) where the proposed-rules UI showed
"108 moves to INBOX" for sender `info@e.boynerewards.com`. Root cause and
fix are documented in:

- `.planning/debug/108-moves-to-inbox-proposed-rule.md` — full diagnosis
- `.planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/260430-msg-SUMMARY.md` — fix summary

**Mechanism:** action-folder operations (`vip`, `undoVip`, `unblock`) write
`folder='INBOX'` rows into the activity log. `getRecentFolders()` then surfaces
INBOX as a candidate, and `DestinationResolver.resolveFast` had no guard
excluding INBOX. When the resolver scanned the **review folder** (not INBOX)
and a message disappeared, it could find a Message-ID match in INBOX and
emit `destination='INBOX'`. After enough such signals,
`ProposalStore.upsertProposal` formed a proposal to "move INBOX → INBOX,"
which is semantically nonsense.

**Fix already shipped** (commits `469af5a`, `0a76bd9` on `main`):
- `src/tracking/destinations.ts:48` — module-scope helper
  `const isInbox = (folder) => folder.toUpperCase() === 'INBOX'`
- `src/tracking/destinations.ts:76,81,125` — applied in `resolveFast`
  candidate filter (recent + common pools) and in `runDeepScan` per-folder loop
- `src/tracking/proposals.ts:27` — `upsertProposal` early-returns when
  `destination.toUpperCase() === 'INBOX'`

Unit tests exist at `test/unit/tracking/destinations.test.ts` and
`test/unit/tracking/proposals.test.ts`. Integration coverage is the gap
this task closes.

## Goal

Codify "INBOX is never a proposed destination" as a first-class spec
invariant (INV-002), update the two affected module specs to reference it,
and add an integration assertion to IX-003 that exercises the resolver
end-to-end through the GreenMail-backed test harness.

## Out of scope

- No production code changes. The fix is already on `main`.
- Do not touch `src/action-folders/` or `src/log/` — the bug was in the
  resolver/proposal layer, not in the upstream activity-log writers.
- Do not add a new failure-mode (FM) doc. This is an invariant the system
  enforces continuously, not a transient adversarial scenario.
- Do not update `specs/architecture.md` — INV-002 is a module-level rule,
  not architecture-level.

## Deliverables

### 1. Create `specs/invariants/inv-002-inbox-never-proposed-destination.md`

Use INV-001 as the formatting template (`specs/invariants/inv-001-imap-idle-returns-to-inbox.md`).
Structure to match:

- Frontmatter:
  - `id: INV-002`
  - `title: INBOX is never a proposed move destination`
  - `enforcement:` two entries:
    - `type: code-discipline` ref `src/tracking/destinations.ts#isInbox`
    - `type: integration-test` ref `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts`
    - `type: code-discipline` ref `src/tracking/proposals.ts#upsertProposal` (defensive guard)
  - `modules: [MOD-0007, MOD-0009, MOD-0012]`
- `## Statement` — one paragraph stating: any path that produces a move
  signal or a proposed rule MUST exclude INBOX as a destination, regardless
  of what `ActivityLog.getRecentFolders()` returns. Be explicit that this
  is case-insensitive (`folder.toUpperCase() === 'INBOX'`) so case variants
  (`inbox`, `Inbox`) are also excluded.
- `## Why this exists` — summarize the production incident (108-moves-to-INBOX
  on Soma, 2026-04-30). Cite the specific upstream cause: action-folder
  operations (`vip`, `undoVip`, `unblock`) legitimately log
  `activity.folder='INBOX'`, which poisons `getRecentFolders()` if not
  filtered downstream. Reference `.planning/debug/108-moves-to-inbox-proposed-rule.md`.
- `## Enforcement` — two layers:
  - **Primary (resolver):** `DestinationResolver` must filter INBOX from
    fast-pass candidates and deep-scan iteration via `isInbox()` at
    `src/tracking/destinations.ts:48`.
  - **Defensive (proposal):** `ProposalStore.upsertProposal` must return
    early when `destination.toUpperCase() === 'INBOX'` so any signal that
    slips through (future refactors, alternate signal paths) cannot form
    a proposal.
- `## Known violation modes` — single bullet pointing at the historical
  incident: pre-2026-04-30 `DestinationResolver` had no INBOX filter; once
  any action-folder operation ran, INBOX entered the resolver candidate pool.

### 2. Update `specs/modules/mod-0009-destination-resolver.md`

- Add `INV-002` to the existing `invariants-enforced` frontmatter list
  (currently `[INV-001]` → `[INV-001, INV-002]`).
- In the `## Notes` section, add a bullet immediately after the existing
  fast-pass note:
  > INBOX is never a candidate destination. Both fast-pass (recent +
  > common folders) and deep-scan iteration filter INBOX via
  > `isInbox(folder)` (case-insensitive). Enforces INV-002.

### 3. Update `specs/modules/mod-0012-proposal-store.md`

- Add `invariants-enforced: [INV-002]` to the frontmatter (replacing the
  current empty `invariants-enforced: []` list).
- In `## Interface Summary`, append to the `upsertProposal` line:
  > Returns early without writing when `destination.toUpperCase() === 'INBOX'`
  > (enforces INV-002 defensively — the resolver is the primary guard).
- Add a bullet to `## Notes`:
  > `upsertProposal` short-circuits when destination is INBOX. This is a
  > defense-in-depth guard; the primary INBOX exclusion lives in MOD-0009
  > (`DestinationResolver`). See INV-002.

### 4. Update `specs/integrations/ix-003-user-move-detection-and-destination-resolution.md`

- Add `INV-002` to a new `invariants-enforced` frontmatter line (the file
  doesn't currently have this field — add it after `use-cases`). The line
  should read: `invariants-enforced: [INV-002]`.
- Append a new named interaction `IX-003.8`:
  > **IX-003.8** — DestinationResolver MUST NOT return INBOX as a
  > destination, even when INBOX appears in the recent-folders pool.
  > Enforces INV-002.
- Update the Postconditions section to add:
  > A confirmed move signal's `destinationFolder` is never INBOX.

### 5. Add IX-003.8 assertion to the integration test

Edit `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts`.

- Update the file header comment block (currently lists IX-003.1 through
  IX-003.7) to include:
  > IX-003.8 — DestinationResolver excludes INBOX from candidates even
  >            when ActivityLog returns INBOX in recent folders (INV-002).
- Add a new `it()` test inside the existing `describe('IX-003 ...')` block.
  Place it after the IX-003.7 (deep-scan miss) test. The test must:
  1. Seed `ActivityLog` with action-folder activities so
     `getRecentFolders()` returns `['INBOX', <reviewFolder>, 'Archive']`
     (or similar — the key is INBOX is in the pool). The seeding pattern
     used elsewhere in this file via `activityLog.logActivity(...)` should
     work; if a quicker shortcut is needed, you can `INSERT` directly into
     the activity table since this is a test.
  2. Send a test message via `sendTestEmail` to a NON-INBOX folder (use
     the existing `REVIEW_FOLDER` pattern from elsewhere in the file).
  3. Plant the same `Message-ID` into INBOX as well (use `sendTestEmail`
     with INBOX as destination, OR an IMAP APPEND helper if one exists in
     `helpers.ts`). This simulates the conditions under which the bug
     surfaced — Message-ID present in both source review folder AND INBOX.
  4. Manually move the message OUT of the review folder (mirroring the
     IX-003.4 fast-pass test pattern). MoveTracker should detect the
     disappearance.
  5. Run the move-tracker tick(s) sufficient to produce a signal.
  6. Assert that the emitted signal's `destinationFolder` is **not** INBOX
     (and not a case variant — assert `.toUpperCase() !== 'INBOX'`). It
     should resolve to a different candidate or be unresolved (null/deep-scan
     queued); both are acceptable, the contract is "never INBOX."
  7. As a secondary assertion, call
     `destinationResolver.resolveFast(messageId, REVIEW_FOLDER)` directly
     with the seeded recent-folders state and assert the return value is
     never `'INBOX'` (case-insensitive).

  The test must use real components — no mocking of DestinationResolver
  or ActivityLog. This file's whole convention is real-component wiring
  via GreenMail. Match it.

### 6. Verify

Run the affected tests:

```bash
npm run test:unit -- test/unit/tracking/
npm run test:integration -- test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts
```

Both must pass. The integration test gates on GreenMail being up — see
`test/integration/global-setup.ts` and `helpers.ts:assertGreenMailRunning`
for how the existing tests handle that.

### 7. Commit

Two commits, in this order, on `main` (or a quick-task branch — your call):

1. `docs(specs): add INV-002 (INBOX never proposed), update MOD-0009/MOD-0012/IX-003`
   - Files: `specs/invariants/inv-002-*.md`, `specs/modules/mod-0009-*.md`,
     `specs/modules/mod-0012-*.md`, `specs/integrations/ix-003-*.md`
2. `test(IX-003.8): assert INBOX never resolved as destination`
   - File: `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts`

## Acceptance criteria (grep-verifiable)

- [ ] `specs/invariants/inv-002-inbox-never-proposed-destination.md` exists.
- [ ] `grep -l "INV-002" specs/modules/mod-0009-destination-resolver.md` matches.
- [ ] `grep -l "INV-002" specs/modules/mod-0012-proposal-store.md` matches.
- [ ] `grep -l "IX-003.8" specs/integrations/ix-003-user-move-detection-and-destination-resolution.md` matches.
- [ ] `grep -l "IX-003.8" test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` matches.
- [ ] `npm run test:unit` exits 0.
- [ ] `npm run test:integration -- test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` exits 0.

## Notes for the implementer

- **Don't change production code.** If during implementation you find the
  `isInbox` helper or the `upsertProposal` guard could be tightened,
  open a separate task. This task is about codifying what's already there.
- **Use INV-001 as your formatting reference**, not freeform prose. The
  invariant docs follow a specific structure that downstream agents
  (gsd-verifier, gsd-plan-checker) parse.
- **The integration test is the load-bearing deliverable.** Spec updates
  without the test are documentation-only and rot. The test is what
  prevents regression.
- **Frontmatter `invariants-enforced` is a real index.** Other tooling
  greps it. Keep it sorted and bracketed (`[INV-001, INV-002]`).
