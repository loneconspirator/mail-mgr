---
phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio
reviewed: 2026-05-01T23:30:35Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/imap/client.ts
  - src/config/schema.ts
  - specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md
  - specs/modules/mod-0002-imap-client.md
  - test/unit/imap/client.test.ts
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 34: Code Review Report

**Reviewed:** 2026-05-01T23:30:35Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The Phase 34 generalization of FM-002 is structurally solid: every public ImapClient op is now routed through `guardedOp`, the lock helpers guard both acquisition and inner work with appropriate timeouts, `cleanupFlow` calls `flow.close()` so imapflow drains its in-flight `requestTagMap`, and `flow.connect()` / `mailboxOpen('INBOX')` are bounded by `CONNECT_TIMEOUT_MS`. The `it.each` matrix exercises 32 wedge cases (15 ops × 2 conditions + 2 lock-acquisition cases) plus the R4 in-flight rejection test, which is good fault-injection coverage at the unit level.

That said, I found **four warnings** worth fixing before treating this phase as done — three are spec-vs-implementation drift (write-class ops accidentally bound at LIST timeouts) and one is the INBOX-restore path bypassing `guardedOp`, which lets a wedged restore burn 15s without triggering reconnect. None are correctness-fatal — the wedge still surfaces as a thrown error within seconds — but they undermine the "every public op routes through the chokepoint" contract that the spec promises.

The closure-capture in `guardedOp`, the lock-release-throw handling, and the `usable=false → handleClose → cleanupFlow → close()` chain are correct. The R4 test is a particularly nice end-to-end verification of the in-flight drain.

## Warnings

### WR-01: createMailbox / renameFolder use LIST_TIMEOUT_MS (15s) but are WRITE-class ops

**File:** `src/imap/client.ts:353, src/imap/client.ts:359`
**Issue:**
The MOD-0002 spec body explicitly classifies `createMailbox` and `renameFolder` under "every write op (`moveMessage`, `appendMessage`, **`createMailbox`, `renameFolder`**, `deleteMessage`)" and assigns `WRITE_TIMEOUT_MS` (30s) to that bucket. The implementation passes `LIST_TIMEOUT_MS` (15s):

```ts
async createMailbox(path: string | string[]): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxCreate(path);
  }, LIST_TIMEOUT_MS);   // <-- should be WRITE_TIMEOUT_MS
}

async renameFolder(oldPath: string, newPath: string): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxRename(oldPath, newPath);
  }, LIST_TIMEOUT_MS);   // <-- should be WRITE_TIMEOUT_MS
}
```

CREATE and RENAME are server-side mutations that may stall on a busy server (filesystem-level mailbox creation, hierarchy rebuild on rename). The 15s bound is tighter than the spec warrants and tighter than other write ops use.

The matrix tests at `test/unit/imap/client.test.ts:1149-1160` pin the wrong values (`timeoutMs: 15_000`), so they would not catch this drift if the impl were "fixed" — they would have to be updated in lockstep.

**Fix:**
```ts
async createMailbox(path: string | string[]): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxCreate(path);
  }, WRITE_TIMEOUT_MS);
}

async renameFolder(oldPath: string, newPath: string): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxRename(oldPath, newPath);
  }, WRITE_TIMEOUT_MS);
}
```

And bump the matching `OP_CASES` entries in `client.test.ts` to `timeoutMs: 30_000`.

### WR-02: deleteMessage uses LIST_TIMEOUT_MS (15s) but is a WRITE-class op

**File:** `src/imap/client.ts:387`
**Issue:**
Same drift as WR-01. MOD-0002 spec lists `deleteMessage` under write ops; impl passes `LIST_TIMEOUT_MS` to `withMailboxSwitch`:

```ts
async deleteMessage(folder: string, uid: number): Promise<boolean> {
  return this.withMailboxSwitch(folder, async (flow) => {
    return flow.messageDelete([uid], { uid: true });
  }, LIST_TIMEOUT_MS);   // <-- should be WRITE_TIMEOUT_MS
}
```

Test at `client.test.ts:1180` pins `timeoutMs: 15_000` and would need to be updated in lockstep.

**Fix:**
```ts
async deleteMessage(folder: string, uid: number): Promise<boolean> {
  return this.withMailboxSwitch(folder, async (flow) => {
    return flow.messageDelete([uid], { uid: true });
  }, WRITE_TIMEOUT_MS);
}
```

