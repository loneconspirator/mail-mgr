---
phase: quick-260501-ewi
plan: 01
subsystem: testing
tags: [vitest, sqlite, integration-test, ix-004, proposal-state-machine]

requires:
  - phase: quick-260429-d4a
    provides: IX-003 integration test wiring established the IX-### test pattern for the validate-integration skill
provides:
  - Dedicated IX-004 integration test exercising the proposal upsert state machine
  - IX-004 spec frontmatter wired to the new test path
  - Closes IX-INTEGRATION-TEST-UNSET + IX-NAMED-INTERACTIONS-WITHOUT-TEST warnings on IX-004
affects: [ix-005, ix-012, mod-0010, mod-0011, mod-0012]

tech-stack:
  added: []
  patterns:
    - "IX-### integration test for pure persistence/state-machine logic uses IX-012 harness pattern (real SQLite, no IMAP/Fastify) — not the IX-003 IMAP-driven pattern"
    - "Each it() block name starts with IX-###.N: prefix so validate-integration's name-presence check is satisfied outside stub declarations"
    - "vi.spyOn against the unit under test for handoff-seam interactions — exercises the wiring contract without booting upstream collaborators"

key-files:
  created:
    - test/integration/ix-004-signal-logging-and-proposal-creation.test.ts
  modified:
    - specs/integrations/ix-004-signal-logging-and-proposal-creation.md

key-decisions:
  - "IX-004.1 tested via vi.spyOn(patternDetector, 'processSignal') instead of booting MoveTracker — IX-004's preconditions assume IX-003 has already produced a confirmed signal, so the test starts at the SignalStore.logSignal -> PatternDetector.processSignal handoff seam. Booting MoveTracker would require ImapClient + GreenMail + scan loop, all of which are IX-003 territory."
  - "IX-004.5 strength-label progression asserted via the numeric strength field on ProposedRule (matching_count - contradicting_count). The Weak/Moderate/Strong label is a UI projection of this field; asserting the underlying numeric is the testable contract."
  - "IX-004.7 drives exactly 5 post-dismiss signals to trigger the resurfacing flip (threshold is signals_since_dismiss >= 5). The test asserts signals_since_dismiss is preserved on flip (not reset), per ProposalStore source."
  - "IX-004.8 uses snapshot-comparison on the counter columns (matching_count, contradicting_count, destination_counts, destination_folder, updated_at) to assert byte-identity after 3 post-approval signals — upsertProposal early-returns before any UPDATE on approved rows."

patterns-established:
  - "Per-test mkdtempSync + ActivityLog + SignalStore + ProposalStore + PatternDetector harness for IX-004-style state-machine tests"
  - "Direct SQLite SELECT * FROM table WHERE id = ? for assertion granularity beyond what the public store API exposes"

requirements-completed: [IX-004.1, IX-004.2, IX-004.3, IX-004.4, IX-004.5, IX-004.6, IX-004.7, IX-004.8]

duration: ~10min
completed: 2026-05-01
---

# Quick Task 260501-ewi: Wire IX-004 Integration Test Summary

**Eight named-interaction it() blocks in test/integration/ix-004-signal-logging-and-proposal-creation.test.ts, driven by real SQLite-backed SignalStore + ProposalStore + PatternDetector — flips /validate IX-004 verdict from WARN to PASS.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-01T17:46:00Z (approx)
- **Completed:** 2026-05-01T17:56:00Z (approx)
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 edited)

## Accomplishments

- Added 8 it() blocks named `IX-004.1:` through `IX-004.8:` covering the full proposal upsert state machine — create-on-first-signal, same-destination increment with strength progression, contradicting-destination with incumbent-tie behavior, dismissed-resurface (signals_since_dismiss++ -> >=5 flips active), and approved-noop.
- All 8 blocks pass first try against real ActivityLog (per-test temp SQLite), real SignalStore, real ProposalStore, real PatternDetector. No mocks of units under test.
- Wired the IX-004 spec frontmatter `integration-test:` field to the new test path; the deterministic validator now reports zero findings (was 2 warnings).

## Task Commits

