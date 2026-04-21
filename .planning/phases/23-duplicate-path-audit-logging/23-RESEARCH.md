# Phase 23: Duplicate Path Audit Logging - Research

**Researched:** 2026-04-21
**Domain:** Activity logging / audit trail for action folder duplicate-rule path
**Confidence:** HIGH

## Summary

This phase adds a `logActivity()` call to the duplicate-rule detection branch in `src/action-folders/processor.ts`. Currently, when a duplicate rule is detected during action folder processing (PROC-07), the message is moved to its destination and a `logger.debug()` is emitted, but no activity log entry is written. This creates an audit trail gap for LOG-01/LOG-02 compliance.

The change is approximately 3 lines of production code plus test updates. All infrastructure already exists: `buildActionResult()` constructs the `ActionResult`, `logActivity()` writes to SQLite, and the `duplicate` variable already holds the existing rule reference. No new libraries, schemas, or patterns are needed.

**Primary recommendation:** Add `buildActionResult()` + `logActivity()` calls inside the existing `if (duplicate)` block at processor.ts:60-61, using action strings `duplicate-skip` and `duplicate-delete`. Update existing idempotency tests to assert the activity log entry shape.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `duplicate-skip` and `duplicate-delete` as the action strings for the log entry, distinguishing duplicate-detected events from normal create/remove operations. The suffix matches the rule's action type (`skip` for VIP, `delete` for Block).
- **D-02:** Reference the *existing* duplicate rule (found by `findSenderRule()`) in the log entry -- pass its `id` and `name` as `rule_id`/`rule_name` via `buildActionResult()`. This satisfies LOG-02 traceability.
- **D-03:** Phase 21 D-02 said "Do NOT log to activity" for duplicates. This phase explicitly overrides that decision per the milestone audit finding that the duplicate path needs an audit trail for LOG-01/LOG-02 compliance.
- **D-04:** Keep the existing `logger.debug()` call at processor.ts:61 alongside the new `logActivity()` call. Debug log serves runtime diagnostics (structured JSON to stdout), activity log serves the audit trail (SQLite). Different audiences, both stay.
- **D-05:** Test must assert the full activity log entry shape -- verify `logActivity` was called with: source `'action-folder'`, action string matching `duplicate-skip` or `duplicate-delete`, and `rule_id`/`rule_name` matching the existing duplicate rule. Catches field-level regressions in LOG-01/LOG-02 compliance.

### Claude's Discretion
- Whether to extract the `duplicate-` prefix as a constant or inline it
- Exact placement of the `logActivity` call relative to the existing debug log
- Test fixture naming and structure within the existing processor.test.ts suite

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOG-01 | Action folder operations are logged with `source = 'action-folder'` and standard message fields | `logActivity()` already accepts `'action-folder'` as source; `buildActionResult()` populates all standard fields. Adding the call to the duplicate branch closes the gap. |
| LOG-02 | Activity log entries include rule_id/rule_name for created or removed rules | The `duplicate` variable from `findSenderRule()` at line 59 holds the existing rule with `id` and `name`. Passing it as the 3rd arg to `logActivity()` writes both fields to SQLite. |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase uses only existing project infrastructure.

### Core (Existing)
| Library | Purpose | Already Used |
|---------|---------|--------------|
| vitest | Unit testing | Yes - processor.test.ts |
| better-sqlite3 | Activity log persistence | Yes - ActivityLog class |
| pino | Structured logging (debug) | Yes - processor.ts |

## Architecture Patterns

### Existing Pattern: Activity Logging Call Convention
**What:** All action folder paths use the same 4-argument call pattern [VERIFIED: codebase grep]
```typescript
this.activityLog.logActivity(result, message, rule, 'action-folder');
```
Where `result` comes from `buildActionResult()`.

**The duplicate path follows this exact pattern.** No new abstractions needed.

### Existing Pattern: Action String Convention
**What:** Action strings describe what happened to the rule. Existing strings: `skip`, `delete`, `remove-skip`, `remove-delete` [VERIFIED: processor.ts lines 54, 73, 81]

The new strings `duplicate-skip` and `duplicate-delete` follow this `{prefix}-{ruleAction}` convention per D-01.

