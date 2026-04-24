# Phase 33: Action Folder Safety Hardening - Research

**Researched:** 2026-04-24
**Domain:** IMAP action-folder polling, bug fixes, diagnostic logging
**Confidence:** HIGH

## Summary

This phase fixes two confirmed bugs in the action-folder processor and adds a sentinel-aware optimization to the poller. The bugs were identified in the 2026-04-23 incident (activity log flood from stuck messages reprocessed every 15 seconds). The circuit breaker was dropped per user decision -- batch operations are a legitimate use case.

The three changes are surgical: (1) poller skips `fetchAllMessages` when `status.messages === 1` (only sentinel present), (2) processor moves `logActivity` after `moveMessage` and adds early return after duplicate detection, (3) diagnostic logging adds sender/subject/message-id/UID to every processed message.

**Primary recommendation:** Fix the two processor bugs (D-05, D-06) first, then add sentinel-aware skip (D-01/D-02/D-03), then diagnostic logging (D-07). All changes are in 2 files: `poller.ts` and `processor.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Poller uses simple count check -- if `status.messages === 1`, assume it's the sentinel and skip `fetchAllMessages`. No DB query, no sentinel store lookup.
- **D-02:** If `status.messages === 0` (sentinel missing), skip fetch entirely. The existing sentinel scanner/auto-healer (v0.7 Phase 30-31) handles re-planting on its own cycle.
- **D-03:** If `status.messages > 1`, proceed with normal `fetchAllMessages` and processing.
- **D-04:** No circuit breaker. Batch operations are a legitimate use case. DROPPED.
- **D-05:** Fix activity logging order -- move `logActivity` call to AFTER `moveMessage` succeeds, not before. Currently `buildActionResult` hardcodes `success: true` and logs before the move, so failed moves show as successful.
- **D-06:** Add early return after duplicate detection path. Currently `processor.ts:66-70` logs the duplicate but falls through to `moveMessage`. With D-05 (log after move), this becomes: detect duplicate -> move message -> log activity -> return. No fall-through to the create path.
- **D-07:** Log sender, subject, message-id, and UID for every message processed from action folders. Full diagnostic payload for tracing phantom messages.

### Claude's Discretion
- Sentinel-aware skip log level (debug vs info vs hybrid) -- D-01 skip fires every 15s per folder, so noise is a factor
- Diagnostic logging destination (pino only vs pino + activity log) -- balance between ops debugging and user-visible audit trail

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Architecture Patterns

### Current Code Structure (No New Files Needed)

```
src/action-folders/
  poller.ts       -- ActionFolderPoller.scanAll() - sentinel-aware skip goes here
  processor.ts    -- ActionFolderProcessor.processMessage() - bug fixes + diagnostic logging
  registry.ts     -- ACTION_REGISTRY (read-only, no changes needed)
```

### Pattern 1: Sentinel-Aware Skip in Poller (D-01, D-02, D-03)

**What:** Before calling `fetchAllMessages`, check `status.messages` count against expected sentinel count (1 per folder). Skip fetch entirely when only sentinels are present.

**Current code (poller.ts lines 37-41):**
```typescript
const { messages } = await this.deps.client.status(path);
if (messages === 0) continue;

this.deps.logger.info({ folder: path, count: messages }, 'Processing action folder');
const rawMessages = await this.deps.client.fetchAllMessages(path);
```

**Target behavior:**
- `messages === 0`: skip (D-02) -- sentinel auto-healer handles re-planting
- `messages === 1`: skip with debug log (D-01) -- assume it's the sentinel
- `messages > 1`: proceed normally (D-03) -- real messages present

**Implementation note:** The current code already skips when `messages === 0` (line 38). The change extends this to also skip when `messages === 1`. The `sentinelCount` tracking in the processing loop (line 43) and the FOLD-02 retry sentinel-aware logic (lines 52-53) remain intact for when `messages > 1` and we actually fetch. [VERIFIED: src/action-folders/poller.ts]

**Log level recommendation:** Use `debug` for the skip log. This fires every 15 seconds per folder (4 folders = every 3.75 seconds effectively). Even `info` level would drown out meaningful logs. The skip is the normal/expected state -- only deviations (actual messages) merit `info`. [ASSUMED]

### Pattern 2: Post-Move Activity Logging (D-05)

**What:** Move `logActivity` calls to AFTER the `moveMessage` succeeds. Fix `buildActionResult` to accept a `success` parameter instead of hardcoding `true`.

**Current bug (processor.ts):**
```typescript
// Lines 82-83: Activity logged BEFORE move
const createResult = this.buildActionResult(message, actionDef.ruleAction, createdRule.id, destination);
this.activityLog.logActivity(createResult, message, createdRule, 'action-folder');

