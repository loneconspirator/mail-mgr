---
phase: 07-extended-matchers
reviewed: 2026-04-12T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/config/index.ts
  - src/config/schema.ts
  - src/imap/index.ts
  - src/imap/messages.ts
  - src/rules/evaluator.ts
  - src/rules/matcher.ts
  - test/unit/config/config.test.ts
  - test/unit/rules/evaluator.test.ts
  - test/unit/rules/matcher.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-04-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase adds three new `EmailMatch` fields (`deliveredTo`, `visibility`, `readStatus`) to the rule schema, implements them in `matchRule`, and gates envelope-dependent fields in `evaluateRules` when envelope data is unavailable. The implementation is generally clean and well-tested. One warning-level logic inconsistency exists between the `envelopeAvailable` guard in `evaluateRules` and the guard inside `matchRule` for `deliveredTo`. Two info items cover a documentation gap in `reviewMessageToEmailMessage` and a missing edge-case test.

## Warnings

### WR-01: Inconsistent empty-string guard between evaluator and matcher for `envelopeRecipient`

**File:** `src/rules/evaluator.ts:24` and `src/rules/matcher.ts:39`

**Issue:** `evaluateRules` computes `envelopeAvailable` as `message.envelopeRecipient !== undefined`. This is a strict undefined-check — an empty string `''` passes this guard (envelope is considered "available"). However, inside `matchRule`, the `deliveredTo` branch uses a falsy check: `if (!message.envelopeRecipient) return false`. A falsy empty string causes an immediate `false` return, bypassing the glob comparison entirely. The result: when `envelopeRecipient === ''`, the evaluator does not skip the rule (it believes envelope data is present), but the matcher silently returns `false` for every `deliveredTo` rule regardless of the glob pattern. The rule is evaluated but can never match.

This inconsistency also affects the `visibility` skip-logic path — the evaluator uses the same `envelopeAvailable` flag to gate `visibility` rules, so if `envelopeRecipient === ''` a `visibility`-only rule also will not be skipped but can still match (visibility check in matcher does not have this falsy-guard issue). The severity stems from the `deliveredTo` case specifically.

**Fix:** Align the two guards. Since the intent is to skip rules when no real envelope data exists, use the same falsy check in both places:

```typescript
// evaluator.ts line 24 — change from:
const envelopeAvailable = message.envelopeRecipient !== undefined;

// to:
const envelopeAvailable = !!message.envelopeRecipient;
```

This makes the evaluator's skip-guard consistent with the matcher's runtime check, so both treat `''` as "no envelope data."

## Info

### IN-01: `reviewMessageToEmailMessage` silently drops envelope fields — behavior undocumented

**File:** `src/imap/messages.ts:66-77`

**Issue:** `reviewMessageToEmailMessage` converts a `ReviewMessage` to `EmailMessage` without setting `envelopeRecipient` or `visibility`. As a result, any message processed through the sweep path will always have `envelopeAvailable = false` in `evaluateRules`, causing all `deliveredTo` and `visibility` rules to be silently skipped during sweep. This is likely intentional (sweep-path fetches do not include envelope-recipient headers), but the behavior is not documented. A future developer adding envelope-recipient fetching to the sweep path might not realize the conversion function also needs updating.

**Fix:** Add a brief comment to the function documenting the intentional omission:

```typescript
/**
 * Convert a ReviewMessage to EmailMessage for rule evaluation during sweep.
 * Note: envelopeRecipient and visibility are not set — sweep fetches do not
 * include envelope-recipient data. Rules using deliveredTo or visibility
 * are skipped for sweep messages by evaluateRules (D-08).
 */
export function reviewMessageToEmailMessage(rm: ReviewMessage): EmailMessage {
```

### IN-02: Missing evaluator test — `envelopeRecipient` present but `visibility` undefined

**File:** `test/unit/rules/evaluator.test.ts`

**Issue:** All existing tests for visibility evaluation (line 213-220) set both `envelopeRecipient` and `visibility` together. There is no test for the case where `envelopeRecipient` is defined (so the rule is not skipped by the evaluator) but `message.visibility` is `undefined`. In that scenario, a `visibility: 'direct'` rule should return `false` from `matchRule` because `message.visibility !== 'direct'` (undefined !== 'direct'). The behavior is correct in the implementation, but the test gap means a regression in this edge case would go undetected.

**Fix:** Add a test case:

```typescript
it('returns null when envelopeRecipient is set but message visibility is undefined', () => {
  const rules = [
    makeRule('vis', 1, { visibility: 'direct' }),
  ];
  // envelopeRecipient present so rule is not skipped, but visibility unset
  const msg = makeMessage({ envelopeRecipient: '<mike@example.com>' });
  expect(evaluateRules(rules, msg)).toBeNull();
});
```

---

_Reviewed: 2026-04-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
