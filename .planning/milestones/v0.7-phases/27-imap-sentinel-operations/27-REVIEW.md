---
phase: 27-imap-sentinel-operations
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/imap/client.ts
  - src/imap/index.ts
  - src/sentinel/imap-ops.ts
  - src/sentinel/index.ts
  - test/unit/imap/client.test.ts
  - test/unit/sentinel/imap-ops.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 27: Code Review Report

**Reviewed:** 2026-04-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This phase adds `ImapClient` (connection management, IDLE/polling, mailbox operations) and `sentinel/imap-ops.ts` (append/find/delete/self-test for sentinel messages). The architecture is clean and the happy-path logic is solid. No security vulnerabilities or data-loss bugs found.

Three warnings flag correctness edge cases worth fixing before shipping: a null-dereference window in `withMailboxSwitch` after an unexpected close, a missing test assertion in the self-test cleanup path, and a misleading test that passes even when NOOP fires on the wrong flow. Three info items cover dead code and minor quality points.

## Warnings

### WR-01: `withMailboxSwitch` dereferences `this.flow` after it may have been nulled by a concurrent close event

**File:** `src/imap/client.ts:163`
**Issue:** The `finally` block calls `this.flow!.mailboxOpen('INBOX')` using a non-null assertion. However, `stopIdleAndPoll()` is called at the top of the method and the `fn` callback is `await`-ed (line 159), which yields the microtask queue. A concurrent IMAP `close` event processed during that await will call `handleClose()` → `cleanupFlow()`, setting `this.flow = null`. The subsequent `this.flow!.mailboxOpen(...)` then throws at runtime despite the `!` assertion, bypassing TypeScript's guard. The wrapping `try/catch` (lines 162–165) will catch it silently, but `startIdleOrPoll()` (line 167) will then call `startIdleCycling()` → `cycleIdle()`, which checks `this.flow?.usable` and silently no-ops — so the IDLE timer loops forever without effect, leaking timer resources.
**Fix:**
```typescript
finally {
  lock.release();
  if (this.flow) {            // guard against concurrent close
    try {
      await this.flow.mailboxOpen('INBOX');
    } catch {
      // best-effort reopen
    }
  }
  this.startIdleOrPoll();
}
```

### WR-02: `runSentinelSelfTest` cleanup branch for "no UIDPLUS" never runs in tests — the branch condition has an impossible overlap

**File:** `src/sentinel/imap-ops.ts:107`
**Issue:** The cleanup logic in `finally` has two branches:
1. `if (appendedUid !== undefined)` — delete by UID (lines 101–106)
2. `else if (appendedMessageId)` — fallback search then delete (lines 107–117)

Branch 2 is the intended path when the server lacks UIDPLUS and returns `uid: undefined`. However, `appendSentinel` always returns `{ messageId, uid: result.uid }`, and the mock in `createMockClient` always returns `uid: 1`. The test "cleans up even when SEARCH throws" (imap-ops.test.ts:146) exercises branch 2 in a roundabout way only if APPEND returns `uid: undefined`. There is no test that directly exercises the `appendedUid === undefined && appendedMessageId !== undefined` path. Additionally, `appendedMessageId` is set in the `try` block before `appendedUid` — if `findSentinel` throws after a successful APPEND that returned no UID, the fallback search uses `appendedMessageId` correctly; but if APPEND itself sets `appendedMessageId` and does NOT set `appendedUid`, and then SEARCH throws in the fallback (the inner `findSentinel` call), the outer `catch {}` silently swallows it. This is intentional per the comment, but the lack of coverage means it has never been exercised.

**Fix:** Add a test that stubs `appendMessage` to return `uid: undefined` and verifies the fallback search-then-delete path runs:
```typescript
it('cleans up via search when APPEND returns no UID', async () => {
  const client = createMockClient({
    appendMessage: vi.fn(async () => ({ destination: 'TestFolder', uid: undefined })),
    searchByHeader: vi.fn(async () => []),   // search finds nothing — still shouldn't throw
  });
  const logger = createMockLogger();
  const result = await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
  expect(result).toBe(false);
  expect(client.searchByHeader).toHaveBeenCalledTimes(2); // once for self-test, once for cleanup
});
```

