---
phase: 260429-d4a
plan: 01
subsystem: testing / integrations
tags: [integration-test, ix-003, move-tracker, destination-resolver, validate]
requires: [MoveTracker, DestinationResolver, SignalStore, ActivityLog, ImapClient, GreenMail]
provides: [test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts]
affects: [specs/integrations/ix-003-user-move-detection-and-destination-resolution.md]
tech-stack:
  added: []
  patterns: [real-greenmail-integration, two-scan-confirmation, fast-pass-vs-deep-scan]
key-files:
  created:
    - test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts
    - .planning/todos/done/2026-04-29-wire-ix-003-integration-test.md
  modified:
    - specs/integrations/ix-003-user-move-detection-and-destination-resolution.md
  removed:
    - .planning/todos/pending/2026-04-29-wire-ix-003-integration-test.md
decisions:
  - "Use 'Archive' (first COMMON_FOLDERS entry) for fast-pass coverage so resolveFast hits on the first iteration."
  - "Use 'CustomerProj' (not in COMMON_FOLDERS, not in activity log) for fast-pass-miss + deep-scan coverage."
  - "User-move helper uses an INDEPENDENT ImapFlow connection so the move never enters our ActivityLog — that is what makes isSystemMove() return false (the IX-003.3 discriminator)."
  - "Fetch by specific UID via string range (`fetch(uid+'')`) rather than array (`fetch([uid])`) — array form hung at 30s on GreenMail's high-UID INBOX (counter in the thousands)."
metrics:
  duration: ~30 minutes
  completed: 2026-04-29
---

# Phase 260429-d4a Plan 01: Wire IX-003 Integration Test Summary

Add a dedicated integration test for IX-003 (user move detection and destination resolution) that exercises all 7 named interactions against real GreenMail with the real MoveTracker / DestinationResolver / SignalStore / ActivityLog / ImapClient stack — no mocks of the units under test. Wire the spec frontmatter to point at it, close the todo, and confirm `/validate IX-003` transitions from WARN (`IX-INTEGRATION-TEST-UNSET` + `IX-NAMED-INTERACTIONS-WITHOUT-TEST`) to PASS.

## What Was Built

`test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` — 7 `it('IX-003.N: ...')` blocks, one per named interaction, all driving a single shared bring-up:

| Interaction | What the test asserts | Destination |
|---|---|---|
| IX-003.1 | UID snapshot diff detects a disappearance after one scan; no signal yet, no deep-scan queue | Archive |
| IX-003.2 | Two-scan confirmation: reappearance cancels (a); user-move + 2 scans confirms (b) | Archive |
| IX-003.3 | Pre-seeded system-move row in activity log → `isSystemMove(messageId) === true` → tracker skips the disappearance entirely (no signal, no pending) | Archive |
| IX-003.4 | Fast-pass resolver hits 'Archive' (first COMMON_FOLDER), signal logged, nothing queued for deep scan | Archive |
| IX-003.5 | Move to 'CustomerProj' (NOT in COMMON_FOLDERS, NOT in activity-log recents) → fast-pass returns null → message enqueued for deep scan, signalsLogged still 0 | CustomerProj |
| IX-003.6 | Confirmed move emits a signal carrying messageId, sender, subject, readStatus='unread', sourceFolder='INBOX', destinationFolder='Archive'; envelopeRecipient + listId remain undefined (envelopeHeader not configured — IX-004 territory) | Archive |
| IX-003.7 | Queue for deep scan, then physically delete the message from CustomerProj; `triggerDeepScan()` does NOT throw, returns `{ resolved: 0 }`, drops the pending entry, signalsLogged stays 0 | CustomerProj |

### Common-folder pick

- **Fast-pass coverage:** `Archive` — first entry in `COMMON_FOLDERS` in `src/tracking/destinations.ts`. Gives a deterministic single-iteration fast-pass success.
- **Deep-scan coverage:** `CustomerProj` — flat name (no '/' delimiter), not in `COMMON_FOLDERS`, not in `ActivityLog.getRecentFolders()` (the activity log is empty per fresh tempDir), so fast-pass cannot find it. Deep-scan finds it on a full mailbox listing — or, in IX-003.7, doesn't, when the message has been permanently deleted.

## Validate-Integration Verdict