### WR-03: INBOX-restore in withMailboxSwitch finally block bypasses guardedOp

**File:** `src/imap/client.ts:286-298`
**Issue:**
The "restore INBOX" call in `withMailboxSwitch`'s finally uses raw `withTimeout(this.flow.mailboxOpen('INBOX'), ...)` instead of `guardedOp`:

```ts
try {
  // best-effort INBOX restore — bound it so a wedge during restore
  // doesn't hang the calling op past return
  if (this.flow) {
    await withTimeout(
      this.flow.mailboxOpen('INBOX'),
      LOCK_TIMEOUT_MS,
      'IMAP SELECT INBOX (restore)',
    );
  }
} catch {
  // best-effort reopen — already swallowed pre-FM-002
}
```

This bypasses two `guardedOp` behaviors:

1. The `flow.usable === false` precheck (which would short-circuit and force-close immediately rather than burning the full 15s timeout against a known-wedged socket).
2. The `handleClose()` invocation on timeout — a hung INBOX restore here will time out, get swallowed, but will NOT trigger reconnect. The next caller will re-issue against the same wedged socket.

Per FM-002's contract: "the next command issued against a wedged socket fails fast (within the per-op timeout window)" — and per MOD-0002 spec: "Every public IMAP operation routes through a single private `guardedOp` chokepoint." The INBOX restore is not a public op, but it IS issued against the same shared socket, so a wedge here that goes undetected leaks.