// Lines 98-103: Move happens after, may fail
await this.client.moveMessage(message.uid, destination, sourceFolder);
```

**The fix restructure:** All activity logging must move after the `moveMessage` call at line 99. The `buildActionResult` method must accept a `success` boolean parameter instead of hardcoding `true`. On move failure (catch block), log with `success: false`. [VERIFIED: src/action-folders/processor.ts]

**Important:** The conflict resolution path (lines 57-63) also logs activity before the move. The removal activity log for conflict resolution should also move after the successful move. This means we need to accumulate "pending" activity log entries and flush them after the move succeeds.

### Pattern 3: Early Return After Duplicate Detection (D-06)

**What:** After detecting a duplicate rule, move the message to destination, log activity, and return. Do not fall through to the create path.

**Current bug (processor.ts lines 66-70):**
```typescript
if (duplicate) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
  const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination);
  this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
  // BUG: No return here -- falls through to else (create) path? No, it's in an if/else.
}
```

**Wait -- re-reading the code more carefully:** The duplicate check is inside an `if/else` block (lines 66-84). The duplicate branch (lines 66-70) is inside the `if (duplicate)` block, and the create branch is in the `else` (lines 71-84). So the duplicate detection DOES NOT fall through to the create path. BUT it DOES fall through to the `moveMessage` call at line 99 (which is outside the if/else), which is actually correct behavior -- the message needs to be moved out of the action folder.

**Re-reading CONTEXT.md D-06:** "Currently processor.ts:66-70 logs the duplicate but falls through to moveMessage. With D-05 (log after move), this becomes: detect duplicate -> move message -> log activity -> return."

So the issue is NOT that duplicate falls through to create. The issue is that with D-05 (log after move), the duplicate path needs its own move + log + return sequence. Currently it relies on the shared moveMessage at line 99 which is fine, but when we restructure for D-05, we need the duplicate path to explicitly: move, log, return. [VERIFIED: src/action-folders/processor.ts]

### Pattern 4: Diagnostic Logging (D-07)

**What:** Log sender, subject, message-id, and UID for every message processed from action folders.

**Implementation:** Add a structured pino log call early in `processMessage`, after sender extraction but before any business logic:

```typescript
this.logger.info({
  uid: message.uid,
  messageId: message.messageId,
  sender,
  subject: message.subject,
  actionType,
}, 'Processing action folder message');
```

**Log destination recommendation:** Pino structured logging only (not activity log). The activity log is for user-visible audit trail of rule changes. Diagnostic logging is for ops debugging of phantom messages. Mixing them would pollute the activity UI. [ASSUMED]

### Restructured processMessage Flow

After all fixes, the `processMessage` flow should be:

1. Sentinel guard (existing, unchanged)
2. Extract sender (existing, unchanged)
3. **NEW: Diagnostic log (D-07)** -- sender, subject, messageId, uid
4. Business logic (conflict resolution, duplicate detection, rule creation/removal)
5. Move message
6. **MOVED: Log activity** (D-05) -- only after successful move
7. Return result

For the duplicate path specifically (D-06):
1. Detect duplicate
2. Move message to destination
3. Log duplicate activity (with success based on move result)
4. Return early

### Anti-Patterns to Avoid
- **Logging before side effects:** Never log success before the operation completes. This was the root cause of the incident. [VERIFIED: false-trash-activities.md]
- **Fall-through without return:** When a branch completes its work, always return explicitly. Do not rely on downstream shared code that may have been restructured. [VERIFIED: false-trash-activities.md]
- **Accumulating state for deferred logging:** Keep it simple -- each path (create, duplicate, remove, conflict) should handle its own move + log + return. Don't try to collect pending log entries into an array.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured logging | Custom log format | Pino child logger (already in use) | Consistent JSON output, log levels, context binding |

**Key insight:** This phase is all bug fixes and simple optimizations in existing code. No new libraries or patterns needed. [VERIFIED: codebase review]

## Common Pitfalls

### Pitfall 1: Breaking Existing Tests
**What goes wrong:** The processor and poller both have comprehensive test suites (processor.test.ts: 660+ lines, poller.test.ts: 460+ lines). Restructuring the activity logging order will break tests that assert `logActivity` was called with specific arguments.
**Why it happens:** Tests currently assert `success: true` in activity log calls. Moving logging after move means tests need to mock `moveMessage` to resolve successfully before activity logging assertions work.
**How to avoid:** Update tests alongside code changes. The mock client already has `moveMessage: vi.fn().mockResolvedValue(undefined)` so most tests should work, but the "move failure" test (line 369) specifically tests the failure path and will need updating.
**Warning signs:** Tests pass individually but fail in sequence, or activity log assertions fail because logging now happens after move.

### Pitfall 2: Sentinel Skip Masking Real Problems
**What goes wrong:** If a real message arrives at the same time the sentinel is present, `status.messages === 2` correctly triggers fetch. But if the sentinel is missing AND a real message arrives, `status.messages === 1` would be incorrectly skipped as "sentinel only."
**Why it happens:** D-01 uses count-based detection, not content-based.
**How to avoid:** This edge case is accepted per the context discussion. The sentinel auto-healer will re-plant the sentinel, and the next poll cycle (15s later) will see `status.messages === 2` and process normally. The race window is tiny. [VERIFIED: 33-CONTEXT.md]
**Warning signs:** Messages stuck in action folders for longer than expected (30s+ instead of 15s).

### Pitfall 3: Conflict Resolution Activity Logging
**What goes wrong:** The conflict resolution path (lines 57-63) logs removal of the conflicting rule BEFORE the move happens. With D-05, this removal activity log also needs to move after the successful moveMessage.
**Why it happens:** There are actually 4 paths that log activity: (1) conflict removal, (2) duplicate detection, (3) new rule creation, (4) undo/remove. All 4 currently log before the move.
**How to avoid:** Ensure ALL activity logging paths are restructured, not just the obvious ones. Accumulate the activity entries to log, then flush after move succeeds.
**Warning signs:** Conflict resolution still shows success when move fails.

### Pitfall 4: FOLD-02 Retry with Sentinel Skip
**What goes wrong:** After adding the sentinel-aware skip, the FOLD-02 retry logic (poller.ts lines 50-68) should be mostly unreachable for sentinel-only folders since we skip them at the top. But when `messages > 1`, the existing retry logic still works correctly.
**Why it happens:** The sentinel skip is upstream of the fetch+process loop.
**How to avoid:** No action needed -- the FOLD-02 retry is naturally bypassed. But ensure the sentinel skip comes before the `fetchAllMessages` call. [VERIFIED: poller.ts line ordering]

## Code Examples

### Sentinel-Aware Skip (poller.ts)
```typescript
// Source: Current poller.ts lines 37-41, modified per D-01/D-02/D-03
const { messages } = await this.deps.client.status(path);
if (messages === 0) {
  this.deps.logger.debug({ folder: path }, 'Action folder empty (sentinel missing), skipping');
  continue;
}
if (messages === 1) {
  this.deps.logger.debug({ folder: path }, 'Action folder has only sentinel, skipping fetch');
  continue;
}

