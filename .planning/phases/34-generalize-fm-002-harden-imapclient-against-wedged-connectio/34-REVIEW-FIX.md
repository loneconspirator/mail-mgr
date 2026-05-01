---
phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio
fixed_at: 2026-05-01T23:41:49Z
review_path: .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 34: Code Review Fix Report

**Fixed at:** 2026-05-01T23:41:49Z
**Source review:** .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8
- Fixed: 8
- Skipped: 0

## Fixed Issues

### WR-01: createMailbox / renameFolder use LIST_TIMEOUT_MS (15s) but are WRITE-class ops

**Files modified:** `src/imap/client.ts`, `test/unit/imap/client.test.ts`
**Commit:** 7b3cb4a
**Applied fix:** Changed both `createMailbox` and `renameFolder` to pass `WRITE_TIMEOUT_MS` (30s) to `withMailboxLock`, matching the MOD-0002 spec's WRITE-class classification. Updated the matching `OP_CASES` matrix entries from `timeoutMs: 15_000` to `timeoutMs: 30_000` to keep the test fixture in lockstep with the implementation.

### WR-02: deleteMessage uses LIST_TIMEOUT_MS (15s) but is a WRITE-class op

**Files modified:** `src/imap/client.ts`, `test/unit/imap/client.test.ts`
**Commit:** 3935e21
**Applied fix:** Changed `deleteMessage` to pass `WRITE_TIMEOUT_MS` (30s) to `withMailboxSwitch`. Updated the matching `OP_CASES` matrix entry to `timeoutMs: 30_000`.

### WR-03: INBOX-restore in withMailboxSwitch finally block bypasses guardedOp

**Files modified:** `src/imap/client.ts`
**Commit:** d25c010
**Applied fix:** Replaced the raw `withTimeout(this.flow.mailboxOpen('INBOX'), LOCK_TIMEOUT_MS, ...)` call with a `guardedOp` invocation so the `flow.usable` precheck and `handleClose`-on-timeout side effects fire on a wedged restore. The `if (this.flow)` guard was dropped because `guardedOp` already throws "Not connected" on a null flow, and the outer try/catch swallows it. All 100 existing matrix tests still pass; running the suite alone confirmed no regressions in `withMailboxSwitch` ordering tests.

### WR-04: fetchNewMessages uses WRITE_TIMEOUT_MS (30s) for an unbounded `1:*` range on first sync

**Files modified:** `src/imap/client.ts`, `test/unit/imap/client.test.ts`
**Commit:** 32f53a2
**Applied fix:** Applied option 1 from the review: changed `fetchNewMessages` to pass `BULK_FETCH_TIMEOUT_MS` (120s) to `withMailboxLock`, aligning with `fetchAllMessages`. Updated the matching `OP_CASES` matrix entry to `timeoutMs: 120_000`.

### IN-01: guardedOp timeout detection uses fragile string-matching

**Files modified:** `src/imap/client.ts`
**Commit:** e99ebe6
**Applied fix:** Introduced a `TimeoutError` sentinel class (exported, with `name: 'TimeoutError'` for introspection) that `withTimeout` now throws instead of a plain `Error`. `guardedOp` keys its `handleClose` trip-wire on `err instanceof TimeoutError` rather than `/timed out/i.test(err.message)`. The error message format is preserved verbatim (`${label} timed out after ${ms}ms`) so existing `/timed out/i` matrix-test assertions and external log greps continue to work.

### IN-02: spec wording "every public op routes through guardedOp" is overstated

**Files modified:** `specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md`, `specs/modules/mod-0002-imap-client.md`
**Commit:** d35faa2
**Applied fix:** Reworded both specs to say "every public op EXCEPT `connect` itself" routes through `guardedOp`, and added an explicit paragraph (FM-002) / clause (MOD-0002) explaining that `connect` uses raw `withTimeout` because the `flow.usable` precheck is undefined during the handshake; the timeout error still flows through the existing `connect()` catch → `setState('error')` → `scheduleReconnect()` path. Also folded in IN-03 clarification (searchByHeader uses WRITE_TIMEOUT_MS) and IN-01 wording (TimeoutError sentinel) into the MOD-0002 paragraph.

### IN-03: searchByHeader timeout bucket is debatable per spec

**Files modified:** `src/imap/client.ts` (constant comments)
**Commit:** bf1e16c
**Applied fix:** The spec-side alignment was applied as part of the IN-02 commit (d35faa2), where MOD-0002's "Wedge detection" paragraph now explicitly states `searchByHeader` uses `WRITE_TIMEOUT_MS` because SEARCH is a server-side scan, not a metadata read. This commit (bf1e16c) updates the constant comments in `client.ts` to match: `WRITE_TIMEOUT_MS` block now lists every WRITE-class op (move/append/create/rename/delete/search) with rationale, and `BULK_FETCH_TIMEOUT_MS` block now lists `fetchAllMessages`, `fetchMessagesRaw`, AND `fetchNewMessages`. Spec, impl, and constant comment are now consistent.

### IN-04: TEST_CONFIG idleTimeout intentionally diverges from new schema default; consider adding a fixture for the new default

**Files modified:** `test/unit/imap/client.test.ts`
**Commit:** 8140d19
**Applied fix:** Added a single test in the `IDLE cycling` describe block — "cycles IDLE at the new schema default of 90s" — that constructs an `ImapClient` with `{ ...TEST_CONFIG, idleTimeout: 90_000 }`, advances fake timers by exactly 90_000ms, and asserts `noop` was called once. Test count went from 100 to 101; all green.

---

_Fixed: 2026-05-01T23:41:49Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