The error-swallowing is intentional and correct (we don't want a failed INBOX restore to mask the real error from the inner work). But the trip-wire side effect should still fire.

**Fix:**
Route through `guardedOp` and swallow at the call site, not inside `withTimeout`:

```ts
} finally {
  try {
    lock.release();
  } catch { /* best-effort */ }
  try {
    // best-effort INBOX restore — bounded by LOCK_TIMEOUT_MS, and on
    // wedge-shaped failure handleClose runs so reconnect is scheduled.
    await this.guardedOp(
      'SELECT INBOX (restore)',
      (flow) => flow.mailboxOpen('INBOX').then(() => undefined),
      LOCK_TIMEOUT_MS,
    );
  } catch {
    // best-effort reopen — already swallowed pre-FM-002
  }
  this.startIdleOrPoll();
}
```

The `if (this.flow)` guard becomes unnecessary because `guardedOp` already throws "Not connected" on null flow, and that throw is caught by the outer try/catch. Bonus consistency: the trip-wire and error-mapping behavior matches every other op.

### WR-04: fetchNewMessages uses WRITE_TIMEOUT_MS (30s) for an unbounded `1:*` range on first sync

**File:** `src/imap/client.ts:455`
**Issue:**
`fetchNewMessages(sinceUid)` issues `flow.fetch(range, ...)` where `range` is `${sinceUid+1}:*` for `sinceUid > 0` and `1:*` for `sinceUid === 0`. The first-sync case (`sinceUid === 0`) fetches the entire INBOX envelope set, which is exactly the workload `BULK_FETCH_TIMEOUT_MS` (120s) was designed for.

Caller is `withMailboxLock('INBOX', work, WRITE_TIMEOUT_MS)` — so on a fresh container start with a 50k-message INBOX, this can time out at 30s and trigger an unnecessary reconnect. `fetchAllMessages` for the same data is bounded at 120s; routing the same fetch through a different entry point gets a 4× tighter cap.

This is not a regression from this phase (the call site already used the inner-work timeout), but the new explicit `WRITE_TIMEOUT_MS` parameter makes the inconsistency much more visible: identical work, different bounds.

**Fix:**
Either:
1. Use `BULK_FETCH_TIMEOUT_MS` for fetchNewMessages, since on first connect it IS a bulk fetch:

```ts
async fetchNewMessages(sinceUid: number): Promise<unknown[]> {
  return this.withMailboxLock('INBOX', async (flow) => {
    // ... existing body ...
  }, BULK_FETCH_TIMEOUT_MS);
}
```

2. Or branch: 30s when `sinceUid > 0` (incremental), 120s when `sinceUid === 0` (full sync). This is more nuanced but matches the actual load shape.

Option 1 is simpler and aligns with `fetchAllMessages`'s bound. Recommend that.

## Info

### IN-01: guardedOp timeout detection uses fragile string-matching

**File:** `src/imap/client.ts:252`
**Issue:**
`guardedOp` decides whether to call `handleClose()` based on a regex against the error message:

```ts
if (err instanceof Error && /timed out/i.test(err.message)) {
  this.handleClose();
}
```

This works because `withTimeout` produces `${label} timed out after ${ms}ms`. But if a server ever surfaces an error containing "timed out" (e.g., `[CLIENTBUG] command timed out on server`, or imapflow itself throwing a timeout-shaped error from a deeper layer), `handleClose` would fire on something that's not actually a wedge.

More robust would be a sentinel class:

```ts
class TimeoutError extends Error {
  constructor(label: string, ms: number) { super(`${label} timed out after ${ms}ms`); }
}
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    // ...
  });
}
// in guardedOp:
if (err instanceof TimeoutError) this.handleClose();
```

The matrix tests still match `/timed out/i` against the error message, so they would continue to pass. Low priority — string matching has worked fine so far — but worth it the next time withTimeout is touched.

### IN-02: spec wording "every public op routes through guardedOp" is overstated

**File:** `specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md:27`, `specs/modules/mod-0002-imap-client.md:46`
**Issue:**
Both specs say the chokepoint covers `connect` (the underlying `flow.connect()` and the initial `mailboxOpen('INBOX')`). In the implementation those are bounded by raw `withTimeout`, not `guardedOp` — necessarily, because the `flow.usable` precheck inside `guardedOp` would race during connect (the freshly-created flow may not yet have `usable=true`).

The spec is correct that the calls are bounded by a per-op timeout (`CONNECT_TIMEOUT_MS`), but it conflates "bounded with a timeout" with "routes through guardedOp". A reader chasing the FM trail will land on `connect()` and see no `guardedOp` call.

**Fix:**
Reword to: "Every public IMAP operation EXCEPT `connect` itself routes through `guardedOp`. The `connect` path uses raw `withTimeout` to bound `flow.connect()` and the initial `mailboxOpen('INBOX')`, since `guardedOp`'s `flow.usable` precheck is undefined during the handshake; the timeout error still flows through the existing catch → setState('error') → scheduleReconnect path."

Same edit in MOD-0002 spec body.

### IN-03: searchByHeader timeout bucket is debatable per spec

**File:** `src/imap/client.ts:381`
**Issue:**
MOD-0002 spec lists `searchByHeader` under read ops and assigns the read-op bucket `LIST_TIMEOUT_MS` (15s). Implementation passes `WRITE_TIMEOUT_MS` (30s). The constant comment at `src/imap/client.ts:84` even says `WRITE_TIMEOUT_MS` is for "moveMessage / appendMessage / search" — so the constant comment is consistent with the impl, but inconsistent with the MOD-0002 spec's classification.

Either is defensible (server-side SEARCH against a large folder genuinely can exceed 15s), but pick one and align spec + impl + the constant's comment. The matrix test at `client.test.ts:1174` pins `timeoutMs: 30_000`, so the impl wins by default.

**Fix:**
Update MOD-0002 spec to clarify that `searchByHeader` uses `WRITE_TIMEOUT_MS` (30s) because it's a server-side scan, not a metadata read like LIST/STATUS.

### IN-04: TEST_CONFIG idleTimeout intentionally diverges from new schema default; consider adding a fixture for the new default

**File:** `test/unit/imap/client.test.ts:14`
**Issue:**
`TEST_CONFIG` keeps `idleTimeout: 300_000` to match the existing FM-002 timer math. The schema default just dropped to `90_000`. The comment explains why, which is good.

But there's no test that exercises the 90s path — every IDLE-related test in this file uses 300s. If a future change accidentally inverts the relationship between `idleTimeout` and `cycleIdle` scheduling (e.g., schedules at `2 * idleTimeout`), a test against 90s wouldn't catch it because no test runs at 90s.

This is low priority — the existing tests do exercise the cycling math symbolically — but a single test using `{ ...TEST_CONFIG, idleTimeout: 90_000 }` and advancing `90_000ms` would pin the new default's behavior end-to-end and document that the schema default is what production uses.

**Fix:**
Optionally add one test in `IDLE cycling`:

```ts
it('cycles IDLE at the new schema default of 90s', async () => {
  const conf: ImapConfig = { ...TEST_CONFIG, idleTimeout: 90_000 };
  const f = createMockFlow();
  const c = new ImapClient(conf, vi.fn(() => f));
  await c.connect();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(f.noop).toHaveBeenCalledTimes(1);
  await c.disconnect();
});
```

---

_Reviewed: 2026-05-01T23:30:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
