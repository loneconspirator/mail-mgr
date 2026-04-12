# Phase 7: Extended Matchers - Research

**Researched:** 2026-04-11
**Domain:** Rule matching logic, Zod schema extension, IMAP flag inspection
**Confidence:** HIGH

## Summary

Phase 7 adds three new match fields (`deliveredTo`, `visibility`, `readStatus`) to the existing rule matching pipeline. The codebase is extremely well-structured for this extension -- `matchRule()` in `src/rules/matcher.ts` uses a guard-and-return-false pattern for each field, `emailMatchSchema` in `src/config/schema.ts` uses optional Zod fields with a refine for at-least-one, and `evaluateRules()` in `src/rules/evaluator.ts` provides the first-match-wins loop where skip logic for unavailable fields can be inserted.

Phase 6 already landed the data layer: `EmailMessage` has `envelopeRecipient?: string` and `visibility?: Visibility` fields, plus `flags: Set<string>` has always been there. The `Visibility` type (`'list' | 'direct' | 'cc' | 'bcc'`) is already defined in `src/imap/messages.ts`. This phase only needs to wire these existing fields into the matching and schema layers.

**Primary recommendation:** Extend `matchRule()` with three new guard blocks following the exact pattern of the existing sender/recipient/subject blocks, extend `emailMatchSchema` with three optional fields, and add a skip-check in `evaluateRules()` for rules referencing `deliveredTo` or `visibility` when the message lacks envelope data.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Envelope recipient match field is named `deliveredTo` in rule YAML config. Maps to the most common header name, short and clear.
- **D-02:** Header visibility match field is named `visibility` in rule YAML config. Consistent with Phase 6 terminology. Values: `direct`, `cc`, `bcc`, `list`.
- **D-03:** Read status match field is named `readStatus` in rule YAML config. Values: `read`, `unread`, `any`. Three-value enum -- `any` makes intent explicit even though omitting the field has the same effect.
- **D-04:** Visibility is single-value matching only -- each rule matches exactly one visibility value (not an array). Users who need to match multiple visibility values create duplicate rules. This avoids introducing array-type matching that doesn't exist elsewhere in the system.
- **D-05:** Existing `recipient` field stays as-is. `recipient` checks To+CC addresses by glob. `deliveredTo` checks the envelope header. Different use cases, no overlap, both can coexist in the same rule.
- **D-06:** `readStatus` uses a three-value enum: `read`, `unread`, `any`. Omitting the field is equivalent to `any` but the explicit value is available for clarity.
- **D-07:** Read status is checked at evaluation time in all three contexts (Monitor, Sweep, Batch) with identical behavior. No context-specific special cases. Checks the `\Seen` IMAP flag.
- **D-08:** When envelope header is not discovered, any rule that references `deliveredTo` or `visibility` in its match block is skipped entirely. No partial matching -- the whole rule is bypassed, not just the unavailable condition.
- **D-09:** `readStatus` is always available (IMAP flags are always fetched) and does not participate in the unavailable-skip logic. Only `deliveredTo` and `visibility` are affected by MATCH-06.

### Claude's Discretion
- Implementation of the skip-check in evaluateRules() vs matchRule() (wherever it fits cleanest)
- Zod schema structure for the new fields in emailMatchSchema (optional fields, enum validation)
- Whether `any` is stored in config or treated as absence during serialization
- Test structure and coverage approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MATCH-03 | User can create rules that match on envelope recipient using glob syntax (same as sender matching), including +tag variants and catch-all addresses | `deliveredTo` field added to schema + matchRule() guard block using picomatch (same as sender). `EmailMessage.envelopeRecipient` already populated by Phase 6. |
| MATCH-04 | User can create rules that match on header visibility (direct, cc, bcc, list) as a multi-select field | `visibility` field added to schema as single-value enum + matchRule() exact-equality check. `EmailMessage.visibility` already populated by Phase 6. Note: CONTEXT D-04 overrides "multi-select" to single-value. |
| MATCH-05 | User can create rules that match on read status (read/unread) at evaluation time | `readStatus` field added to schema as three-value enum + matchRule() checks `flags.has('\\Seen')`. Flags always available on EmailMessage. |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase uses only existing dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for new match fields | Already used for all config validation [VERIFIED: codebase] |
| picomatch | 4.0.3 | Glob matching for `deliveredTo` field | Already used for sender/recipient/subject matching [VERIFIED: codebase] |
| vitest | 4.0.18 | Test runner | Already used for all tests [VERIFIED: npx vitest --version] |

