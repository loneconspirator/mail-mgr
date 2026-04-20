# Phase 12: Retroactive Verification (Gap Closure) - Research

**Researched:** 2026-04-19
**Domain:** Verification / gap closure for phases 6-9 MATCH requirements
**Confidence:** HIGH

## Summary

Phase 12 is a pure verification phase -- no new code is being written. The job is to confirm that the MATCH-01 through MATCH-06 requirements implemented across orphaned phases 6-9 actually work correctly, and to produce a formal VERIFICATION.md artifact documenting evidence for each requirement.

All six MATCH requirements have corresponding implementation code already in the codebase. The test suite (453 tests, all passing) covers the core matcher, evaluator, discovery, and API surface thoroughly. The primary work is auditing existing code and tests against each requirement's exact wording, identifying any gaps between requirement language and implementation, and producing a structured verification report.

**Primary recommendation:** Walk each MATCH requirement against the codebase, run the full test suite as evidence, note the visibility multi-select vs single-select discrepancy (MATCH-04 says "multi-select" but implementation is single-select enum), and produce VERIFICATION.md.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MATCH-01 | Auto-discovers envelope recipient header by probing common headers on sample messages, storing found header in config | `src/imap/discovery.ts` probeEnvelopeHeaders() probes CANDIDATE_HEADERS on 10 recent messages, stores via configRepo. 8 unit tests in `test/unit/imap/discovery.test.ts`. |
| MATCH-02 | Auto-discovery triggers on IMAP config change and manually from UI | `src/index.ts` lines 123-136 run discovery on onImapConfigChange. `src/web/routes/envelope.ts` POST /api/config/envelope/discover provides manual trigger. Frontend "Run Discovery" button in app.ts line 443-445. |
| MATCH-03 | Rules match on envelope recipient using glob syntax including +tag variants | `src/rules/matcher.ts` matchRule() deliveredTo branch uses picomatch glob with nocase. Tests cover exact, glob, +tag, case-insensitive, angle brackets (7 tests). |
| MATCH-04 | Rules match on header visibility (direct/cc/bcc/list) as multi-select field | `src/rules/matcher.ts` visibility branch checks exact enum equality. Schema uses single enum `z.enum(['direct','cc','bcc','list'])`. **NOTE: Implementation is single-select, not multi-select as requirement states.** UI uses `<select>` not `<select multiple>`. |
| MATCH-05 | Rules match on read status (read/unread) at evaluation time | `src/rules/matcher.ts` readStatus branch checks \\Seen flag. 'any' acts as pass-through. 7 tests cover all states. |
| MATCH-06 | When envelope header not configured, envelope/visibility fields disabled and rules using them skipped | `src/rules/evaluator.ts` needsEnvelopeData() checks deliveredTo/visibility; evaluateRules() skips when !envelopeAvailable. UI disables fields with info icon. 10 evaluator tests cover skip logic. |
</phase_requirements>

## Architecture Patterns

### Verification Artifact Structure

Based on existing Phase 11 VERIFICATION.md, the expected format includes:

```
---
phase: 12-retroactive-verification
verified: [ISO timestamp]
status: [pass | human_needed | partial]
score: X/Y
overrides_applied: 0
gaps: []
human_verification:
  - test: "[manual test description]"
    expected: "[expected result]"
    why_human: "[why automated testing cannot cover this]"
---

# Phase 12: Retroactive Verification — Verification Report

## Goal Achievement
### Observable Truths (ROADMAP Success Criteria)
[Table mapping each success criterion to status + evidence]

### Required Artifacts
[Table of files that must exist with verification status]

### Test Evidence
[Test suite results, specific test names mapped to requirements]
```

[VERIFIED: .planning/phases/11-pattern-detection/11-VERIFICATION.md]

### Key Files to Verify