### WR-03: `withMailboxSwitch` test asserts IDLE resumes on the original mock flow, but after a real reconnect the new flow would be used — test passes trivially regardless of IDLE state

**File:** `test/unit/imap/client.test.ts:642`
**Issue:** In the "pauses IDLE, locks folder, executes fn, reopens INBOX, resumes IDLE" test, after `withMailboxSwitch` completes the test advances timers and asserts `mockFlow.noop` was called. This works because no reconnect happened. However if the implementation bug in WR-01 existed and IDLE was started without a valid flow, `cycleIdle` would silently no-op (checking `this.flow?.usable`) and `mockFlow.noop` would still not be called — meaning the test would correctly fail. But the assertion is `toHaveBeenCalled()` which gives no information about *which* timer path triggered it. The test does not verify that `stopIdleAndPoll` was called at entry. Consider asserting the timer was cleared and restarted to make the intent explicit. This is a test quality issue, not a test correctness issue, but it means the test provides weaker signal than it should.

**Fix:** Assert IDLE was stopped at entry by checking `noop` was NOT called during the lock hold window before advancing past `idleTimeout`:
```typescript
// IDLE should be paused during lock hold — no NOOP before unlock
(mockFlow.noop as ReturnType<typeof vi.fn>).mockClear();
// (do not advance timers here — just verify noop not called synchronously)
await client.withMailboxSwitch('Review', async () => { /* ... */ });
// Now verify IDLE resumed
await vi.advanceTimersByTimeAsync(300_000);
expect(mockFlow.noop).toHaveBeenCalled();
```

## Info

### IN-01: `detectIdleSupport` is an unnecessary one-liner wrapper

**File:** `src/imap/client.ts:411`
**Issue:** The `detectIdleSupport` method (lines 411–417) is called exactly once in `connect()` and simply sets `this._idleSupported`. The logic is trivial enough to inline at the call site, and the method name implies it does something more sophisticated (e.g., sends a capability probe). The boolean assignment `this._idleSupported = flow.idleSupported !== false` would be clearer and remove a private method that serves no isolation purpose.
**Fix:**
```typescript
// In connect(), replace:
this.detectIdleSupport(this.flow);
// With:
this._idleSupported = this.flow.idleSupported !== false;
```

### IN-02: `states` array in the state-transitions test is declared but never populated

**File:** `test/unit/imap/client.test.ts:163`
**Issue:** The test "transitions disconnected -> connecting -> connected" (line 162) declares `const states: ConnectionState[] = []` but never pushes to it and never asserts on it. The comment says "We track state via events since setState is private" but then doesn't set up any listeners. The array is dead code that implies incomplete test intent.
**Fix:** Either remove the `states` declaration entirely (the test already passes by checking `client.state` after `origConnect()`), or instrument it properly to capture state transitions.

### IN-03: `createMockLogger` in `imap-ops.test.ts` includes `error` and `debug` methods not in the `Logger` interface

**File:** `test/unit/sentinel/imap-ops.test.ts:25`
**Issue:** The `Logger` interface in `imap-ops.ts` (lines 11–14) declares only `info` and `warn`. The mock logger in tests adds `error` and `debug` (line 26). This is harmless at runtime because `as any` is used at the call site, but it means the test mock does not accurately reflect the contract and provides false assurance that `error`/`debug` log calls are handled. If `runSentinelSelfTest` is later updated to call `logger.error(...)`, TypeScript will catch it at the source — but the test will silently absorb it rather than clearly failing.
**Fix:** Trim the mock to match the interface, or widen the `Logger` interface if the extra methods are genuinely needed:
```typescript
function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}
```

---

_Reviewed: 2026-04-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