1. **Task 1: Author test/integration/ix-004-signal-logging-and-proposal-creation.test.ts** — `52f8c4c` (test)
2. **Task 2: Wire IX-004 spec frontmatter to the new test** — `04e280b` (docs)

_Note: Plan was authored as `tdd="true"` for Task 1 but written as a single test commit because the test passed first run — no separate RED -> GREEN -> REFACTOR cycle was needed when the implementation under test (ProposalStore + PatternDetector) was already correct._

## Files Created/Modified

- `test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` — Created. 481 lines. Per-test harness builds ActivityLog + SignalStore + ProposalStore + PatternDetector against a temp SQLite db; 8 named it() blocks (IX-004.1 through IX-004.8) with substantive assertions on row state and store API behavior.
- `specs/integrations/ix-004-signal-logging-and-proposal-creation.md` — Edited. One-line frontmatter change: `integration-test: null` -> `integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts`. No body changes.

## Named-Interaction Coverage

| Interaction | Description | Test case | Notes |
|---|---|---|---|
| IX-004.1 | MoveTracker invokes patternDetector.processSignal | `it('IX-004.1: post-insert handoff drives PatternDetector.processSignal with the round-tripped MoveSignal')` | vi.spyOn on processSignal; asserts arg id/messageId/sender/folders match the inserted row |
| IX-004.2 | SignalStore persists raw metadata | `it('IX-004.2: every MoveSignalInput field round-trips through SQLite (snake_case columns)')` | Direct SELECT verifies all 9 columns + getSignalById round-trips to camelCase MoveSignal |
| IX-004.3 | PatternDetector builds {sender, envelopeRecipient, sourceFolder} key | `it('IX-004.3: signals collapse / split based on the three key fields and null/empty envelopeRecipient normalize together')` | Tests collapse + split on each of the 3 key fields plus the '' -> null normalization |
| IX-004.4 | New proposal -> active, count=1 | `it('IX-004.4: first signal inserts a row with active status, count=1, and dest in destination_counts')` | Asserts status, matching_count, contradicting_count, destination_counts, destination_folder, signals_since_dismiss, dismissed_at |
| IX-004.5 | Same-dest -> count++, strength progresses | `it('IX-004.5: matching_count and strength grow monotonically with each same-destination signal')` | Drives 10 signals, asserts strength rises monotonically and final row state matches |
| IX-004.6 | Different-dest -> contradicting++, dominant may shift | `it('IX-004.6: incumbent dominant is preserved on tie; flips when challenger overtakes')` | 1 to A -> 1 to B (tie, A keeps) -> 1 more to B (B flips dominant) |
| IX-004.7 | Dismissed -> signals_since_dismiss++; reaches 5 -> active | `it('IX-004.7: 5 post-dismiss signals flip status active, clear dismissed_at, preserve signals_since_dismiss')` | Per-step assertion at signals 1..4 still dismissed; signal 5 flips status active and dismissed_at clears; signals_since_dismiss stays at 5 |
| IX-004.8 | Approved -> no update | `it('IX-004.8: signals to an approved proposal leave counters and destination_counts byte-identical')` | Snapshot the 5 counter fields after approve, drive 3 signals (1 same dest, 2 different), assert byte-identity |

## Harness Pattern Used

IX-012's harness was the structural template (per the plan): per-test `mkdtempSync` + real `ActivityLog` + `SignalStore` + `ProposalStore` + `PatternDetector`, `makeSignal(overrides)` helper, direct DB row reads via `activityLog.getDb().prepare('SELECT * FROM proposed_rules WHERE id = ?').get(id)`. No IMAP, no GreenMail, no Fastify — IX-004 is pure persistence + state-machine logic, so booting any of those would have been wasted setup. The IX-003 harness (real GreenMail + ImapClient + MoveTracker) is the right template only when an IX exercises the IMAP scan loop.

## Frontmatter Wiring

Single one-line change in `specs/integrations/ix-004-signal-logging-and-proposal-creation.md`:
```diff
-integration-test: null
+integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts
```
No body edits — Participants / Named Interactions / Sequence Diagram / Pre/Postconditions / Failure Handling sections are unchanged.