### Production Code Change (processor.ts:60-61)

Current code:
```typescript
if (duplicate) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
}
```

After change (approximately):
```typescript
if (duplicate) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
  const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination);
  this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
}
```

### Anti-Patterns to Avoid
- **Creating a new action result builder:** `buildActionResult()` already exists and handles all fields. Do not duplicate it.
- **Changing the `ProcessResult` return type:** The duplicate path already returns `{ ok: true, action, sender }` without a `ruleId` (no rule was *created*). This is correct -- the activity log captures the duplicate rule reference, not the return value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Activity log entry | Custom INSERT | `this.activityLog.logActivity()` | Already handles all 13 columns, null coalescing, timestamp formatting |
| Action result object | Manual object literal | `this.buildActionResult()` | Ensures consistent shape with all other action folder log entries |

## Common Pitfalls

### Pitfall 1: Forgetting to pass the duplicate rule (not null)
**What goes wrong:** Passing `null` as the rule argument to `logActivity()` would write `null` for `rule_id` and `rule_name`, defeating LOG-02.
**How to avoid:** Pass `duplicate` (the variable from line 59) directly -- it is the `Rule` object returned by `findSenderRule()`.

### Pitfall 2: Breaking the existing "does not log activity" test assertion
**What goes wrong:** Test at line 440-452 explicitly asserts `logActivity` was NOT called for duplicates. This test MUST be updated (not just added to) since the behavior is intentionally changing per D-03.
**How to avoid:** Replace the "does not log activity when duplicate detected" test with one that asserts the correct activity log entry shape.

### Pitfall 3: Conflict + duplicate scenario
**What goes wrong:** When a conflict is removed AND a duplicate is detected (lines 455-479 in test), there are now TWO `logActivity` calls: one for conflict removal, one for duplicate detection. The test at line 478 currently asserts `toHaveBeenCalledTimes(1)` -- this must become `toHaveBeenCalledTimes(2)`.
**How to avoid:** Update the conflict+duplicate test to expect 2 calls and verify each call's arguments distinctly.

## Code Examples

### The exact logActivity signature [VERIFIED: src/log/index.ts:87]
```typescript
logActivity(
  result: ActionResult,
  message: EmailMessage,
  rule: Rule | null,
  source: 'arrival' | 'sweep' | 'batch' | 'action-folder' = 'arrival'
): void
```

### The buildActionResult signature [VERIFIED: processor.ts:109-124]
```typescript
private buildActionResult(
  message: EmailMessage,
  action: string,
  ruleId: string,
  folder: string,
): ActionResult
```

### Test assertion pattern for the new log entry [VERIFIED: existing test patterns in processor.test.ts]
```typescript
expect((mockActivityLog.logActivity as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
  expect.objectContaining({
    success: true,
    messageUid: 1,
    action: 'duplicate-skip', // or 'duplicate-delete' for block
    rule: 'existing-vip',     // the duplicate rule's ID
  }),
  msg,
  expect.objectContaining({ id: 'existing-vip' }),
  'action-folder',
);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/action-folders/processor.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOG-01 | Duplicate path writes activity log with source='action-folder' | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | Exists (needs update) |
| LOG-02 | Activity log entry includes rule_id/rule_name of duplicate rule | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | Exists (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/action-folders/processor.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Tests need updating, not creating from scratch.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

**All claims in this research were verified via codebase inspection. No user confirmation needed.**

## Open Questions

None. The code is straightforward, all patterns are established, and decisions are locked.

## Sources

### Primary (HIGH confidence)
- `src/action-folders/processor.ts` - Production code with duplicate branch (lines 58-62), buildActionResult (lines 109-124)
- `src/log/index.ts:87` - logActivity signature and SQLite INSERT
- `test/unit/action-folders/processor.test.ts` - Existing test suite with idempotency tests (lines 383-479)
- `src/action-folders/registry.ts` - ACTION_REGISTRY defining ruleAction values

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing infrastructure
- Architecture: HIGH - pattern is copy of adjacent code paths
- Pitfalls: HIGH - identified 3 specific test assertions that must change

**Research date:** 2026-04-21
**Valid until:** Indefinite (stable internal codebase patterns)
