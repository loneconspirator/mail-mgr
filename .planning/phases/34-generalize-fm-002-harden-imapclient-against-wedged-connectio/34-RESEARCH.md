# Phase 34: Generalize FM-002 — harden ImapClient against wedged-connection silent failures - Research

**Researched:** 2026-05-01
**Domain:** IMAP client resilience / fault-injection testing / imapflow internals
**Confidence:** HIGH

## Summary

The de-facto requirements for this phase live in the todo at `.planning/todos/pending/2026-05-01-generalize-fm-002-harden-imapclient-against-wedged-connectio.md`. There is no CONTEXT.md and no REQUIREMENTS.md — the todo's six "Solution" items are the requirements (locked, R1–R6 below).

The existing FM-002 fix (commit 79d0315) introduced the right pattern in two places — IDLE keepalive and `listFolders` — but every other public op on `ImapClient` is still unbounded against a half-open socket. The fix here is mechanical: extract the existing `withTimeout` + `flow.usable` + `handleClose` pattern into a private `guardedOp<T>` wrapper, apply it to every public method, bound `flow.connect()`, lower the `idleTimeout` default, and confirm by reading imapflow's source that we can rely on it to drain in-flight promises when the wedge is detected.

**The big unknown turned out to have a clean answer in imapflow's source.** `imapflow.close()` (the public method on the underlying client, NOT our `ImapClient.handleClose`) explicitly rejects every entry in `requestTagMap` and every pending `lock` with a `NoConnection` error (`node_modules/imapflow/lib/imap-flow.js:1673–1759`). So in-flight `getMailboxLock`, `fetch`, `messageMove`, `noop` etc. WILL reject — **but only if we actually call `imapflow.close()`**. Our current `cleanupFlow()` removes listeners and nulls the reference; it does NOT call `imapflow.close()`. That's the silent-leak: in-flight promises stay pending forever inside the orphaned imapflow instance. The implementation MUST call `flow.close()` (or `flow.logout()` then close) inside `cleanupFlow` so the in-flight cancellation logic runs.

**Primary recommendation:** Implement `guardedOp<T>(label, op, timeoutMs)` as the single chokepoint for every public method, fix `cleanupFlow` to call `imapflow.close()` so in-flight promises actually reject, bound `flow.connect()`, lower `idleTimeout` to 90s, and mirror the existing FM-002 test pattern across every public op × two failure shapes.

<phase_requirements>
## Phase Requirements

These are derived from the todo's six "Solution" items. They are the de-facto requirements for this phase since no REQUIREMENTS.md exists yet — the planner should use these IDs (R1–R6) when generating the plan and validation matrix.

| ID | Description | Research Support |
|----|-------------|------------------|
| R1 | Generalize FM-002 spec: widen "Required behavior" to bind the entire ImapClient public surface, retitle around "wedged-connection silent failure" rather than "folder load" | See "Spec changes" section; existing FM-002 already lists `MOD-0002` and `IX-001` — both stay valid; the title and required-behavior bullets must be widened |
| R2 | Add `private guardedOp<T>(label, op, timeoutMs)` wrapping every public op with (a) `flow` exists check, (b) `flow.usable` check, (c) `withTimeout`, (d) on timeout/wedge-shaped error call `handleClose` then rethrow | See "Standard Stack > guardedOp shape"; this is a refactor of the existing inline pattern in `listFolders` + `cycleIdle` |
| R3 | Bound `flow.connect()` (currently `src/imap/client.ts:134`) with a `CONNECT_TIMEOUT_MS`. On timeout transition to `error` and schedule reconnect | See "Pitfall: imapflow connect can hang"; same pattern, applied to the connect path inside `connect()` |
| R4 | Verify in-flight rejection on `handleClose` — write a fault-injection test that starts an op (e.g. `fetchAllMessages` with a never-resolving fetch), triggers `handleClose` mid-flight, and asserts the in-flight promise rejects within the timeout window. If it doesn't, plumb explicit cancellation | See "Don't Hand-Roll > In-flight cancellation" — imapflow ALREADY rejects in-flight ops on `close()`, but only if we call `flow.close()`. Our current `cleanupFlow()` does not. The fix is to call `flow.close()` inside `cleanupFlow` |
| R5 | Tune `idleTimeout` default in `src/config/schema.ts` from 300_000ms to 60–90_000ms | See "State of the Art > idleTimeout default"; recommend 90_000ms (90s) — balance between wedge-detection latency and server-side IDLE timeout (most servers tolerate up to 29 minutes) |
| R6 | Extend `test/unit/imap/client.test.ts` `FM-002 wedged connection detection` describe block to cover every public op × two failure shapes (`usable=false` and never-resolving promise) | See "Validation Architecture" section; existing 4 tests become a parameterized matrix of N×2 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.8 | IMAP protocol client (already in use) | Already the project's IMAP client; no replacement needed [VERIFIED: node_modules/imapflow/package.json] |
| vitest | 4.0.18 | Test runner with fake-timer support | Already the project's runner; FM-002 tests use `vi.useFakeTimers()` to drive the wedge tests deterministically [VERIFIED: package.json + vitest.config.ts] |