### Supporting
No additional libraries needed. All functionality is pure TypeScript logic extending existing patterns.

## Architecture Patterns

### Files to Modify

```
src/
  config/
    schema.ts          # Add deliveredTo, visibility, readStatus to emailMatchSchema
  rules/
    matcher.ts         # Add three guard blocks to matchRule()
    evaluator.ts       # Add envelope-availability skip logic
test/
  unit/
    rules/
      matcher.test.ts  # New test cases for three fields
      evaluator.test.ts # New test cases for skip logic
```

### Pattern 1: Guard-and-Return-False in matchRule()

**What:** Each match field is an independent guard block: check if field is defined in the rule, test against message data, return false on mismatch. All blocks must pass (AND logic). [VERIFIED: src/rules/matcher.ts]

**When to use:** Every new match field follows this exact pattern.

**Example (existing pattern to replicate):**
```typescript
// Source: src/rules/matcher.ts lines 14-18
if (match.sender !== undefined) {
  if (!picomatch.isMatch(message.from.address, match.sender, { nocase: true })) {
    return false;
  }
}
```

**New fields follow the same structure:**
```typescript
// deliveredTo: glob match against envelopeRecipient (same as sender)
if (match.deliveredTo !== undefined) {
  if (!message.envelopeRecipient) return false;
  if (!picomatch.isMatch(message.envelopeRecipient, match.deliveredTo, { nocase: true })) {
    return false;
  }
}

// visibility: exact enum equality
if (match.visibility !== undefined) {
  if (message.visibility !== match.visibility) {
    return false;
  }
}

// readStatus: check \Seen flag
if (match.readStatus !== undefined && match.readStatus !== 'any') {
  const isRead = message.flags.has('\\Seen');
  if (match.readStatus === 'read' && !isRead) return false;
  if (match.readStatus === 'unread' && isRead) return false;
}
```

### Pattern 2: Zod Optional Fields with Refine

**What:** emailMatchSchema uses optional fields with a `.refine()` requiring at least one field set. New fields are also optional. [VERIFIED: src/config/schema.ts lines 32-41]

**Existing pattern:**
```typescript
// Source: src/config/schema.ts lines 32-41
export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
  })
  .refine(
    (m) => m.sender !== undefined || m.recipient !== undefined || m.subject !== undefined,
    { message: 'At least one match field (sender, recipient, or subject) is required' },
  );
```

**Extended pattern:**
```typescript
const visibilityEnum = z.enum(['direct', 'cc', 'bcc', 'list']);
const readStatusEnum = z.enum(['read', 'unread', 'any']);

export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    deliveredTo: z.string().optional(),
    visibility: visibilityEnum.optional(),
    readStatus: readStatusEnum.optional(),
  })
  .refine(
    (m) => m.sender !== undefined || m.recipient !== undefined || m.subject !== undefined
        || m.deliveredTo !== undefined || m.visibility !== undefined || m.readStatus !== undefined,
    { message: 'At least one match field is required' },
  );
```

### Pattern 3: Envelope-Unavailable Skip Logic in evaluateRules()

**What:** When envelope data is not available (no `envelopeHeader` configured), rules referencing `deliveredTo` or `visibility` must be skipped entirely (D-08). [VERIFIED: CONTEXT.md D-08, D-09]