```
src/
├── imap/
│   ├── discovery.ts          # MATCH-01: probeEnvelopeHeaders
│   └── messages.ts           # MATCH-04: classifyVisibility
├── rules/
│   ├── matcher.ts            # MATCH-03, MATCH-04, MATCH-05: matchRule
│   └── evaluator.ts          # MATCH-06: needsEnvelopeData + evaluateRules
├── config/
│   └── schema.ts             # Schema: emailMatchSchema with all match fields
├── web/
│   ├── routes/envelope.ts    # MATCH-02: POST /api/config/envelope/discover
│   └── frontend/app.ts       # UI-01, UI-03: rule editor + settings page
└── index.ts                  # MATCH-02: onImapConfigChange discovery trigger
```

### Requirement-to-Code Mapping

| Requirement | Primary Source | Test File | Tests |
|-------------|---------------|-----------|-------|
| MATCH-01 | `src/imap/discovery.ts` | `test/unit/imap/discovery.test.ts` | 8 tests |
| MATCH-02 | `src/index.ts` + `src/web/routes/envelope.ts` | `test/unit/web/api.test.ts` | 3 envelope tests |
| MATCH-03 | `src/rules/matcher.ts` | `test/unit/rules/matcher.test.ts` | 7 deliveredTo tests |
| MATCH-04 | `src/rules/matcher.ts` + `src/imap/messages.ts` | `test/unit/rules/matcher.test.ts` | 7 visibility tests |
| MATCH-05 | `src/rules/matcher.ts` | `test/unit/rules/matcher.test.ts` | 7 readStatus tests |
| MATCH-06 | `src/rules/evaluator.ts` | `test/unit/rules/evaluator.test.ts` | 10 skip-logic tests |

## Common Pitfalls