### Supporting (no new dependencies)
This phase adds **no new dependencies**. The entire fix is internal to `src/imap/client.ts`, `src/config/schema.ts`, and `test/unit/imap/client.test.ts`, plus the FM-002 spec doc. No imports change.

### `guardedOp` shape (the central pattern)

Refactor the existing inline FM-002 pattern (already in `listFolders` and `cycleIdle`) into a single private wrapper. Mirror the existing `withTimeout` helper at `src/imap/client.ts:78` — keep the helper as-is and call it from inside the new wrapper.

```typescript
// Sketch — exact shape is the planner's call. The structure to mirror is the
// existing listFolders implementation at src/imap/client.ts:426-438.
private async guardedOp<T>(
  label: string,
  op: (flow: ImapFlowLike) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!this.flow) throw new Error('Not connected');
  if (!this.flow.usable) {
    // Match the existing cycleIdle pattern: usable=false is the trip-wire.
    this.handleClose();
    throw new Error(`IMAP ${label}: connection not usable`);
  }
  try {
    return await withTimeout(op(this.flow), timeoutMs, `IMAP ${label}`);
  } catch (err) {
    // Timeout or any wedge-shaped error force-closes so reconnect runs.
    // The existing handleClose() already idempotently no-ops if already
    // disconnected, so calling it on every error is safe.
    if (err instanceof Error && /timed out/i.test(err.message)) {
      this.handleClose();
    }
    throw err;
  }
}
```

**Important nuances the planner must preserve:**

1. **Lock-related ops are special.** `withMailboxLock` and `withMailboxSwitch` already exist as helpers. The wrapper must apply at TWO layers: (a) the `getMailboxLock(path)` call itself can hang (the `processLocks` path can stall on `mailboxOpen` which calls a SELECT command — see `node_modules/imapflow/lib/imap-flow.js:3399–3455`), and (b) the inner `fn(flow)` inside the lock can hang. The planner should decide whether to guard the lock-acquisition with one timeout and the inner work with another, or use a single end-to-end timeout. Recommendation: **two separate timeouts** — `LOCK_TIMEOUT_MS` (15s) for acquisition, and a per-op timeout for the inner work. This keeps error messages actionable ("IMAP getMailboxLock(INBOX)" vs "IMAP fetch on INBOX").

2. **`handleClose` is idempotent (line 591–598 of client.ts).** It guards on `_state === 'disconnected'` and returns early. So calling it from multiple sites in the same wedge cycle is safe. Tests rely on this.

3. **Error-rethrow is mandatory.** Callers depend on the throw to break out — `FolderCache.refresh` (line 32 of cache.ts) catches, falls back to stale tree. `executeMove` (actions/index.ts:73) catches, retries with createMailbox. Don't swallow.

### Per-op timeout budget (proposed — planner finalizes)

| Public method | Suggested timeout | Rationale |
|---------------|-------------------|-----------|
| `connect()` (`flow.connect()` itself) | 30_000 ms | TLS handshake + LOGIN; production handshakes complete < 5s |
| `withMailboxLock` (lock acquisition only) | 15_000 ms | Should be near-instant if SELECT cached; 15s matches existing LIST_TIMEOUT_MS |
| `withMailboxSwitch` (lock + later mailboxOpen) | 15_000 ms each | Same |
| `fetchNewMessages` | 60_000 ms | Fetches since lastUid; bounded by mail volume since last cycle |
| `fetchAllMessages` | 120_000 ms | Whole-folder fetch — Review/action folders can be large; this is the loosest bound |
| `moveMessage` | 30_000 ms | Single MOVE; fast on healthy server |
| `appendMessage` | 30_000 ms | APPEND of small sentinel/notification message |
| `searchByHeader` | 30_000 ms | SEARCH HEADER — fast on small folders |
| `deleteMessage` | 15_000 ms | Single STORE+EXPUNGE |
| `listMailboxes` | 15_000 ms | LIST — same shape as listTree |
| `listFolders` | 15_000 ms | Already set as LIST_TIMEOUT_MS |
| `status` | 15_000 ms | STATUS — fast |
| `createMailbox` | 15_000 ms | CREATE — fast |
| `renameFolder` | 15_000 ms | RENAME — fast |
| `getSpecialUseFolder` | 15_000 ms | Wraps LIST |
| `noop` (in cycleIdle) | 30_000 ms | Already set as NOOP_TIMEOUT_MS — keep |