**Design decision (Claude's discretion):** The skip check belongs in `evaluateRules()`, not `matchRule()`. Rationale:
1. `matchRule()` only sees the rule and message -- it has no knowledge of whether envelope data is available system-wide vs. just missing on this message. A message with `envelopeRecipient === undefined` could mean "header not configured" or "header configured but not present on this specific message." The skip logic is about system capability, not message content.
2. `evaluateRules()` can receive an `envelopeAvailable` flag (or infer from the message) and decide to skip rules before calling `matchRule()`.
3. Simplest approach: check `message.envelopeRecipient === undefined` as proxy. If the envelope header is not configured, ALL messages will have `envelopeRecipient === undefined`. If the header IS configured but a specific message lacks it, that message just won't match the deliveredTo glob (returns false in matchRule, which is correct).

**However**, there is a subtlety: D-08 says the whole rule is SKIPPED (bypassed), not that the deliveredTo condition fails. This distinction matters when a rule has `deliveredTo` AND `sender` -- with skip, the rule is entirely invisible; with fail, the rule doesn't match but it was still "considered."

**Recommended approach:** Check in `evaluateRules()` whether each rule references `deliveredTo` or `visibility` in its match block, and if the message lacks envelope data, skip it. This keeps matchRule() pure (no skip concept) and makes the skip explicit:

```typescript
function needsEnvelopeData(rule: Rule): boolean {
  return rule.match.deliveredTo !== undefined || rule.match.visibility !== undefined;
}

export function evaluateRules(rules: Rule[], message: EmailMessage): Rule | null {
  const candidates = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  const envelopeAvailable = message.envelopeRecipient !== undefined;

  for (const rule of candidates) {
    if (!envelopeAvailable && needsEnvelopeData(rule)) continue;
    if (matchRule(rule, message)) return rule;
  }

  return null;
}
```

### Anti-Patterns to Avoid
- **Array-valued visibility matching:** D-04 explicitly forbids array matching for visibility. Single value only, duplicate rules for multiple values.
- **Context-specific read status behavior:** D-07 requires identical behavior across Monitor, Sweep, and Batch. Do not add any per-context branching.
- **Modifying matchRule() for skip logic:** Keep matchRule() as a pure field-by-field AND matcher. Skip logic belongs in the caller (evaluateRules).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching for deliveredTo | Custom regex or string matching | picomatch with `{ nocase: true }` | Already proven for sender/recipient/subject; handles +tag variants, wildcards, edge cases |
| Enum validation for visibility/readStatus | Manual string checks in schema | Zod `z.enum()` | Type-safe, generates TS types, consistent error messages |

## Common Pitfalls

### Pitfall 1: Forgetting to Update the Refine Check
**What goes wrong:** Adding new optional fields to emailMatchSchema but not updating the `.refine()` that enforces at-least-one-field. A rule with only `readStatus: 'unread'` would fail validation.
**Why it happens:** The refine is at the end of the schema, easy to miss.
**How to avoid:** Update the refine predicate to include all six fields. Write a test that validates a schema with only each new field.
**Warning signs:** Zod validation errors when creating rules with only new match fields.

### Pitfall 2: Case Sensitivity in deliveredTo Matching
**What goes wrong:** The envelope recipient value comes from raw headers and may have inconsistent casing. If picomatch doesn't use `nocase: true`, patterns fail.
**Why it happens:** Different mail servers normalize email addresses differently.
**How to avoid:** Use `{ nocase: true }` (same as existing sender/recipient matching). Already standard in this codebase.
**Warning signs:** Rules matching on deliveredTo work for some addresses but not others.

### Pitfall 3: Conflating "Rule Should Be Skipped" with "Rule Doesn't Match"
**What goes wrong:** If the envelope-unavailable skip is implemented inside `matchRule()` as a `return false`, it looks like the rule was evaluated and didn't match. The semantic difference matters for debugging/logging.
**Why it happens:** Seems simpler to handle everything in one place.
**How to avoid:** Implement skip logic in `evaluateRules()` with `continue`, keeping matchRule() as a pure boolean matcher.
**Warning signs:** Activity logs showing "no rule matched" when rules exist but were skipped due to missing envelope data.

### Pitfall 4: readStatus 'any' Being Stored Unnecessarily
**What goes wrong:** If `any` is stored in YAML config, every rule gets a `readStatus: any` field even when the user never specified it, creating noise.
**Why it happens:** Zod defaults or overzealous serialization.
**How to avoid:** Treat `readStatus: 'any'` and omission identically in matching logic. During serialization/config save, either store `any` explicitly or strip it -- either works as long as the matcher handles both. Recommend: let it be stored if the user sets it, but don't inject it as a default.
**Warning signs:** Config files bloated with `readStatus: any` on every rule.

### Pitfall 5: ReviewMessage Missing Envelope Fields
**What goes wrong:** `ReviewMessage` in sweep context is converted via `reviewMessageToEmailMessage()`. If the sweep fetch doesn't populate `envelopeRecipient` and `visibility` on `ReviewMessage`, the skip logic will incorrectly skip rules in sweep context.
**How to avoid:** Phase 6 already handles this -- `ReviewMessage` has `envelopeRecipient?: string` and `visibility?: Visibility` fields, and `reviewMessageToEmailMessage()` copies them through. Verify this is working correctly. [VERIFIED: src/imap/messages.ts lines 54-67, 69-82]

## Code Examples

### Complete matchRule() Extension
```typescript
// Source: Pattern derived from src/rules/matcher.ts
import picomatch from 'picomatch';
import type { Rule } from '../config/index.js';
import type { EmailMessage } from '../imap/index.js';

export function matchRule(rule: Rule, message: EmailMessage): boolean {
  const { match } = rule;

  // Existing: sender
  if (match.sender !== undefined) {
    if (!picomatch.isMatch(message.from.address, match.sender, { nocase: true })) {
      return false;
    }
  }

  // Existing: recipient (To + CC)
  if (match.recipient !== undefined) {
    const allRecipients = [...message.to, ...message.cc];
    const recipientMatched = allRecipients.some(
      (addr) => picomatch.isMatch(addr.address, match.recipient!, { nocase: true }),
    );
    if (!recipientMatched) return false;
  }

  // Existing: subject
  if (match.subject !== undefined) {
    if (!picomatch.isMatch(message.subject, match.subject, { nocase: true })) {
      return false;
    }
  }

  // New: deliveredTo (envelope recipient, glob match)
  if (match.deliveredTo !== undefined) {
    if (!message.envelopeRecipient) return false;
    if (!picomatch.isMatch(message.envelopeRecipient, match.deliveredTo, { nocase: true })) {
      return false;
    }
  }

  // New: visibility (exact enum match)
  if (match.visibility !== undefined) {
    if (message.visibility !== match.visibility) return false;
  }

  // New: readStatus (check \Seen flag)
  if (match.readStatus !== undefined && match.readStatus !== 'any') {
    const isRead = message.flags.has('\\Seen');
    if (match.readStatus === 'read' && !isRead) return false;
    if (match.readStatus === 'unread' && isRead) return false;
  }

  return true;
}
```

### Complete emailMatchSchema Extension
```typescript
// Source: Pattern derived from src/config/schema.ts
const visibilityEnum = z.enum(['direct', 'cc', 'bcc', 'list']);
const readStatusEnum = z.enum(['read', 'unread', 'any']);

export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    deliveredTo: z.string().optional(),
    visibility: visibilityEnum.optional(),
    readStatus: readStatusEnum.optional(),
  })
  .refine(
    (m) =>
      m.sender !== undefined ||
      m.recipient !== undefined ||
      m.subject !== undefined ||
      m.deliveredTo !== undefined ||
      m.visibility !== undefined ||
      (m.readStatus !== undefined && m.readStatus !== 'any'),
    { message: 'At least one match field is required' },
  );
```

Note on the refine: `readStatus: 'any'` alone is arguably not a meaningful rule (it matches everything). The refine could either count it or not. Recommendation: count `readStatus` regardless of value in the refine, since the user intentionally set a field. If `readStatus: 'any'` is the only field, validation passes but the rule matches all messages -- the user presumably wants a catch-all.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts (or default) |
| Quick run command | `npx vitest run test/unit/rules/ --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MATCH-03 | deliveredTo glob matching works (exact, wildcard, +tag) | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-03 | deliveredTo case-insensitive | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-04 | visibility exact match (direct, cc, bcc, list) | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-04 | visibility undefined on message means no match | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-05 | readStatus read matches seen flag | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-05 | readStatus unread matches no seen flag | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-05 | readStatus any matches both | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |
| MATCH-06 (D-08) | Rules with deliveredTo/visibility skipped when envelope unavailable | unit | `npx vitest run test/unit/rules/evaluator.test.ts -x` | Needs extension |
| MATCH-06 (D-09) | readStatus NOT skipped when envelope unavailable | unit | `npx vitest run test/unit/rules/evaluator.test.ts -x` | Needs extension |
| Schema | emailMatchSchema validates new fields | unit | `npx vitest run test/unit/config/schema.test.ts -x` | Needs new file |
| Schema | emailMatchSchema refine accepts each new field alone | unit | `npx vitest run test/unit/config/schema.test.ts -x` | Needs new file |
| AND logic | New fields combine with existing fields in AND logic | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Needs extension |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/rules/ --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Extend `test/unit/rules/matcher.test.ts` with describe blocks for `deliveredTo`, `visibility`, `readStatus`
- [ ] Extend `test/unit/rules/evaluator.test.ts` with describe block for envelope-unavailable skip logic
- [ ] Create new `test/unit/config/schema.test.ts` for emailMatchSchema validation

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Zod schema validation for all new fields; `z.enum()` for visibility and readStatus restricts to valid values; deliveredTo is a string validated as glob pattern by picomatch |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious glob patterns in deliveredTo | Tampering | picomatch handles this safely; no ReDoS risk with picomatch library [ASSUMED] |
| Invalid enum values for visibility/readStatus | Tampering | Zod enum validation rejects at API boundary |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | picomatch is safe against ReDoS with arbitrary user input | Security Domain | LOW -- picomatch is widely used and designed for glob patterns, not arbitrary regex |
| A2 | `readStatus: 'any'` alone should pass the refine check | Code Examples | LOW -- policy decision, easy to change either way |

## Open Questions (RESOLVED)

1. **Should `readStatus: 'any'` alone pass the at-least-one-field refine?**
   - What we know: `any` matches all messages regardless of read status, so a rule with only `readStatus: 'any'` is essentially a catch-all
   - What's unclear: Whether users would intentionally create such a rule
   - Recommendation: Allow it (include readStatus in refine check regardless of value). A catch-all rule has legitimate uses and the user is being explicit about intent.
   - **RESOLVED:** Yes -- Plan 01 Task 1 includes `readStatus` in the refine predicate regardless of value (`m.readStatus !== undefined`). A rule with only `readStatus: 'any'` passes validation. Per Claude's discretion area in CONTEXT.md.

2. **Should `any` be stripped on config serialization?**
   - What we know: D-06 says omitting equals `any`. CONTEXT gives Claude discretion on serialization behavior.
   - What's unclear: Whether user prefers minimal YAML or explicit intent
   - Recommendation: Preserve `any` if user explicitly set it. Don't inject it as a default. This matches the YAML config philosophy of "what you write is what you get."
   - **RESOLVED:** No stripping -- `any` is preserved if user sets it, not injected as default. Plan 01 stores whatever the user provides; the matcher treats `readStatus: 'any'` and omission identically (both pass through). Per Claude's discretion area in CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- `src/rules/matcher.ts` - Existing matchRule() pattern with guard blocks [VERIFIED: codebase]
- `src/rules/evaluator.ts` - Existing evaluateRules() first-match-wins pipeline [VERIFIED: codebase]
- `src/config/schema.ts` - Existing emailMatchSchema with optional fields + refine [VERIFIED: codebase]
- `src/imap/messages.ts` - EmailMessage type with envelopeRecipient, visibility, flags [VERIFIED: codebase]
- `test/unit/rules/matcher.test.ts` - Existing test patterns with makeMessage/makeRule helpers [VERIFIED: codebase]
- `test/unit/rules/evaluator.test.ts` - Existing evaluator test patterns [VERIFIED: codebase]
- Phase 6 CONTEXT.md - Upstream decisions on data layer fields [VERIFIED: codebase]
- Phase 7 CONTEXT.md - All locked decisions D-01 through D-09 [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
None needed -- this phase is entirely codebase-internal logic.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all existing deps verified in codebase
- Architecture: HIGH - Follows established patterns exactly, all source files read and analyzed
- Pitfalls: HIGH - Based on direct code analysis and understanding of IMAP flag semantics

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable -- pure logic extension, no external dependencies)
