# Phase 7: Extended Matchers - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire envelope recipient, header visibility, and read status into matchRule() and the config schema so users can write rules matching on these three new fields. All three fields integrate into the existing first-match-wins evaluation pipeline with AND logic. This phase delivers matcher logic and schema only — UI is Phase 8.

</domain>

<decisions>
## Implementation Decisions

### Config Field Naming
- **D-01:** Envelope recipient match field is named `deliveredTo` in rule YAML config. Maps to the most common header name, short and clear.
- **D-02:** Header visibility match field is named `visibility` in rule YAML config. Consistent with Phase 6 terminology. Values: `direct`, `cc`, `bcc`, `list`.
- **D-03:** Read status match field is named `readStatus` in rule YAML config. Values: `read`, `unread`, `any`. Three-value enum — `any` makes intent explicit even though omitting the field has the same effect.

### Visibility Matching
- **D-04:** Visibility is single-value matching only — each rule matches exactly one visibility value (not an array). Users who need to match multiple visibility values create duplicate rules. This avoids introducing array-type matching that doesn't exist elsewhere in the system.
- **D-05:** Existing `recipient` field stays as-is. `recipient` checks To+CC addresses by glob. `deliveredTo` checks the envelope header. Different use cases, no overlap, both can coexist in the same rule.

### Read Status Behavior
- **D-06:** `readStatus` uses a three-value enum: `read`, `unread`, `any`. Omitting the field is equivalent to `any` but the explicit value is available for clarity.
- **D-07:** Read status is checked at evaluation time in all three contexts (Monitor, Sweep, Batch) with identical behavior. No context-specific special cases. Checks the `\Seen` IMAP flag.

### Unavailable Field Handling (MATCH-06)
- **D-08:** When envelope header is not discovered, any rule that references `deliveredTo` or `visibility` in its match block is skipped entirely. No partial matching — the whole rule is bypassed, not just the unavailable condition.
- **D-09:** `readStatus` is always available (IMAP flags are always fetched) and does not participate in the unavailable-skip logic. Only `deliveredTo` and `visibility` are affected by MATCH-06.

### Claude's Discretion
- Implementation of the skip-check in evaluateRules() vs matchRule() (wherever it fits cleanest)
- Zod schema structure for the new fields in emailMatchSchema (optional fields, enum validation)
- Whether `any` is stored in config or treated as absence during serialization
- Test structure and coverage approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — MATCH-03 (envelope recipient matching), MATCH-04 (visibility matching), MATCH-05 (read status matching)

### Phase 6 Context (upstream dependency)
- `.planning/phases/06-extended-message-data/06-CONTEXT.md` — D-04 through D-08 define how envelope recipient and visibility data are populated on EmailMessage. Phase 7 consumes these fields.

### Existing Code
- `src/rules/matcher.ts` — matchRule() function to extend with three new field checks
- `src/rules/evaluator.ts` — evaluateRules() first-match-wins pipeline, may need skip logic for unavailable fields
- `src/config/schema.ts` — emailMatchSchema to extend with `deliveredTo`, `visibility`, `readStatus` fields
- `src/imap/messages.ts` — EmailMessage type (Phase 6 will have added envelope recipient and visibility fields)
- `src/monitor/index.ts` — Monitor context for understanding how matchRule is called on live messages
- `src/sweep/index.ts` — Sweep context for understanding how matchRule is called on review messages
- `src/batch/index.ts` — Batch context for understanding how matchRule is called retroactively

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `matchRule()` in matcher.ts — existing AND-logic pattern with picomatch globs. New fields follow identical structure.
- `emailMatchSchema` in schema.ts — Zod object with optional fields and refine() for at-least-one. Extend with three new optional fields.
- `picomatch` — already used for case-insensitive glob matching on sender/recipient/subject. Reuse for `deliveredTo` glob matching.
- `EmailMessage.flags` — already carries IMAP flags as `Set<string>`. Read status check is `flags.has('\\Seen')`.

### Established Patterns
- Each match field in matchRule() is a guarded block: check if field is defined, then test with picomatch, return false on mismatch. New fields follow same pattern.
- emailMatchSchema uses `.optional()` for each field with a `.refine()` requiring at least one. New fields are also optional.
- evaluateRules() filters enabled rules, sorts by order, iterates with first-match-wins. Skip logic for unavailable fields fits naturally before the matchRule() call.

### Integration Points
- Config repository — needs to expose envelope header availability status so evaluator can decide whether to skip rules
- emailMatchSchema refine() — needs updating: at least one of the now-six fields required
- Shared types in `src/shared/types.ts` — API response types may need extending for rule display
- Web API rule routes — validation uses the schema, so new fields automatically work in API once schema is updated

</code_context>

<specifics>
## Specific Ideas

- User chose `deliveredTo` over `envelopeRecipient` for brevity — naming should feel natural in YAML, not like a technical specification
- Single-value visibility matching was a deliberate simplicity choice over arrays — user prefers duplicating rules over introducing new matching semantics
- Three-value readStatus enum (including `any`) was chosen for explicit intent in config files — user values readability over minimal config

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-extended-matchers*
*Context gathered: 2026-04-12*