These are **starting points**, not gospel. The planner should cluster them to keep the per-op constants count manageable (e.g. one `LIST_TIMEOUT_MS=15s`, one `WRITE_TIMEOUT_MS=30s`, one `BULK_FETCH_TIMEOUT_MS=120s`).

## Architecture Patterns

### Recommended approach: refactor in place

```
src/imap/
└── client.ts        # add guardedOp + apply it; bound flow.connect(); fix cleanupFlow
src/config/
└── schema.ts        # change idleTimeout default 300_000 -> 90_000
specs/failure-modes/
└── fm-002-...md     # widen "Required behavior", retitle
test/unit/imap/
└── client.test.ts   # extend FM-002 describe block
```

### Pattern 1: The existing FM-002 chokepoint pattern (mirror this)

**What:** Three checks before the imapflow call returns to the caller:
1. `flow` exists
2. `flow.usable === true`
3. `withTimeout(op, ms, label)` bounds the call

**When to use:** Every public method on `ImapClient` that crosses the imapflow boundary.

**Example (already in the codebase — DO NOT rewrite, extract):**
```typescript
// Source: src/imap/client.ts:426-438 (the existing listFolders impl)
async listFolders(): Promise<FolderNode[]> {
  if (!this.flow) throw new Error('Not connected');
  if (!this.flow.usable) throw new Error('IMAP connection not usable');
  const tree = await withTimeout(
    this.flow.listTree(),
    LIST_TIMEOUT_MS,
    'IMAP LIST',
  ) as { folders?: unknown[] };
  return this.transformTree(tree.folders ?? []);
}
```

After refactor, the same body becomes:
```typescript
async listFolders(): Promise<FolderNode[]> {
  const tree = await this.guardedOp(
    'LIST',
    (flow) => flow.listTree(),
    LIST_TIMEOUT_MS,
  ) as { folders?: unknown[] };
  return this.transformTree(tree.folders ?? []);
}
```

### Pattern 2: `cleanupFlow` must drain in-flight ops

**What:** Currently `cleanupFlow` (line 626) removes listeners and nulls the reference. After this phase, it MUST also call `flow.close()` so imapflow's internal in-flight rejection logic runs.

**Why:** When `handleClose` fires from a half-open socket detection (our trip-wire, NOT a real `close` event from the socket), the underlying imapflow instance still has live promises in `requestTagMap` and pending `locks`. Without calling `flow.close()`, those promises never reject — even though we've reconnected with a new flow. The OLD callers that were already mid-await stay stuck forever.

**Source evidence:** `node_modules/imapflow/lib/imap-flow.js:1673–1759` shows `close()` explicitly walks `requestTagMap` and `locks`, rejecting each with `NoConnection` via `setImmediate`. This is the cancellation mechanism we need — we just have to call it.

```typescript
// Sketch
private cleanupFlow(): void {
  if (this.flow) {
    try {
      // CRITICAL: this is what rejects in-flight requestTagMap entries
      // and pending locks. Without it, prior callers hang forever.
      this.flow.close();
    } catch {
      // best-effort
    }
    this.flow.removeAllListeners();
    this.flow = null;
  }
  this.specialUseCache.clear();
}
```

The `ImapFlowLike` test mock interface needs a `close()` method added (it currently has only `logout()` — see `src/imap/client.ts:43-63`). Update the mock factory in `test/unit/imap/client.test.ts:14` to provide a `close: vi.fn()` stub.

### Anti-Patterns to Avoid

