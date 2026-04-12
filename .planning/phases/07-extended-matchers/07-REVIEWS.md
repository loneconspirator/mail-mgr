---
phase: 7
reviewers: [codex]
reviewed_at: 2026-04-12T06:55:00Z
plans_reviewed: [07-01-PLAN.md, 07-02-PLAN.md]
---

# Cross-AI Plan Review — Phase 7

## Codex Review

*Model: gpt-5.4 via OpenAI Codex v0.118.0*

### Plan 07-01 — Schema + Matcher Extension

**Summary**
This plan is directionally correct for the backend core: the schema changes fit the existing `emailMatchSchema` shape in src/config/schema.ts, and `matchRule()` in src/rules/matcher.ts is currently a simple AND-style guard chain that can absorb three more fields cleanly. The main gap is completeness: as written, it does not achieve the phase goal of "user can create a rule" end to end, because the current UI only exposes sender and subject in the frontend, and rule summaries only render sender/recipient/subject.

**Strengths**
- Keeps the matcher model simple and consistent with existing guard-block structure.
- Correctly treats new fields as AND conditions inside first-match-wins evaluation.
- Uses Zod enums for constrained fields, which matches current schema style.
- Calls out TDD for both schema and matcher behavior.
- `readStatus: any` as pass-through is aligned with D-06 and avoids extra branching elsewhere.

**Concerns**
- **HIGH**: Incomplete against success criteria. Backend-only changes do not let a user create/edit these fields in the current web UI; the modal only supports `sender` and `subject`, and client-side validation only checks those two.
- **HIGH**: There is a spec conflict the plan does not resolve. The roadmap says `visibility` should be a multi-select condition, but D-04 says single-value only. The plan implements single-value only. That is internally consistent with D-04, but inconsistent with the roadmap text and MATCH-04 wording.
- **MEDIUM**: The plan assumes `envelopeRecipient` is already normalized to a bare address. Current parsing in src/imap/messages.ts stores the raw header value if it merely "includes `@`". If providers emit angle-bracket or display-name forms, both `deliveredTo` glob matching and `visibility` derivation can fail.
- **MEDIUM**: Test file targeting is not grounded in the current repo. There is no `test/unit/config/schema.test.ts`; schema coverage currently lives in test/unit/config/config.test.ts. That usually signals the plan was written without checking the codebase.
- **LOW**: The refine error message also needs updating, not just the predicate, or validation output becomes misleading.

**Suggestions**
- Expand scope to include the rule creation/edit UI and rule-display text, or explicitly state this plan is backend-only and cannot satisfy the full phase success criteria by itself.
- Resolve the `visibility` contract before implementation: single enum or true multi-select. Do not proceed with both interpretations in the docs.
- Add tests that prove behavior against realistic envelope-header formats, not just bare `user@example.com` strings.
- Add config/load tests in `config.test.ts`, not only isolated schema tests.
- Add frontend tests if UI support is in scope: modal population, payload serialization, and summary rendering.

**Risk Assessment**
**MEDIUM-HIGH**. The matcher/schema work itself is low complexity, but the plan is currently too narrow for the stated product outcome and is exposed to a real parsing assumption around `envelopeRecipient`.

---

### Plan 07-02 — Evaluator Skip Logic

**Summary**
This plan fits the current architecture well. `evaluateRules()` in src/rules/evaluator.ts is the correct place to enforce D-08, because that is where rule ordering and first-match-wins semantics already live. The helper approach is appropriately small. The main risk is not the skip logic itself, but whether the plan fully proves identical behavior across Monitor, Sweep, and Batch, and whether it captures interactions with higher-priority skipped rules falling through to lower-priority matches.

**Strengths**
- Correct separation of concerns: availability/skip logic in evaluator, field matching in matcher.
- Minimal implementation surface and O(1) per-rule check.
- Preserves first-match-wins semantics by skipping only rules that require unavailable envelope data.
- Explicitly keeps `readStatus` out of skip logic, which matches D-09.

**Concerns**
- **MEDIUM**: The plan says "10 test cases" but does not explicitly require context-level proofs for Monitor, Sweep, and Batch. Since the phase success criteria require identical behavior in all three, evaluator-only unit tests are necessary but not sufficient evidence.
- **MEDIUM**: The important ordering case is implicit, not explicit: a skipped higher-priority `deliveredTo`/`visibility` rule must allow a lower-priority non-envelope rule to win. That should be a named test, not just part of "mixed rulesets."
- **LOW**: `message.envelopeRecipient !== undefined` is probably fine given current parsing, but the plan is coupled to "undefined means unavailable." If envelope parsing later changes to empty string/null, behavior silently changes.
- **LOW**: The plan does not mention whether skipped rules should be observable in logs/debugging. That may matter for explainability, though not strictly required here.

**Suggestions**
- Make the fallthrough case explicit in tests: skipped envelope-dependent rule first, matching non-envelope rule second.
- Add integration tests or at least targeted tests around each entry path that already calls `evaluateRules()` in Monitor, Sweep, and Batch.
- Define availability in one helper or predicate and reuse it, so future message-shape changes do not leak into evaluator logic.
- Consider a small test asserting `readStatus` still works when envelope data is absent.

**Risk Assessment**
**LOW-MEDIUM**. The implementation is straightforward and well-scoped. The real risk is under-testing cross-context behavior rather than the skip logic itself.

---

## Consensus Summary

*Single reviewer — consensus analysis not applicable. Summary reflects Codex's independent assessment.*

### Agreed Strengths
- Plans follow existing codebase patterns closely (guard-block matcher, Zod optional + refine schema)
- Clean separation of concerns between matcher (field matching) and evaluator (skip logic)
- TDD approach called out explicitly
- Threat model is appropriate and proportional

### Key Concerns (by severity)

**HIGH:**
1. UI coverage gap — Phase 7 is backend-only but success criteria say "user can create a rule." Phase 8 covers UI separately, but the reviewer flagged this as the roadmap text being ambiguous about whether YAML-only creation counts.
2. Visibility spec conflict — MATCH-04 says "multi-select" but D-04 says "single-value only." The plan implements D-04 (single-value) which is the user's explicit decision, but the roadmap/requirements text hasn't been updated to match.

**MEDIUM:**
3. `envelopeRecipient` normalization — raw header values may include angle brackets or display names that would break glob matching.
4. Test file location — Plan creates new `schema.test.ts` but existing schema tests live in `config.test.ts`.
5. Cross-context verification insufficient — evaluator unit tests alone don't prove identical behavior across Monitor/Sweep/Batch.

### Divergent Views
N/A — single reviewer.
