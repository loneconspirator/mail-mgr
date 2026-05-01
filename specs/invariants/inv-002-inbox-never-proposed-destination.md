---
id: INV-002
title: INBOX is never a proposed move destination
enforcement:
  - type: code-discipline
    ref: src/tracking/destinations.ts#isInbox
  - type: code-discipline
    ref: src/tracking/proposals.ts#upsertProposal
  - type: integration-test
    ref: test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts
modules: [MOD-0007, MOD-0009, MOD-0012]
---

## Statement

Any code path that produces a move signal or forms a proposed rule MUST exclude INBOX as the resolved destination, regardless of what `ActivityLog.getRecentFolders()` returns. The check is **case-insensitive**: a folder name MUST be rejected as a routing target whenever `folder.toUpperCase() === 'INBOX'`, so case variants such as `inbox` or `Inbox` are also excluded.

INBOX is the entrance to the system, not a destination users intentionally route mail toward. A "move into INBOX" is at most a one-off manual rescue, never a pattern worth proposing as a rule. This invariant binds:

1. `DestinationResolver.resolveFast` — fast-pass candidate filter (recent + common folder pools).
2. `DestinationResolver.runDeepScan` — per-folder iteration during deep scan.
3. `ProposalStore.upsertProposal` — defensive guard against any signal that slipped past (1) or (2) via a future refactor or alternate signal path.

## Why this exists

A production incident on Soma (192.168.1.90) on 2026-04-30 surfaced the proposed-rules UI showing **"108 moves to INBOX"** for sender `info@e.boynerewards.com`. The diagnosis is documented at `.planning/debug/108-moves-to-inbox-proposed-rule.md`.

Root cause: action-folder operations (`vip`, `undoVip`, `unblock`) legitimately write rows with `activity.folder='INBOX'` to the activity log because that is where the message ends up after the operation. `ActivityLog.getRecentFolders()` then surfaces INBOX as a "popular destination" — which is true mechanically but meaningless as a routing target. With no INBOX filter in `DestinationResolver`, the resolver scanned the **review folder** (not INBOX) for a disappeared message, found a Message-ID match in INBOX (because the original message was still there), and emitted `destination='INBOX'`. After enough such signals, `ProposalStore.upsertProposal` formed the nonsensical "INBOX → INBOX" proposal.

The fix shipped in commits `469af5a` and `0a76bd9` on `main` (quick task 260430-msg). This invariant codifies what the fix enforces so the next refactor doesn't silently re-open the door.

## Enforcement

- **Primary (resolver) — code discipline.** `DestinationResolver` MUST filter INBOX from both candidate pools using the module-scope helper `isInbox(folder)` defined at `src/tracking/destinations.ts:48`. The filter is applied:
  - In `resolveFast` candidate construction for both the recent-folders pool (`src/tracking/destinations.ts:76`) and the common-folders pool (`src/tracking/destinations.ts:81`).
  - In `runDeepScan` per-folder iteration before any other skip predicates (`src/tracking/destinations.ts:125`), so it short-circuits even if an IMAP server has flagged INBOX as `\Noselect` or similar.

- **Defensive (proposal) — code discipline.** `ProposalStore.upsertProposal` MUST early-return without writing when `destination.toUpperCase() === 'INBOX'` (`src/tracking/proposals.ts:27`). This is belt-and-suspenders: the resolver is the primary guard, but any future signal path that bypasses the resolver still cannot form an INBOX proposal.

- **Integration test.** `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` exercises the resolver end-to-end against GreenMail with INBOX seeded into `getRecentFolders()` (the exact condition under which the production bug fired) and asserts that no emitted signal has `destinationFolder === 'INBOX'` and that `resolveFast` never returns INBOX directly. See **IX-003.8**.

## Known violation modes

- **Pre-2026-04-30 `DestinationResolver`** had no INBOX filter. Once any action-folder operation (`vip`, `undoVip`, `unblock`) ran, INBOX entered the resolver candidate pool via `getRecentFolders()`, and any subsequent user move out of a tracked review folder could resolve to INBOX and form a "X → INBOX" proposal. Diagnosed and fixed in `.planning/debug/108-moves-to-inbox-proposed-rule.md` and quick task 260430-msg. No FM is filed because this is a continuously-enforced invariant, not a transient adversarial scenario.