- **Adding cancellation via AbortController.** imapflow does not accept an AbortSignal in its public API (verified by reading `lib/imap-flow.d.ts` — no `signal:` option on `fetch`, `messageMove`, `getMailboxLock`, etc.). Plumbing AbortController through would mean forking imapflow. Don't. The `flow.close()` path is the documented cancellation seam and it's already wired.
- **Tracking pending promises in our own array.** Tempting, but redundant — imapflow already does this in `requestTagMap` and `locks`. Letting it own that state is the right layering.
- **Setting `flow.usable = false` from outside.** That's an internal flag imapflow sets in its own `close()` method (line 1681). Don't poke it; just call `close()`.
- **Per-call try/catch wrappers in callers.** All 25+ call sites listed in the todo would each get a wrapper. The wrong layer — fix it once in `ImapClient`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-flight cancellation on wedge detection | An AbortController plumbed through every imapflow call | `flow.close()` from imapflow itself, called inside `cleanupFlow()` | imapflow already does exactly this — `requestTagMap.forEach(reject)` + `locks.forEach(reject)` in its `close()` method (lib/imap-flow.js:1700–1759). Layering correctly = call the existing API. [VERIFIED: imapflow source] |
| Timeout primitive | A new `Promise.race` / `setTimeout` helper | The existing `withTimeout` at src/imap/client.ts:78 | Already there, already tested, already used by the FM-002 fix |
| Per-op error classification | A taxonomy of "wedge-shaped" errors | A simple regex check on the timeout label OR rely on imapflow throwing `NoConnection` | The existing test (line 989-1003) just checks `/timed out/i` — keep it that simple |
| State machine for connection lifecycle | XState or a custom state-event matrix | The existing `ConnectionState` enum and `setState` calls | Already enforces the required transitions; adding a library is overkill |

**Key insight:** imapflow already provides cancellation. The bug is that our `cleanupFlow` discards the imapflow instance without invoking its cancellation. **One line** (`this.flow.close()`) inside `cleanupFlow` does the work that an AbortController refactor would otherwise require.

## Common Pitfalls

### Pitfall 1: imapflow's `close` event does NOT fire on a half-open socket

**What goes wrong:** TCP keepalives don't trigger Node's socket `close`/`end` events when the connection is wedged at the application layer (server stopped responding to IMAP commands but didn't FIN the socket; NAT gateway dropped state but didn't RST). imapflow only calls its internal `close()` from `socket.on('close')` and `socket.on('end')` (lib/imap-flow.js:789-790). Neither fires on a wedge.

**Why it happens:** A half-open TCP socket is a Node `net.Socket` that is `.writable && .readable` from Node's POV but no bytes are arriving. From kernel POV, the connection is still ESTABLISHED.

**How to avoid:** Our wedge trip-wire MUST be the one to call `cleanupFlow` (which now calls `flow.close()`). The trigger is `cycleIdle` detecting `usable=false` or NOOP timeout, OR any `guardedOp` hitting its timeout. Don't rely on the `close` event — rely on the trip-wire.

**Warning signs:** A test that asserts a wedge is recovered by simulating only `mockFlow.emit('close')` is testing the wrong path. The real-world wedge does NOT emit `close`; the trip-wire fires first. Existing FM-002 tests already simulate the wedge correctly (flip `usable=false` OR return `new Promise(()=>{})` from `noop`/`listTree`); mirror that for every op. [VERIFIED: test/unit/imap/client.test.ts:929-1003]

### Pitfall 2: imapflow `connect()` can hang forever during TLS handshake or LOGIN

**What goes wrong:** `flow.connect()` at `src/imap/client.ts:134` is unbounded. A wedge that occurs during reconnect leaves the client stuck in `connecting` forever — `_state === 'connecting'`, so subsequent `connect()` calls early-return at line 124, blocking forever.

**Why it happens:** imapflow does have an internal `connectTimeout` (referenced at lib/imap-flow.js:1678 — `clearTimeout(this.connectTimeout)`), but this is for the initial TCP handshake only. Post-handshake stalls during STARTTLS/LOGIN are not bounded by a public option.

**How to avoid:** Wrap `flow.connect()` in `withTimeout`. On timeout, the catch block at line 142–147 already does the right thing — sets `error`, emits, schedules reconnect. The existing test "emits error and schedules reconnect on connection failure" (line 98-113) covers the throw path; just add a "connect hangs past timeout" variant. [VERIFIED: src/imap/client.ts:123-148]

**Warning signs:** Container metrics showing `connecting` state for > 30s, or no `connected` event ever after a `disconnected unexpected`.

### Pitfall 3: lock acquisition itself can be the wedge point

**What goes wrong:** `withMailboxLock` (line 176) currently does `await this.flow.getMailboxLock(folder)` with no timeout. imapflow's `processLocks` (line 3340–3469) calls `mailboxOpen` (which sends a SELECT command) inside the lock-acquisition critical section — if SELECT hangs, the lock never resolves and the awaiting caller is stuck.

**Why it happens:** Lock acquisition is intuitively "client-side" but it touches the network in the SELECT path.

**How to avoid:** Wrap `getMailboxLock` calls with `withTimeout`. This is the difference between guarding only the inner `fn(flow)` (cheap and easy) vs. guarding both the lock and the inner work. **Must do both.**

