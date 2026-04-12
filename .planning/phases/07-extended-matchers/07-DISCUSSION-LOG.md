# Phase 7: Extended Matchers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 07-extended-matchers
**Areas discussed:** Config field naming, Visibility matching, Read status behavior, Unavailable field handling

---

## Config Field Naming

### Envelope recipient field name

| Option | Description | Selected |
|--------|-------------|----------|
| envelopeRecipient | Explicit, clearly distinct from 'recipient'. Verbose but unambiguous. | |
| deliveredTo | Maps to most common header name. Shorter. | ✓ |
| envelope | Shortest. Could confuse with IMAP envelope concept. | |

**User's choice:** deliveredTo
**Notes:** None

### Visibility field name

| Option | Description | Selected |
|--------|-------------|----------|
| visibility | Matches Phase 6 terminology. Values: direct, cc, bcc, list. | ✓ |
| headerVisibility | More explicit about derivation. Longer. | |
| addressedAs | User-facing natural language concept. | |

**User's choice:** visibility
**Notes:** None

### Read status field name

| Option | Description | Selected |
|--------|-------------|----------|
| readStatus | Explicit two-word name. Values: read/unread. | ✓ |
| read | Boolean-style — true/false. Shortest. | |
| seen | Maps to IMAP \Seen flag. Technical. | |

**User's choice:** readStatus
**Notes:** None

---

## Visibility Matching

### Multi-select semantics

| Option | Description | Selected |
|--------|-------------|----------|
| OR within, AND with others | visibility: [direct, cc] means OR. ANDs with other fields. | |
| Single value only | Each rule matches exactly one visibility value. Duplicate rules for multiple. | ✓ |

**User's choice:** Single value only
**Notes:** Avoids introducing array-type matching that doesn't exist elsewhere in the system.

### Coexistence with existing recipient field

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as-is | recipient continues checking To+CC. deliveredTo checks envelope header. No conflict. | ✓ |
| Deprecate recipient | Phase out recipient since deliveredTo + visibility covers same ground. | |

**User's choice:** Keep as-is
**Notes:** Different tools for different jobs.

---

## Read Status Behavior

### Value enum

| Option | Description | Selected |
|--------|-------------|----------|
| read / unread only | Omitting = any. No explicit 'any' value. | |
| read / unread / any | Three-value enum. 'any' makes intent explicit in YAML. | ✓ |

**User's choice:** read / unread / any
**Notes:** User values explicit intent in config files.

### Evaluation context

| Option | Description | Selected |
|--------|-------------|----------|
| All contexts, same behavior | Check \Seen flag at evaluation time in Monitor, Sweep, and Batch. | ✓ |
| Skip in Monitor context | Don't evaluate readStatus for live arrivals since always unread. | |

**User's choice:** All contexts, same behavior
**Notes:** No special cases. Check flag at evaluation time, period.

---

## Unavailable Field Handling

### Skip scope

| Option | Description | Selected |
|--------|-------------|----------|
| Skip entire rule | If any field references unavailable data, whole rule skipped. Safe default. | ✓ |
| Ignore unavailable condition | Skip only the unavailable condition, evaluate rest. Flexible but risky. | |
| Disable + warn | Skip rule AND log warning. Same as skip but with visibility. | |

**User's choice:** Skip entire rule
**Notes:** No partial matching, no surprises.

### readStatus availability

| Option | Description | Selected |
|--------|-------------|----------|
| Always available | IMAP flags always fetched. readStatus never needs skip logic. | ✓ |
| Same skip pattern | Treat like deliveredTo/visibility for consistency. Defensive but unnecessary. | |

**User's choice:** Always available
**Notes:** Flags come with every IMAP fetch. Only deliveredTo and visibility get unavailable-skip treatment.

---

## Claude's Discretion

- Implementation placement of skip-check (evaluateRules vs matchRule)
- Zod schema structure for new fields
- Whether `any` is stored or treated as absence during serialization
- Test structure and coverage

## Deferred Ideas

None — discussion stayed within phase scope
