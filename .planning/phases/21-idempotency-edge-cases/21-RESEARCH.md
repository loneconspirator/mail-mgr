# Phase 21: Idempotency & Edge Cases - Research

**Researched:** 2026-04-20
**Domain:** IMAP action folder processing resilience
**Confidence:** HIGH

## Summary

This phase is a surgical modification to the existing `ActionFolderProcessor.processMessage()` method. The changes are minimal: ~5 lines for idempotency check-before-create, ~2 lines for undo-no-match logging. Crash recovery requires no code changes — it is validated by tests proving idempotency works when a message is reprocessed.

The existing code already has the `findSenderRule()` utility, the conflict detection pattern, and the remove-branch fallthrough behavior. This phase extends what is already there rather than introducing new architecture.

**Primary recommendation:** Add idempotency check after conflict resolution in the create branch, add info log in the remove branch when no rule found, and write tests covering duplicate processing and crash recovery scenarios.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Check-before-create using `findSenderRule(sender, actionDef.ruleAction, rules)` before `configRepo.addRule()`. Skip rule creation if matching sender-only rule already exists with same action type. Message still moved.
- **D-02:** Duplicate detection logged at `debug` level only (not activity log).
- **D-03:** Order: conflict removal -> duplicate check -> create if needed.
- **D-04:** Undo with no matching rule still moves message to destination (INBOX). Already current behavior.
- **D-05:** Add explicit `info`-level log when undo finds no matching rule.
- **D-06:** `ProcessResult` for undo-no-match returns `{ ok: true }`.
- **D-07:** Crash recovery handled implicitly by idempotency + startup pre-scan. No special code path.
- **D-08:** Existing `processing` guard prevents concurrent processing race conditions.

### Claude's Discretion
- Whether idempotency check is separate private method or inline
- Test fixture structure for duplicate/crash-recovery scenarios
- Exact log message wording
- Whether to add `skippedDuplicate: boolean` field to `ProcessResult`

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-07 | Processing the same message twice does not create duplicate rules | Idempotency check via `findSenderRule(sender, actionDef.ruleAction, rules)` after conflict resolution; skip `addRule()` if match found |
| PROC-08 | Undo operations with no matching rule still move the message to its destination | Already works (remove branch falls through to move); add info log for visibility |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase modifies existing code only.

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Unit testing | Already used throughout project |
| pino | (project version) | Logging | Already used for processor logging |

## Architecture Patterns

### Modification Target
```
src/action-folders/processor.ts    # ~5 lines added to create branch, ~2 lines to remove branch
test/unit/action-folders/processor.test.ts  # New describe blocks for idempotency + edge cases
```

### Pattern: Check-Before-Create (Idempotency)
**What:** Before creating a rule, check if an equivalent already exists
**When to use:** Any operation that should be safely repeatable
**Example:**
```typescript
// Source: CONTEXT.md D-01, D-03 — inserted after conflict resolution block (line ~56)
// After conflict removal, before addRule:
const existing = findSenderRule(sender, actionDef.ruleAction, rules);
if (existing) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
  // Skip addRule, still move message below
} else {
  // Create the new rule (existing lines 59-69)
  const label = actionType === 'vip' ? 'VIP' : 'Block';
  createdRule = this.configRepo.addRule({ ... });
  const createResult = this.buildActionResult(...);
  this.activityLog.logActivity(...);
}
```

### Pattern: Graceful No-Match (Undo Edge Case)
**What:** When undo finds no rule to remove, log and continue to message move
**Example:**
```typescript
// Source: CONTEXT.md D-05 — in the remove branch (line ~72)
const existing = findSenderRule(sender, actionDef.ruleAction, rules);
if (existing) {
  this.configRepo.deleteRule(existing.id);
  const removeResult = this.buildActionResult(...);
  this.activityLog.logActivity(...);
} else {
  this.logger.info({ sender, actionType }, 'No matching rule found for undo, moving message to destination');
}
```

### Anti-Patterns to Avoid
- **Separate code path for crash recovery:** D-07 explicitly says no special crash-recovery logic. Idempotency + pre-scan handles it.
- **Error-level logging for no-match undo:** This is a normal operational case (user undoes something already undone), not an error.
- **Skipping message move on duplicate detection:** The message MUST still be moved out of the action folder regardless.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duplicate rule detection | Custom dedup logic | `findSenderRule(sender, actionDef.ruleAction, rules)` | Already exists, handles case-insensitive match and sender-only filtering |
| Crash recovery mechanism | WAL/journal/state machine | Idempotent reprocessing via existing pre-scan | Node single-threaded + poll guard = no races; idempotent replay = correct recovery |

## Common Pitfalls