**Warning signs:** Tests that pass with a never-resolving inner `fn` but hang forever if `getMailboxLock` is the never-resolving thing.

### Pitfall 4: `setInterval`-driven callers stack awaits during a wedge

**What goes wrong:** `ActionFolderPoller` runs `setInterval(tick, 15s)` and `ReviewSweeper` runs at intervalHours; both await IMAP work. If a tick stalls on a wedge for 5 minutes (current `idleTimeout`), the next 19 ticks pile up. When recovery happens, all 20 fire simultaneously, hammering the freshly-reconnected IMAP server.

**Why it happens:** `setInterval` does not skip ticks while the previous async work is in flight.

**How to avoid:** This is OUT OF SCOPE for the wrapper itself but is what the lower `idleTimeout` (R5: 90s) and per-op timeouts mitigate — recovery happens within seconds, not minutes, so the stack-up is at most 6 ticks instead of 20. Mention in the FM-002 spec rationale; do not change pollers in this phase. [Caller surfaces: src/action-folders/poller.ts:35-90, src/sweep/index.ts:235-241]

### Pitfall 5: `imapflow.close()` is synchronous-but-emits-async

**What goes wrong:** `flow.close()` rejections happen via `setImmediate(() => reject(...))` (line 1738, 1752). So callers awaiting an in-flight op don't see the rejection synchronously — the test must allow at least a microtask flush before asserting.

**Why it happens:** Intentional — imapflow comments say "to ensure caller's promise chain is fully set up before rejection (prevents unhandled promise rejections)".

**How to avoid:** In tests, after triggering `handleClose` (or whatever path leads to `flow.close()`), use `await vi.advanceTimersByTimeAsync(0)` or attach a `.catch` synchronously and `await` it later. The existing listFolders timeout test at line 994 does exactly this:
```typescript
const settled = promise.catch((e) => e);
await vi.advanceTimersByTimeAsync(15_000);
const result = await settled;
```
Mirror this for every in-flight rejection assertion. [VERIFIED: imapflow lib/imap-flow.js:1734-1758, test/unit/imap/client.test.ts:980-1003]

## Code Examples

### Example 1: The new `guardedOp` applied to a write op (moveMessage)

Before:
```typescript
// src/imap/client.ts:205-222 (current)
async moveMessage(uid: number, destination: string, sourceFolder: string = 'INBOX'): Promise<void> {
  const work = async (flow: ImapFlowLike): Promise<void> => {
    const result = await flow.messageMove([uid], destination, { uid: true });
    if (!result) {
      throw new Error(`MOVE uid=${uid} to "${destination}" returned no result ...`);
    }
  };
  if (sourceFolder === 'INBOX') {
    await this.withMailboxLock(sourceFolder, work);
  } else {
    await this.withMailboxSwitch(sourceFolder, work);
  }
}
```

After (the lock helpers themselves get guarded internally; the public method shape stays the same):
```typescript
// withMailboxLock now uses guardedOp internally for both the lock acquisition
// AND the inner work. The public moveMessage signature is unchanged.
async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
  const lock = await this.guardedOp(
    `getMailboxLock(${folder})`,
    (flow) => flow.getMailboxLock(folder),
    LOCK_TIMEOUT_MS,
  );
  try {
    return await this.guardedOp(
      `withMailboxLock(${folder}) work`,
      (flow) => fn(flow),
      WORK_TIMEOUT_MS,  // or per-call override via signature change
    );
  } finally {
    lock.release();
  }
}
```

The planner may choose to add an optional `timeoutMs` parameter to `withMailboxLock` so callers can override (e.g. `fetchAllMessages` needs 120s, not 30s). That's a judgment call; flag it in the plan.

### Example 2: Bounding `flow.connect()` (R3)

```typescript
// src/imap/client.ts:131-135 (current)
this.flow = this.factory(this.config);
this.bindFlowEvents(this.flow);
await this.flow.connect();
await this.flow.mailboxOpen('INBOX');

// After:
this.flow = this.factory(this.config);
this.bindFlowEvents(this.flow);
await withTimeout(this.flow.connect(), CONNECT_TIMEOUT_MS, 'IMAP CONNECT');
await withTimeout(this.flow.mailboxOpen('INBOX'), 15_000, 'IMAP SELECT INBOX');
```

The existing `try/catch` at line 131–148 already routes errors to `setState('error') + emit + scheduleReconnect`. Timeout errors flow through the same path; no other change needed. [Source: src/imap/client.ts:123-148]

### Example 3: Test pattern for "in-flight promise rejects when handleClose fires"

