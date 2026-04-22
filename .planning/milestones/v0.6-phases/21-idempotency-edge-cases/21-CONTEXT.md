# Phase 21: Idempotency & Edge Cases - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Processing is resilient to duplicates, missing rules, and crash recovery scenarios. This phase adds idempotent check-before-create to the existing ActionFolderProcessor, ensures undo operations with no matching rule still move the message gracefully, and validates that crash recovery (rule created, message not yet moved) is handled correctly by the existing poll/startup pre-scan mechanism. Requirements: PROC-07, PROC-08.

This phase does NOT add new action types, change monitoring behavior, or modify the poller. All changes are within `ActionFolderProcessor.processMessage()` and its tests.

</domain>

<decisions>
## Implementation Decisions

### Idempotency (PROC-07)
- **D-01:** Check-before-create using `findSenderRule(sender, actionDef.ruleAction, rules)` before `configRepo.addRule()`. If a matching sender-only rule already exists with the same action type, skip rule creation entirely. The message is still moved to its destination.
- **D-02:** When a duplicate is detected, log at `debug` level: "Rule already exists for sender, skipping creation". Do NOT log to activity — the original creation already logged, and a duplicate activity entry would be misleading.
- **D-03:** The existing conflict check (opposite action type) runs FIRST, then the idempotency check (same action type). Order: conflict removal → duplicate check → create if needed. This handles the edge case where a user VIPs a sender that was previously VIPed and then blocked — the block rule is removed, then the existing VIP rule is detected and no new rule is created.

### Undo With No Match (PROC-08)
- **D-04:** When an undo/unblock operation finds no matching rule via `findSenderRule()`, the message is still moved to its destination (INBOX). This is already the current behavior — the remove branch skips the delete but does not skip the move.
- **D-05:** Add an explicit `info`-level log when undo finds no matching rule: "No matching rule found for undo/unblock, moving message to destination". This makes the no-match case visible in logs without treating it as an error.
- **D-06:** The `ProcessResult` for undo-no-match should still return `{ ok: true }` — the user's intent (message in INBOX) is fulfilled even though no rule was removed.

### Crash Recovery
- **D-07:** Crash recovery is handled implicitly by the combination of idempotency (D-01) and the existing startup pre-scan (Phase 20 D-07). If the process crashes after creating a rule but before moving the message, on restart the pre-scan finds the message still in the action folder, re-processes it, detects the existing rule (idempotent skip), and moves the message. No special crash-recovery code path needed.
- **D-08:** The existing `processing` guard in `ActionFolderPoller.scanAll()` prevents concurrent processing. Combined with Node.js single-threaded execution, there's no race condition between poll tick and startup scan.

### Claude's Discretion
- Whether the idempotency check is a separate private method or inline in `processMessage()`
- Test fixture structure for duplicate/crash-recovery scenarios
- Exact log message wording
- Whether to add a `skippedDuplicate: boolean` field to `ProcessResult` for caller visibility

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — PROC-07 (idempotent processing), PROC-08 (undo-no-match)
- `.planning/ROADMAP.md` §Phase 21 — Success criteria (3 items) and dependency on Phase 20

### Prior phase context
- `.planning/phases/19-action-processing-core/19-CONTEXT.md` — Processor architecture (D-01, D-02), conflict resolution (D-11, D-12, D-13), message routing (D-14, D-16)
- `.planning/phases/20-monitoring-startup-recovery/20-CONTEXT.md` — Startup pre-scan (D-07, D-08), always-empty invariant (D-10, D-11, D-12)

### Existing code (modification targets)
- `src/action-folders/processor.ts` — `ActionFolderProcessor.processMessage()` — the method being modified for idempotency
- `src/action-folders/processor.ts:50` — Existing conflict check with `findSenderRule(sender, oppositeAction, rules)` — idempotency check goes after this
- `src/action-folders/processor.ts:72` — Remove branch where undo-no-match needs explicit logging
- `src/rules/sender-utils.ts` — `findSenderRule()` — reused for same-action-type duplicate detection (no modification needed)

### Existing tests (extend these)
- `test/unit/action-folders/processor.test.ts` — Processor test suite to add idempotency and undo-no-match test cases
- `test/unit/action-folders/poller.test.ts` — Poller test suite (may add crash-recovery integration scenario)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `findSenderRule(sender, actionType, rules)` (sender-utils.ts): Already used for conflict detection — reuse with same action type for idempotency check. No modification needed.
- `configRepo.getRules()` (repository.ts): Returns current rules array — called once at start of `processMessage()`, same snapshot used for both conflict and idempotency checks.

### Established Patterns
- Conflict check at processor.ts:48-56 — idempotency check follows the same pattern (findSenderRule + conditional skip)
- Debug-level logging for operational decisions (poller.ts:25 skips), info-level for user-visible outcomes
- `ProcessResult` type uses discriminated union `{ ok: true/false }` — extend pattern for undo-no-match

### Integration Points
- `src/action-folders/processor.ts:47-69` — The `create` branch needs idempotency check inserted between conflict removal and `addRule()`
- `src/action-folders/processor.ts:70-78` — The `remove` branch needs info log when `findSenderRule` returns undefined
- No changes to poller, registry, sender-utils, or any other files

</code_context>

<specifics>
## Specific Ideas

- The idempotency change is ~5 lines in the create branch: call `findSenderRule(sender, actionDef.ruleAction, rules)` after conflict resolution, skip `addRule()` if it returns a match. Minimal, surgical change.
- Crash recovery is a test scenario, not a code change. The test should: create a rule manually, then process the same message — verify no duplicate rule and message is moved.
- Undo-no-match is also mostly a test + log line. The current code already handles it correctly by falling through to the move.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-idempotency-edge-cases*
*Context gathered: 2026-04-20*