this.deps.logger.info({ folder: path, count: messages }, 'Processing action folder');
const rawMessages = await this.deps.client.fetchAllMessages(path);
```

### Diagnostic Logging (processor.ts)
```typescript
// Source: New code after sender extraction, per D-07
this.logger.info({
  uid: message.uid,
  messageId: message.messageId,
  sender,
  subject: message.subject,
  actionType,
  folder: sourceFolder,
}, 'Processing action folder message');
```

### Post-Move Activity Logging Pattern (processor.ts)
```typescript
// Source: Restructured processMessage pattern per D-05/D-06
// For each path: do business logic, then move, then log, then return

// Example: duplicate detection path (D-06)
if (duplicate) {
  this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
  try {
    await this.client.moveMessage(message.uid, destination, sourceFolder);
  } catch (err) {
    this.logger.error({ uid: message.uid, err }, 'Failed to move duplicate message');
    return { ok: false, action: actionType, error: 'Message move failed' };
  }
  const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination, true);
  this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
  return { ok: true, action: actionType, sender, ruleId: duplicate.id };
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts (assumed) |
| Quick run command | `npx vitest run test/unit/action-folders/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | Poller skips fetch when messages === 1 | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "sentinel"` | Needs new test |
| D-02 | Poller skips fetch when messages === 0 (already works) | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "empty"` | Existing (passes) |
| D-03 | Poller fetches when messages > 1 | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "messages"` | Existing (passes) |
| D-05 | Activity logged after moveMessage, success reflects move result | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "activity"` | Needs update |
| D-06 | Duplicate path returns early after move+log | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "duplicate"` | Needs update |
| D-07 | Diagnostic log includes sender/subject/messageId/uid | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "diagnostic"` | Needs new test |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/action-folders/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] New test: poller sentinel-aware skip (messages === 1 skips fetch)
- [ ] Update test: processor activity logging assertions (success after move, not before)
- [ ] Update test: processor duplicate path early return
- [ ] New test: diagnostic logging emits expected fields
- [ ] Update test: buildActionResult accepts success parameter

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Debug level is appropriate for sentinel-skip logs (fires every 15s per folder) | Architecture Patterns - Pattern 1 | Noisy logs if set to info, but easily changed |
| A2 | Diagnostic logging should go to pino only, not activity log | Architecture Patterns - Pattern 4 | User might want phantom message diagnostics visible in UI |

## Open Questions

1. **buildActionResult restructure scope**
   - What we know: Currently hardcodes `success: true`. Needs to accept a boolean parameter.
   - What's unclear: Whether to also add an `error` field to ActionResult for failed moves (the interface already has `error?: string`).
   - Recommendation: Add `success` parameter to `buildActionResult`. Pass `error` from catch block. The `ActionResult` interface already supports both fields.

2. **Conflict resolution activity log timing**
   - What we know: Conflict removal logs activity at line 62, before the move at line 99.
   - What's unclear: Should conflict removal activity be logged even if the subsequent move fails? The rule deletion already happened (no rollback per existing design).
   - Recommendation: Log conflict removal after move succeeds. If move fails, only the error return is emitted -- the rule deletion still stands but the activity record reflects the move failure.

## Sources

### Primary (HIGH confidence)
- `src/action-folders/poller.ts` -- full code review, line-by-line analysis
- `src/action-folders/processor.ts` -- full code review, bug identification confirmed
- `src/action-folders/registry.ts` -- ACTION_REGISTRY definitions
- `src/sentinel/detect.ts` -- isSentinel implementation
- `src/imap/messages.ts` -- EmailMessage interface (includes headers?: Map)
- `src/actions/index.ts` -- ActionResult interface (includes success, error fields)
- `.planning/debug/false-trash-activities.md` -- root cause analysis, full elimination log
- `test/unit/action-folders/processor.test.ts` -- 660+ lines, comprehensive coverage
- `test/unit/action-folders/poller.test.ts` -- 460+ lines, comprehensive coverage

### Secondary (MEDIUM confidence)
- `.planning/phases/33-action-folder-safety-hardening/33-CONTEXT.md` -- user decisions and canonical refs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all changes in existing files
- Architecture: HIGH -- code fully reviewed, bugs confirmed, fix paths clear
- Pitfalls: HIGH -- incident root cause documented with evidence chain

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable -- bugfix phase, no external dependencies)