This is the R4 verification test — the one the todo flags as "the big unknown". Based on the imapflow source, it WILL pass without any extra cancellation plumbing as long as `cleanupFlow` calls `flow.close()`.

```typescript
it('in-flight fetchAllMessages rejects when handleClose fires mid-flight', async () => {
  // Mock: fetch returns an async iterable that never yields
  const hangFlow = createMockFlow({
    fetch: vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    })) as unknown as ImapFlowLike['fetch'],
    // close() must trigger rejection of in-flight ops, mimicking imapflow behavior.
    // Our mock won't have requestTagMap, so we simulate by tracking pending and rejecting.
    close: vi.fn(),
  });
  // ... or use a richer mock that simulates imapflow's close-rejects-in-flight behavior

  const c = new ImapClient(TEST_CONFIG, vi.fn(() => hangFlow));
  await c.connect();

  const inflight = c.fetchAllMessages('Review').catch((e) => e);

  // Trip the wedge — usable=false should cause cycleIdle to handleClose,
  // which in cleanupFlow now calls flow.close(), which rejects the in-flight fetch.
  (hangFlow as unknown as { usable: boolean }).usable = false;
  await vi.advanceTimersByTimeAsync(300_000); // past idleTimeout — note: after R5 this becomes 90s

  await vi.advanceTimersByTimeAsync(0); // flush setImmediate from imapflow.close()

  const err = await inflight;
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/not available|not connected|timed out/i);
});
```

Note: this test depends on the mock's `close()` actually rejecting tracked-in-flight promises. The simplest robust path is to **also** wrap each public op in `guardedOp` with its own timeout, so even if the mock doesn't simulate the close-cancellation, the timeout fires within seconds and the test passes for the right reason. The two mechanisms are belt-and-suspenders.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `withTimeout` + `usable` check duplicated in 2 sites | Single `guardedOp` private method applied to every public op | This phase | DRY; impossible to forget the trip-wire on a new public method |
| `idleTimeout` default 300_000ms (5 min) | 90_000ms (90s) recommended | This phase (R5) | Wedge-detection latency drops 3.3×; all caller stacks unblock within 90s of wedge onset instead of 5 min |
| `cleanupFlow` only removes listeners | `cleanupFlow` calls `flow.close()` first | This phase | In-flight promises in the abandoned imapflow actually reject; old wedged callers don't accumulate |
| `flow.connect()` unbounded | `withTimeout(flow.connect(), CONNECT_TIMEOUT_MS, ...)` | This phase (R3) | A wedged handshake no longer leaves the client stuck in `connecting` forever |
| FM-002 spec scoped to IDLE + listFolders | FM-002 spec scoped to entire `ImapClient` public surface | This phase (R1) | Spec ↔ code parity; future ops auto-fall under the spec |

**Deprecated/outdated:**
- The text "currently `listFolders`" in MOD-0002 line 46 (specs/modules/mod-0002-imap-client.md) becomes stale — must be updated to "every public op" alongside the FM-002 spec change.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `idleTimeout: 90_000` (90s) is a good default | Standard Stack > idleTimeout | Too low → wasted server-side IDLE renegotiation traffic. Too high → longer wedge-detection latency. Most IMAP servers tolerate IDLE for 29 minutes (RFC 2177); 90s is well within tolerance. The user may want to push it lower (60s) or higher (120s) — flag in PLAN |
| A2 | `CONNECT_TIMEOUT_MS = 30_000` is appropriate | Per-op timeout budget | Too low could cause spurious reconnects on slow networks (mobile, high-latency satellite). 30s is generous for most environments. Production data on connect time would inform — none currently captured |
| A3 | Per-op timeouts (15s / 30s / 60s / 120s buckets) are appropriate | Per-op timeout budget | Each value is a guess based on "should be fast on a healthy server" — tighter values would catch wedges faster but risk false positives on heavy folders. The planner should treat these as defaults and let the user tune via config if desired (currently they're hard-coded constants — that's fine for v1) |
| A4 | The mock `ImapFlowLike` will need a `close()` method added | Don't Hand-Roll > In-flight cancellation | Trivial — just add `close: vi.fn()` to the mock factory. Will fail loudly on test compile if missed |

**Verification deltas:** A1, A2, A3 are JUDGMENT calls and should be confirmed with the user before implementation. A4 is mechanical.

## Open Questions

1. **Should `idleTimeout` move from `imapConfig` to a dedicated `wedgeDetection` config block?**
   - What we know: It's currently in `imapConfigSchema` (`src/config/schema.ts:80`)
   - What's unclear: Whether the user wants per-op timeouts also user-configurable, or hard-coded constants
   - Recommendation: Keep `idleTimeout` in `imapConfig`, hard-code per-op timeouts as constants for v1, defer config-ification to a future phase