### Pitfall 1: Visibility Multi-Select vs Single-Select Discrepancy
**What goes wrong:** MATCH-04 requirement says "multi-select field" but implementation uses a single-value enum (`z.enum(['direct', 'cc', 'bcc', 'list'])`) and the UI renders a standard `<select>` (not `<select multiple>`). The matcher uses exact equality (`message.visibility !== match.visibility`), not array-includes.
**Why it happens:** The implementation chose single-select because each message can only have ONE visibility classification (it's either direct, cc, bcc, or list). A multi-select on the RULE side would mean "match if the message's visibility is any of these selected values" -- which is a valid interpretation but not implemented.
**How to avoid:** Document this in VERIFICATION.md as a deliberate design choice: since visibility is derived from envelope analysis and is mutually exclusive per message, single-select covers the primary use case. Note it as PARTIAL compliance with MATCH-04's literal wording. [VERIFIED: src/rules/matcher.ts line 47-50, src/config/schema.ts line 32]
**Warning signs:** Requirement text specifically says "multi-select" -- verification should flag this clearly.

### Pitfall 2: Discovery Trigger Scope
**What goes wrong:** MATCH-02 says "triggers automatically on successful IMAP connect when server details change." The implementation triggers on ALL IMAP config changes via `onImapConfigChange`, not specifically "when server details change."
**Why it happens:** The config change handler rebuilds the entire IMAP pipeline including discovery. This is actually more thorough than the requirement demands.
**How to avoid:** Note this as EXCEEDS requirement -- discovery runs on any config change, not just server detail changes. [VERIFIED: src/index.ts lines 109-136]

### Pitfall 3: Envelope Header Persistence on Discovery Failure
**What goes wrong:** If discovery fails (exception), the handler logs the error and continues without updating the envelope header setting.
**Why it happens:** The try/catch in src/index.ts lines 126-131 catches the error and continues with `discoveredHeader = null`.
**How to avoid:** This is correct behavior -- failing discovery should not clear a previously working header. On initial startup (lines 206-218), the header IS updated even when discovery returns null. On config change (lines 123-136), the header is always persisted (even as undefined). Verify both paths. [VERIFIED: src/index.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verification artifacts | Custom verification format | Existing VERIFICATION.md format from Phase 11 | Consistency across phases |
| Test execution | Manual code inspection | `npx vitest run` with specific test files | Automated, repeatable evidence |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/rules/matcher.test.ts test/unit/rules/evaluator.test.ts test/unit/imap/discovery.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MATCH-01 | Probe envelope headers, store in config | unit | `npx vitest run test/unit/imap/discovery.test.ts -x` | Yes |
| MATCH-02 | Auto-trigger on config change + manual POST endpoint | unit + integration | `npx vitest run test/unit/web/api.test.ts -x` | Yes (partial -- POST endpoint tested, lifecycle trigger needs code review) |
| MATCH-03 | deliveredTo glob matching with +tag variants | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Yes |
| MATCH-04 | visibility single-select matching (direct/cc/bcc/list) | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Yes |
| MATCH-05 | readStatus evaluation against \\Seen flag | unit | `npx vitest run test/unit/rules/matcher.test.ts -x` | Yes |
| MATCH-06 | Skip rules needing envelope data when unavailable | unit | `npx vitest run test/unit/rules/evaluator.test.ts -x` | Yes |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/rules/ test/unit/imap/discovery.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. 453 tests passing across 28 test files.

## Code Examples

### MATCH-01: Discovery probes candidates with consensus threshold
```typescript
// Source: src/imap/discovery.ts lines 22-74
export async function probeEnvelopeHeaders(client: ImapClient): Promise<string | null> {
  // Fetches last 10 INBOX messages
  // Counts occurrences of each CANDIDATE_HEADER
  // Returns header with highest count above MIN_CONSENSUS (3)
  // Returns null if nothing reaches threshold
}
```
[VERIFIED: src/imap/discovery.ts]

### MATCH-06: Evaluator skip logic
```typescript
// Source: src/rules/evaluator.ts lines 6-8
function needsEnvelopeData(rule: Rule): boolean {
  return rule.match.deliveredTo !== undefined || rule.match.visibility !== undefined;
}
// readStatus is explicitly NOT in needsEnvelopeData -- it works without envelope (D-09)
```
[VERIFIED: src/rules/evaluator.ts]

### MATCH-04: Visibility is single-select enum, not multi-select array
```typescript
// Source: src/config/schema.ts line 32
export const visibilityMatchEnum = z.enum(['direct', 'cc', 'bcc', 'list']);
// Source: src/rules/matcher.ts lines 47-50
if (match.visibility !== undefined) {
  if (message.visibility !== match.visibility) return false;
}
```
[VERIFIED: src/config/schema.ts, src/rules/matcher.ts]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Visibility single-select is an acceptable interpretation of MATCH-04's "multi-select" wording | Pitfall 1 | User may want actual multi-select behavior where a rule matches multiple visibility types |

## Open Questions (RESOLVED)

1. **Visibility multi-select vs single-select** (RESOLVED)
   - What we know: MATCH-04 says "multi-select field" but implementation uses single enum. The UI renders a standard dropdown. Each message can only have one visibility classification, so single-select covers the logical use case.
   - **Resolution:** User confirmed single-select is acceptable. Each message has exactly one visibility value (direct/cc/bcc/list), so single-select is the correct design. Mark MATCH-04 as fully satisfied in verification.

## Sources

### Primary (HIGH confidence)
- Source code inspection: `src/imap/discovery.ts`, `src/rules/matcher.ts`, `src/rules/evaluator.ts`, `src/web/routes/envelope.ts`, `src/index.ts`, `src/config/schema.ts`, `src/web/frontend/app.ts`
- Test files: `test/unit/imap/discovery.test.ts`, `test/unit/rules/matcher.test.ts`, `test/unit/rules/evaluator.test.ts`, `test/unit/web/api.test.ts`
- Existing verification artifacts: `.planning/phases/11-pattern-detection/11-VERIFICATION.md` (format reference)
- Full test suite run: 453 tests passing across 28 test files (vitest 4.0.18)

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` - requirement definitions for MATCH-01 through MATCH-06
- `.planning/ROADMAP.md` - phase descriptions and success criteria

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vitest already in use, no new dependencies needed
- Architecture: HIGH - existing verification format from Phase 11, all code inspected directly
- Pitfalls: HIGH - visibility discrepancy confirmed by direct code/schema comparison against requirement text

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable -- verification of existing code, no moving targets)
