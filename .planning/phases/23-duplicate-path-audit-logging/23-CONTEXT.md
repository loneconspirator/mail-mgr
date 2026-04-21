# Phase 23: Duplicate Path Audit Logging - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

When the duplicate-rule idempotency check fires during action folder processing (PROC-07), the message is correctly moved to its destination but no activity log entry is written. This phase adds a `logActivity()` call to the duplicate-detected branch so every action folder operation leaves an audit trail, closing the LOG-01/LOG-02 integration gap identified in the v0.6 milestone audit.

This phase does NOT change idempotency behavior, monitoring, rule creation, or any other processing path. The only change is adding a log entry in the existing `if (duplicate)` branch of `processor.ts`.

</domain>

<decisions>
## Implementation Decisions

### Activity Log Entry Shape
- **D-01:** Use `duplicate-skip` and `duplicate-delete` as the action strings for the log entry, distinguishing duplicate-detected events from normal create/remove operations. The suffix matches the rule's action type (`skip` for VIP, `delete` for Block).
- **D-02:** Reference the *existing* duplicate rule (found by `findSenderRule()`) in the log entry — pass its `id` and `name` as `rule_id`/`rule_name` via `buildActionResult()`. This satisfies LOG-02 traceability.

### Log Semantics (Phase 21 D-02 Override)
- **D-03:** Phase 21 D-02 said "Do NOT log to activity" for duplicates. This phase explicitly overrides that decision per the milestone audit finding that the duplicate path needs an audit trail for LOG-01/LOG-02 compliance.
- **D-04:** Keep the existing `logger.debug()` call at processor.ts:61 alongside the new `logActivity()` call. Debug log serves runtime diagnostics (structured JSON to stdout), activity log serves the audit trail (SQLite). Different audiences, both stay.

### Test Coverage
- **D-05:** Test must assert the full activity log entry shape — verify `logActivity` was called with: source `'action-folder'`, action string matching `duplicate-skip` or `duplicate-delete`, and `rule_id`/`rule_name` matching the existing duplicate rule. Catches field-level regressions in LOG-01/LOG-02 compliance.

### Claude's Discretion
- Whether to extract the `duplicate-` prefix as a constant or inline it
- Exact placement of the `logActivity` call relative to the existing debug log
- Test fixture naming and structure within the existing processor.test.ts suite

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit & Requirements
- `.planning/v0.6-MILESTONE-AUDIT.md` — Integration gap finding: "PROC-07 duplicate-rule path silent operation" (the reason this phase exists)
- `.planning/REQUIREMENTS.md` — LOG-01 (action-folder source logging), LOG-02 (rule_id/rule_name in log entries)

### Prior Phase Context
- `.planning/phases/21-idempotency-edge-cases/21-CONTEXT.md` — D-01 through D-03 define the idempotency mechanism; D-02 is overridden by this phase's D-03

### Modification Targets
- `src/action-folders/processor.ts:58-62` — The `if (duplicate)` branch where the new `logActivity()` call goes
- `src/action-folders/processor.ts:109-124` — `buildActionResult()` helper reused for constructing the log entry

### Existing Tests
- `test/unit/action-folders/processor.test.ts` — Existing idempotency tests to extend with activity log assertions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildActionResult(message, action, ruleId, folder)` (processor.ts:109): Private helper already used by create and remove paths — reuse for the duplicate path with `duplicate-skip`/`duplicate-delete` action string
- `findSenderRule(sender, actionType, rules)` (sender-utils.ts): Already called at line 59 — the `duplicate` variable holds the existing rule reference

### Established Patterns
- All action folder log entries use `this.activityLog.logActivity(result, message, rule, 'action-folder')` — the duplicate path follows the same 4-argument pattern
- `buildActionResult` constructs an `ActionResult` with messageUid, messageId, action string, folder, rule ID, and timestamp

### Integration Points
- `src/action-folders/processor.ts:60-61` — Insert `logActivity()` call after the existing `logger.debug()` in the duplicate branch
- No changes to any other files — this is a single-branch, single-file change plus test extension

</code_context>

<specifics>
## Specific Ideas

- The change is ~3 lines in processor.ts: call `buildActionResult(message, \`duplicate-${actionDef.ruleAction}\`, duplicate.id, destination)` then `this.activityLog.logActivity(result, message, duplicate, 'action-folder')` inside the existing `if (duplicate)` block.
- Test extends the existing "does not create duplicate rule" test case to also assert `activityLog.logActivity` was called with the expected entry shape.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-duplicate-path-audit-logging*
*Context gathered: 2026-04-21*