2. **Should `withMailboxLock` accept an optional per-call timeout override?**
   - What we know: `fetchAllMessages` needs a longer timeout (120s) than `moveMessage` (30s) for the inner work
   - What's unclear: Whether to encode that as an optional 3rd parameter, or hard-code per-call inside each public method
   - Recommendation: 3rd parameter with sensible default — keeps the wrapper general

3. **Does `disconnect()` need a timeout on `flow.logout()`?**
   - What we know: Line 161 awaits `flow.logout()` unbounded; the surrounding catch swallows. So a hung logout silently delays `disconnect()` forever
   - What's unclear: Is this in scope for "wedged silent failure"? Logout-during-shutdown is a different lifecycle path
   - Recommendation: Yes — bound it. 5 second timeout, swallow on timeout (already swallowed). Cheap and consistent

4. **Should `handleClose` be called from `bindFlowEvents`'s `error` handler?**
   - What we know: Line 570 `flow.on('error', ...)` sets state to `error` and emits, but does NOT trigger reconnect — the only reconnect trigger is `flow.on('close')` and our own `handleClose` from `cycleIdle`
   - What's unclear: Whether socket-level errors should also force the reconnect path
   - Recommendation: Out of scope for this phase — current behavior is intentional (errors emit; close triggers reconnect). Capture as a follow-up todo

## Environment Availability

This phase is purely code/config changes inside an existing TypeScript project. No external tools or services are needed beyond what already runs the test suite.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | runtime + tests | ✓ | (project standard) | — |
| vitest | unit tests | ✓ | 4.0.18 [VERIFIED: package.json] | — |
| imapflow | already imported | ✓ | 1.2.8 [VERIFIED: node_modules/imapflow/package.json] | — |
| GreenMail (Docker) | NOT needed for this phase — unit tests use mocks only | n/a | n/a | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

> nyquist_validation is enabled (config.json: `workflow.nyquist_validation: true`). All requirements R1–R6 must map to automated tests.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (project: `unit`) |
| Quick run command | `npx vitest run test/unit/imap/client.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R1 | FM-002 spec retitled and "Required behavior" widened to bind every public op | docs validator (skill) | `npx tsx .claude/skills/validate-failure-mode/scripts/validate-failure-mode.ts FM-002` | ✅ skill exists |
| R2 | `guardedOp` applied to every public op — every public method × `usable=false` rejects fast | unit | `npx vitest run test/unit/imap/client.test.ts -t "FM-002"` | ✅ existing file extended |
| R2 | Every public op × never-resolving inner promise rejects within its timeout | unit | same | ✅ existing file extended |
| R3 | `connect()` rejects when `flow.connect()` hangs past CONNECT_TIMEOUT_MS, schedules reconnect | unit | same | ✅ existing file extended |
| R4 | `cleanupFlow` calls `flow.close()`; in-flight ops reject when `handleClose` fires mid-flight | unit | same | ✅ existing file extended |
| R4 | (alt path) per-op timeout fires on never-resolving inner — covered by R2's matrix | unit | same | already in R2 row |
| R5 | `idleTimeout` default is 90_000 in `imapConfigSchema` parsed from empty config | unit | `npx vitest run test/unit/config/` (or wherever schema parsing is tested) | ✅ infer location from grep |
| R6 | Test matrix exists with per-op coverage — meta-assertion that the describe block has N×2 tests for N public ops | manual code review | n/a (structural — review the diff) | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/imap/client.test.ts` — < 5 seconds for the file
- **Per wave merge:** `npm test` — full suite
- **Phase gate:** Full suite green + `validate-failure-mode FM-002` PASS verdict before `/gsd-verify-work`

### Test Matrix Shape (R6)

For each public op listed below, two tests in the FM-002 describe block:

