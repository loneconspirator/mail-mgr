---
phase: 28-sentinel-planting-lifecycle
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/sentinel/lifecycle.ts
  - src/index.ts
  - src/sentinel/index.ts
  - test/unit/sentinel/lifecycle.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 28: Code Review Report

**Reviewed:** 2026-04-21
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the sentinel planting lifecycle implementation: `collectTrackedFolders`, `reconcileSentinels`, their integration wiring in `src/index.ts`, the barrel export, and the unit test suite.

The core lifecycle logic is clean and well-structured. Error isolation per-folder is implemented correctly. The cross-cutting concern is one real logic gap in `index.ts`: `reconcileSentinels` is invoked inside `onRulesChange` with the captured `imapClient` reference, which is correct, but without awaiting a guard that confirms the client is connected — a rules change arriving during IMAP reconnect will fire reconciliation against a potentially-disconnected client. The second warning is an incomplete test coverage gap for a specific error path in `reconcileSentinels`.

---

## Warnings

### WR-01: Sentinel reconciliation in `onRulesChange` is not guarded against a mid-reconnect IMAP client

**File:** `src/index.ts:87-91`

**Issue:** `onRulesChange` fires `reconcileSentinels(tracked, sentinelStore, imapClient, logger)` using the outer `imapClient` `let` binding. If a rules-config change arrives while `onImapConfigChange` is in-flight (i.e., `imapClient.disconnect()` has been called but `new ImapClient(...)` has not yet been connected), `reconcileSentinels` will call `appendSentinel` / `findSentinel` against a disconnected client. The per-folder `try/catch` will absorb the errors (incrementing the `errors` counter) rather than crashing, but all planting/removal operations will silently fail without any indication that the client was not ready.

The same pattern exists in `onReviewConfigChange` (line 121) and `onActionFolderConfigChange` (line 158), but those are `async` handlers that `await` their own IMAP work before calling reconciliation, making concurrent reconnect less likely. The `onRulesChange` handler is synchronous and does not await anything before spawning the reconciliation.

**Fix:** Gate the reconciliation on `sentinelEnabled` (already done) and also verify the client is connected before firing, or track a `isImapReconnecting` boolean that is set to `true` at the start of `onImapConfigChange` and cleared after reconnect. Simplest safe approach:

```typescript
// In onImapConfigChange, at the top of the handler:
let isReconnecting = false;  // hoist to same scope as sentinelEnabled

// onRulesChange handler:
configRepo.onRulesChange((rules) => {
  monitor.updateRules(rules);
  if (sweeper) sweeper.updateRules(rules);
  batchEngine.updateRules(rules);
  if (sentinelEnabled && !isReconnecting) {
    const updatedConfig = configRepo.getConfig();
    const tracked = collectTrackedFolders(updatedConfig);
    reconcileSentinels(tracked, sentinelStore, imapClient, logger)
      .catch(err => logger.error({ err }, 'Sentinel reconciliation failed after rules change'));
  }
});
```

---

### WR-02: Missing test for `deleteSentinel` throw path in `reconcileSentinels`

**File:** `test/unit/sentinel/lifecycle.test.ts:312-325`

**Issue:** The "continues after individual cleanup failure" test only covers the case where `findSentinel` throws. There is no test for the case where `findSentinel` resolves with a UID but `deleteSentinel` subsequently throws. In that path (lines 99 in `lifecycle.ts`), the `catch` block increments `errors` and the `removed` counter is NOT incremented — which is the correct behavior, but it is untested. If `removedCounter` logic were accidentally placed inside the `try` block before the `await deleteSentinel` call, it would be undetected.

**Fix:** Add a test case:

```typescript
it('counts error but not removal when deleteSentinel throws', async () => {
  const tracked = new Map<string, FolderPurpose>();
  const sentinel = makeSentinel('OldFolder');
  const store = createMockStore([sentinel]);
  const client = createMockClient();
  const logger = createMockLogger();
  mockFindSentinel.mockResolvedValue(42);
  mockDeleteSentinel.mockRejectedValueOnce(new Error('delete failed'));

  const result = await reconcileSentinels(tracked, store as any, client as any, logger);
  expect(result.errors).toBe(1);
  expect(result.removed).toBe(0);
});
```

---

## Info

### IN-01: `?? undefined` is a no-op and obscures intent

**File:** `src/index.ts:302`

**Issue:** The expression `(initialHeader ?? undefined)` evaluates `null ?? undefined` to `undefined`, making `?? undefined` a no-op. The `??` operator already returns the right-hand side only when the left is `null` or `undefined`, so `null ?? undefined` is `undefined` — same as just `initialHeader` after TypeScript widens the type. The intent appears to be normalizing `null` to `undefined` for strict equality comparison against `config.imap.envelopeHeader` (which is `string | undefined`), but the comparison `initialHeader !== config.imap.envelopeHeader` would work identically since `null !== undefined` in TypeScript strict mode anyway.

**Fix:**
```typescript
// Replace:
if ((initialHeader ?? undefined) !== config.imap.envelopeHeader) {

// With either:
if (initialHeader !== config.imap.envelopeHeader) {
// (null !== undefined is true in strict mode — same behavior)

// Or, if the intent is to treat null and undefined as equivalent:
if ((initialHeader ?? undefined) !== config.imap.envelopeHeader) {
// Keep but add a comment explaining the null→undefined normalization intent
```

---

### IN-02: `configRepo.getConfig()` called twice within `onReviewConfigChange`

**File:** `src/index.ts:96` and `src/index.ts:120`

**Issue:** `onReviewConfigChange` calls `configRepo.getConfig()` at line 96 (assigned to `updatedConfig`) and again at line 120 for sentinel reconciliation. Since no config mutations occur between those two calls in this handler, both reads return the same object, making the second call redundant. It's not a bug, but it suggests `updatedConfig` from line 96 could simply be reused, which is more consistent with how the rest of the handler uses it.

**Fix:**
```typescript
// Replace line 120:
const trackedReview = collectTrackedFolders(configRepo.getConfig());

// With:
const trackedReview = collectTrackedFolders(updatedConfig);
```

---

_Reviewed: 2026-04-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