### Pitfall 1: Stale Rules Snapshot After Conflict Removal
**What goes wrong:** After deleting a conflict rule, the `rules` array still contains it (it was fetched at start of `processMessage`)
**Why it happens:** `configRepo.getRules()` is called once; `deleteRule` mutates storage but not the local array
**How to avoid:** The idempotency check looks for SAME action type, not opposite. The conflict check removes OPPOSITE action type. These never overlap — a sender cannot have both a skip and a skip rule (same type) that would be both a conflict AND a duplicate.
**Warning signs:** Test where sender has both skip and delete rules simultaneously

### Pitfall 2: Activity Log on Duplicate Skip
**What goes wrong:** Logging to activity on duplicate detection creates misleading "rule created" entries
**Why it happens:** Copy-paste from the create path
**How to avoid:** D-02 explicitly says debug-level logger only, NOT activityLog. The duplicate skip is invisible to the user.

### Pitfall 3: Returning ok: false for Undo-No-Match
**What goes wrong:** Treating "no rule to remove" as a failure
**Why it happens:** Seems like an error condition
**How to avoid:** D-06 says return `{ ok: true }`. The user's intent (message in INBOX) is fulfilled.

## Code Examples

### Complete Idempotency Change (create branch)
```typescript
// After conflict resolution (existing lines 48-56), before rule creation:
const duplicate = findSenderRule(sender, actionDef.ruleAction, rules);
if (duplicate) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
} else {
  const label = actionType === 'vip' ? 'VIP' : 'Block';
  createdRule = this.configRepo.addRule({
    name: `${label}: ${sender}`,
    match: { sender },
    action: { type: actionDef.ruleAction },
    enabled: true,
    order: this.configRepo.nextOrder(),
  });
  const createResult = this.buildActionResult(message, actionDef.ruleAction, createdRule.id, destination);
  this.activityLog.logActivity(createResult, message, createdRule, 'action-folder');
}
```

### Undo-No-Match Log Addition (remove branch)
```typescript
// In the remove/else branch:
} else {
  this.logger.info({ sender, actionType }, 'No matching rule found for undo, moving message to destination');
}
```

### Test: Idempotent Duplicate Detection
```typescript
it('does not create duplicate rule when same sender-action already exists (PROC-07)', async () => {
  const existingVip = makeRule({
    id: 'existing-vip',
    name: 'VIP: sender@example.com',
    match: { sender: 'sender@example.com' },
    action: { type: 'skip' } as Rule['action'],
  });
  mockConfigRepo = createMockConfigRepo([existingVip]);
  processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

  const msg = createMessage();
  const result = await processor.processMessage(msg, 'vip');

  expect(result.ok).toBe(true);
  expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(1, 'INBOX', 'Actions/VIP Sender');
});
```

### Test: Crash Recovery Scenario
```typescript
it('handles crash recovery: rule exists but message still in folder (D-07)', async () => {
  // Simulate: previous run created rule but crashed before move
  const existingRule = makeRule({
    id: 'crash-leftover',
    name: 'VIP: sender@example.com',
    match: { sender: 'sender@example.com' },
    action: { type: 'skip' } as Rule['action'],
  });
  mockConfigRepo = createMockConfigRepo([existingRule]);
  processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

  const msg = createMessage();
  const result = await processor.processMessage(msg, 'vip');

  // No duplicate rule created
  expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  // Message still moved to destination
  expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(1, 'INBOX', 'Actions/VIP Sender');
  expect(result.ok).toBe(true);
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/action-folders/processor.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROC-07 | Duplicate processing does not create duplicate rules | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "duplicate"` | Partial (file exists, tests to be added) |
| PROC-08 | Undo with no match still moves message | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "no matching rule"` | Partial (file exists, tests to be added) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/action-folders/processor.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. Test file exists with established fixture patterns.

## Security Domain

Not applicable to this phase. Changes are internal processing logic with no new inputs, no authentication changes, no cryptography, and no user-facing API surface.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

All claims in this research were verified by reading the actual source code and CONTEXT.md decisions. No assumptions needed.

## Open Questions

None. The CONTEXT.md decisions are comprehensive and the existing code is well-understood.

## Sources

### Primary (HIGH confidence)
- `src/action-folders/processor.ts` — actual implementation being modified
- `src/rules/sender-utils.ts` — `findSenderRule()` implementation
- `test/unit/action-folders/processor.test.ts` — existing test patterns
- `.planning/phases/21-idempotency-edge-cases/21-CONTEXT.md` — locked decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, extending existing code
- Architecture: HIGH - pattern already established in codebase (conflict check), just adding parallel check
- Pitfalls: HIGH - identified from reading actual code flow

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable, internal code)