## /validate IX-004 Verdict Transition

**Before (baseline at plan start):** WARN — 2 findings:
```json
{
  "findings": [
    { "id": "IX-INTEGRATION-TEST-UNSET", "severity": "warning",
      "message": "IX-004 has no integration-test frontmatter value" },
    { "id": "IX-NAMED-INTERACTIONS-WITHOUT-TEST", "severity": "warning",
      "message": "IX-004 declares named interactions (8) but no integration-test is set" }
  ]
}
```

**After:** PASS — zero findings:
```json
{
  "integrationTest": "test/integration/ix-004-signal-logging-and-proposal-creation.test.ts",
  "namedInteractions": ["IX-004.1", ..., "IX-004.8"],
  "findings": []
}
```
Exit code `0`. Both target warnings closed.

## Decisions Made

- **IX-004.1 handoff-seam testing (not MoveTracker boot-up).** The plan called this out explicitly and the rationale is solid: IX-004's preconditions section says "A confirmed move signal has been emitted by IX-003 with a resolved destination" — the test starts at that seam. Booting MoveTracker would require ImapClient + GreenMail + scan loop (all IX-003 territory) for no IX-004 benefit. `vi.spyOn(patternDetector, 'processSignal')` is the lightweight way to exercise the post-insert handoff contract.
- **IX-004.5 strength is a UI projection.** The spec mentions Weak/Moderate/Strong labels, but those are computed UI-side from `matching_count` thresholds. The testable contract is the underlying `strength` field on ProposedRule (= matching_count - contradicting_count), which is what the UI label derives from. Assertion documents this.
- **IX-004.7 threshold is `>= 5`, signals_since_dismiss is preserved on flip.** Verified against ProposalStore source (line 91-95). Important assertion target because the UI's resurfacedNotice ("5 new moves since you dismissed this") depends on the count being preserved.

## Deviations from Plan

None - plan executed exactly as written. The plan was unusually thorough (every assertion target was pre-specified in the `<behavior>` block) so no judgment calls were needed.

## Issues Encountered

**Worktree branch mismatch on startup.** `git merge-base HEAD ff8908ec373f98a2e3d631cf548a93ed12599dc0` returned `e38a7a59...`, indicating this worktree branch had drifted off the expected base. Investigation showed the worktree had 5 extra commits (cf63783..e38a7a5) that DELETED legitimate planning artifacts (260428-x6c, 260429-d4a, 260430-msg, 260501-ej8 quick-task dirs and SUMMARY.md files) and architecture/spec files (INV-002, ix-001/002/003/005 integration tests, etc.) — exactly the worktree-merge-nuke pattern the user's MEMORY.md flags as "Worktree merges nuke work". Resolved with `git reset --hard ff8908ec373f98a2e3d631cf548a93ed12599dc0` per the prompt's worktree-branch-check instructions; the working tree is now clean against the expected base. The plan file itself (260501-ewi-PLAN.md) was untracked in the main repo and was copied into the worktree's `.planning/quick/` after the reset.

## Next Phase Readiness

- IX-004 is now fully wired and validated. /validate IX-004 reports PASS.
- The pending IX-### todos still open: only "Implement HTTP BASIC auth on web app and API" remains in pending/. The "Wire IX-004 integration test" todo file (`.planning/todos/pending/2026-04-29-wire-ix-004-integration-test.md`) should be moved to `done/` as part of the orchestrator's docs commit.

## Self-Check: PASSED

- File `test/integration/ix-004-signal-logging-and-proposal-creation.test.ts`: FOUND
- File `specs/integrations/ix-004-signal-logging-and-proposal-creation.md` (modified, integration-test wired): FOUND
- Commit `52f8c4c` (test): FOUND in `git log --oneline`
- Commit `04e280b` (docs): FOUND in `git log --oneline`
- Final acceptance: `npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-004` exit code 0, zero findings — PASS
- Test execution: `npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` 8/8 passing

---
*Phase: quick-260501-ewi*
*Completed: 2026-05-01*