| | Before | After |
|---|---|---|
| `IX-INTEGRATION-TEST-UNSET` | WARN | cleared |
| `IX-NAMED-INTERACTIONS-WITHOUT-TEST` | WARN | cleared |
| `IX-NAMED-INTERACTION-NOT-IN-TEST` | n/a (skipped because no test) | none |
| `IX-NAMED-INTERACTION-NOT-IMPLEMENTED` | n/a | none |
| Exit code | 0 (warnings only) | 0 (clean — `findings: []`) |
| `npx vitest run …ix-003…` | n/a | 7/7 pass in ~500-900ms |

`npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-003` returns:
```json
{ "integration": "IX-003", ..., "findings": [] }
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `fetch([uid], …)` hung 30s on GreenMail's high-UID INBOX**
- **Found during:** Task 1, first test run — IX-003.3, IX-003.4, IX-003.6 all timed out at 30s while waiting on `getMessageIdForUid()`.
- **Issue:** Calling `imapflow.fetch([uid], { uid: true, envelope: true }, { uid: true })` against an INBOX whose UID counter is in the thousands (GreenMail accumulates state across test runs in the same container) returned an async iterator that never produced a message and never closed. UID 2573 was assigned to a newly-delivered message; the array-form `[2573]` apparently caused ImapFlow to wait indefinitely.
- **Fix:** Switched to the string range form `fetch(`${uid}`, { uid: true, envelope: true }, { uid: true })`. Iterator yields immediately and closes cleanly. Documented the gotcha inline so the next test author doesn't trip on it.
- **Commit:** 7c3b017 (Task 1 — the fix landed in the same commit as the test author since the 30s hang was discovered while authoring the test, before the first commit).

**2. [Rule 3 — Blocking] Worktree was created from a stale base commit**
- **Found during:** Pre-flight worktree branch check.
- **Issue:** The agent worktree's HEAD was at `e38a7a5` (from before v0.7 milestone work), while the orchestrator's expected base was `477e821`. A long list of files appeared as deleted/modified after `git reset --soft 477e821` because the worktree filesystem hadn't been updated.
- **Fix:** `git reset --hard 477e821` to bring the working tree in sync. Confirmed clean status before starting the plan. No work was lost (the working tree had no uncommitted changes; the soft reset's "diff" was purely the gap between e38a7a5 and 477e821).

### Rule 4 (Architectural) — None

No architectural decisions surfaced. The test fits the existing `test/integration/` pattern.

## Auth Gates

None — GreenMail was already running on port 3143 before plan execution; no credentials required (test fixtures use `user:pass`).

## Deferred Issues / Out-of-Scope Notes

- **GreenMail container leftover state.** The dev-env container has accumulated mailbox state across runs (UIDs in the 2500+ range, ~26 folders including remnants from prior test runs like `Triage005g`, `CustomArchive`). The IX-003 test handles this by clearing INBOX in `beforeEach` (via `clearMailboxes()`) and wiping its destination folders post-bring-up. A periodic `scripts/dev-env/reset.sh` or a fresh container would be cleaner but is out of scope for this todo.
- **No test for IX-003.5 ↔ IX-003.7 interaction with COMMON_FOLDERS dedup.** The deep-scan in `runDeepScan()` skips folders already checked in fast-pass via a `commonSet` filter. The current IX-003.7 test relies on the message being deleted entirely, not on dedup logic. This is fine for IX-003.7 (the named interaction is "deep-scan miss drops"), but a future regression test could exercise the dedup edge.
- **`IX-ARCHITECTURE-NOT-LINKED-BACK` style warnings.** None surfaced for IX-003 in this validator run (`findings: []`), so no architecture follow-up is needed for this todo.

## Self-Check: PASSED

- File `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` exists.
- File `.planning/todos/done/2026-04-29-wire-ix-003-integration-test.md` exists.
- File `.planning/todos/pending/2026-04-29-wire-ix-003-integration-test.md` is gone (per `git status` — rename detected).
- Spec `specs/integrations/ix-003-user-move-detection-and-destination-resolution.md` line 4 reads `integration-test: test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts`.
- Commit 7c3b017 contains the new test file.
- Commit 2089921 contains the spec edit + the todo rename.
- `npx vitest run test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` → 7/7 pass.
- `npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-003` → exit 0, `findings: []`.
