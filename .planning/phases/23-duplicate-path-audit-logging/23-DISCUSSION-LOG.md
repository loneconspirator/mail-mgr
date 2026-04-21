# Phase 23: Duplicate Path Audit Logging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 23-duplicate-path-audit-logging
**Areas discussed:** Activity log entry shape, Log semantics vs Phase 21 D-02, Test coverage shape

---

## Activity Log Entry Shape

### Action String

| Option | Description | Selected |
|--------|-------------|----------|
| duplicate-skip / duplicate-delete | New action strings that clearly distinguish duplicate-detected events from normal create/remove. Uses rule's action type as suffix. | ✓ |
| skip / delete (same as create) | Reuse existing action strings. Simpler, but log entry looks identical to normal creation. | |
| You decide | Claude picks based on existing patterns. | |

**User's choice:** duplicate-skip / duplicate-delete
**Notes:** User wanted clarification on what "duplicate path" means before answering. After explanation of the crash-recovery reprocessing scenario, confirmed the recommended approach.

### Rule Reference

| Option | Description | Selected |
|--------|-------------|----------|
| The existing duplicate rule | Pass the existing rule found by findSenderRule() — real id and name for traceability. | ✓ |
| No rule reference | Log with no rule_id/rule_name. Simpler but loses traceability. | |
| You decide | Claude picks based on LOG-02 requirements. | |

**User's choice:** The existing duplicate rule
**Notes:** None

---

## Log Semantics vs Phase 21 D-02

### Debug Log Alongside Activity Log

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both | Debug log for runtime diagnostics (stdout), activity log for audit trail (SQLite). Different audiences. | ✓ |
| Remove debug log | Activity log covers this case — debug log is redundant. | |
| You decide | Claude picks based on existing patterns. | |

**User's choice:** Keep both
**Notes:** None

---

## Test Coverage Shape

### Test Assertion Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Assert full entry shape | Verify logActivity called with source='action-folder', correct action string, matching rule_id/rule_name. | ✓ |
| Assert logActivity called | Just verify logActivity was called once. Simpler but no field-level regression coverage. | |
| You decide | Claude picks based on existing test patterns. | |

**User's choice:** Assert full entry shape
**Notes:** None

---

## Claude's Discretion

- Whether to extract the `duplicate-` prefix as a constant or inline it
- Exact placement of logActivity call relative to existing debug log
- Test fixture naming and structure

## Deferred Ideas

None