| Public op | Test A: `usable=false` | Test B: never-resolving inner |
|-----------|------------------------|-------------------------------|
| `connect` (the `flow.connect()` call) | n/a — `usable` is set after connect | ✅ "rejects + reconnects when flow.connect hangs" |
| `cycleIdle` / `noop` | ✅ existing | ✅ existing |
| `listFolders` | ✅ existing | ✅ existing |
| `listMailboxes` | new | new |
| `status` | new | new |
| `createMailbox` | new (note: goes through withMailboxLock — usable check fires there) | new |
| `renameFolder` | new | new |
| `appendMessage` | new | new |
| `searchByHeader` | new (via withMailboxSwitch) | new |
| `deleteMessage` | new (via withMailboxSwitch) | new |
| `moveMessage` (INBOX source) | new (via withMailboxLock) | new |
| `moveMessage` (non-INBOX source) | new (via withMailboxSwitch) | new |
| `fetchNewMessages` | new (via withMailboxLock) | new |
| `fetchAllMessages` (INBOX) | new | new |
| `fetchAllMessages` (non-INBOX) | new | new |
| `getSpecialUseFolder` | new | new |
| `withMailboxLock` (lock acquisition itself) | new — getMailboxLock rejects | new — getMailboxLock hangs |
| `withMailboxSwitch` (lock acquisition itself) | new | new |

That's roughly 30+ new test cases. The planner should consider parameterizing via `it.each` to keep the file size reasonable. Existing FM-002 tests at line 928–1008 are the template.

### Wave 0 Gaps
- [ ] `test/unit/imap/client.test.ts` — file exists; the FM-002 describe block needs the matrix expansion
- [ ] `ImapFlowLike` type at `src/imap/client.ts:43-63` — needs a `close()` method added so the new `cleanupFlow` compiles
- [ ] Test mock factory at `test/unit/imap/client.test.ts:14` — needs `close: vi.fn()` added to satisfy the new interface
- [ ] No new fixtures needed — fake-timers and mock flow already do the work
- [ ] No framework install needed

### Spec changes (R1)

The `validate-failure-mode FM-002` skill must still PASS after the spec edits. The deterministic checks (FM↔IX, FM↔INV, fault-injection-test back-link) all stay valid because:
- `integrations: [IX-001]` stays — IX-001's failure-handling section already cites FM-002
- `invariants-protected: []` stays empty (FM-002 doesn't enforce an invariant — it's a wedge-detection trip-wire)
- `fault-injection-test: test/unit/imap/client.test.ts` stays — the file still contains the FM-002 ID
- `modules: [MOD-0002]` stays

The semantic checks (does the body name components that exist in the architecture? does the test exercise the trigger?) need re-evaluation after the body widens. Update MOD-0002 spec body line 46 in lockstep with FM-002 to keep them in sync.

## Sources

### Primary (HIGH confidence)
- `node_modules/imapflow/lib/imap-flow.js:1673-1855` (`close()` method body) — proves in-flight rejection on close
- `node_modules/imapflow/lib/imap-flow.js:789-790` (socket close/end → close()) — proves wedge does NOT trigger close event
- `node_modules/imapflow/lib/imap-flow.js:3340-3469` (`processLocks()`) — proves lock acquisition can hang on SELECT
- `node_modules/imapflow/lib/imap-flow.js:540-554` (request enqueueing) — proves requestTagMap is the rejection target
- `src/imap/client.ts:78-94` (existing `withTimeout` helper) — the existing pattern to extend
- `src/imap/client.ts:426-438` (existing `listFolders` FM-002 implementation) — the existing chokepoint to extract
- `src/imap/client.ts:587-598` (existing `handleClose`) — proves idempotency
- `src/imap/client.ts:626-632` (existing `cleanupFlow`) — proves the gap (no `flow.close()` call)
- `test/unit/imap/client.test.ts:928-1008` (existing FM-002 describe block) — the test template to mirror
- `specs/failure-modes/fm-002-...md` — spec to widen
- `.claude/skills/validate-failure-mode/SKILL.md` — validator that must still PASS after spec edit
- `.planning/todos/pending/2026-05-01-...md` — de-facto requirements (R1–R6)
- Commit 79d0315 — the FM-002 fix that established the pattern

### Secondary (MEDIUM confidence)
- RFC 2177 (IMAP IDLE) — informs A1 (90s idleTimeout default) [CITED: training knowledge — most servers tolerate 29 min IDLE per spec]

### Tertiary (LOW confidence)
- None — every claim above is verified against the codebase, the imapflow source in node_modules, or the existing tests

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps, the entire fix is internal refactor of code already in the file
- Architecture: HIGH — the existing FM-002 implementation is the architectural template; the wrapper extracts an obvious chokepoint
- imapflow internals (the "big unknown" R4 question): HIGH — read the source directly; `close()` rejects in-flight ops and pending locks via setImmediate
- Pitfalls: HIGH — pitfalls 1–4 verified against imapflow source and existing client.ts; pitfall 5 verified against existing test pattern
- Per-op timeout values (A1–A3): MEDIUM — judgment calls without production timing data, flagged for user confirmation

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (imapflow is stable; the only invalidator would be a major imapflow version bump that changed close-rejects-in-flight semantics)
