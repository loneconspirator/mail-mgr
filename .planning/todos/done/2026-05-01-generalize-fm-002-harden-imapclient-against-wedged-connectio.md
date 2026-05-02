---
created: 2026-05-01T19:47:34.740Z
title: Generalize FM-002 — harden ImapClient against wedged-connection silent failures
area: general
files:
  - src/imap/client.ts
  - specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md
  - src/monitor/index.ts:132
  - src/sweep/index.ts:241
  - src/action-folders/poller.ts:47-80
  - src/tracking/index.ts:318
  - src/batch/index.ts:92,183,274
  - src/imap/discovery.ts:23
  - src/action-folders/folders.ts:11,49
  - src/actions/index.ts:71-77
  - src/sentinel/imap-ops.ts:27,43,57
  - src/sentinel/scanner.ts:147
  - src/sentinel/healer.ts:41,203
  - test/unit/imap/client.test.ts
---

## Problem

FM-002 (commit 79d0315) only fixed two paths: the IDLE keepalive (force-close on `flow.usable === false` or hung NOOP) and `listFolders` (refuse + bound). Every other public op on `ImapClient` remains unbounded against a half-open IMAP socket. The app likely feels flaky in production because all of the following can silently hang for the full keepalive window (default 5 minutes) or forever, with no logs, until container restart:

**Background processes that go silent on a wedge:**
- **Monitor** (`src/monitor/index.ts:132` → `fetchNewMessages` → `withMailboxLock('INBOX')`) — rule processing for new mail stops dead. Same symptom as FM-001 but a different root cause.
- **ReviewSweeper** (`src/sweep/index.ts:241` — `fetchAllMessages('Review')`) — sweep ticks hang; aged messages stop getting filed/trashed; subsequent ticks pile up because `setInterval` fires while previous awaits are stuck.
- **ActionFolderPoller** (`src/action-folders/poller.ts:47-80` — `status` + `fetchAllMessages` x4 every 15s) — most user-visible silent symptom. Drag-into-action-folder stops doing anything. Stacked awaits.
- **MoveTracker deep scan** (`src/tracking/index.ts:318`) — manual-move detection silently breaks; UC-001 (manual move → rule proposal) dies.

**Web-triggered ops that hang the request:**
- `POST /api/batch/dry-run`, `/api/batch/execute` (`src/batch/index.ts:92,183,274`) — UC-004 dead.
- `POST /api/tracking/deep-scan` — hangs.
- `POST /api/config/envelope/discover` (`src/imap/discovery.ts:23` — `withMailboxLock('INBOX')`) — hangs.
- `PUT /api/config/action-folders` (`src/action-folders/folders.ts:11,49` — `client.status`, `createMailbox`) — hangs.
- Move-action route handlers (`src/actions/index.ts:71-77` — `moveMessage` + `createMailbox`) — manual rule application hangs.
- Folder rename (`src/folders/cache.ts:43`).

**Sentinel infrastructure:**
- `src/sentinel/imap-ops.ts:27,43,57` (`appendMessage`, `searchByHeader`, `deleteMessage`) — sentinel write/read/cleanup all hang.
- `src/sentinel/scanner.ts:147` and `src/sentinel/healer.ts:41` (`listMailboxes`) — scanner and healer hang.
- `src/sentinel/healer.ts:203` (`appendMessage('INBOX', ...)`) — disposition notifications hang.

**Reconnect itself:**
- `src/imap/client.ts:108` — `flow.connect()` is unbounded. A wedged handshake leaves the client stuck in `connecting` forever and blocks all reconnect attempts.

**The unverified question:**
- When `handleClose` fires (FM-002 trip-wire), do the already-awaiting `getMailboxLock` / `fetch` / `messageMove` promises actually reject? If imapflow does NOT propagate close to in-flight ops, those promises stay pending forever even after reconnect — only the *next* call benefits. This needs to be tested, not assumed.

## Solution

Generalize FM-002 spec and the implementation together so they stay in sync.

1. **Spec** — widen `specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md` "Required behavior" section so it binds the *entire* `ImapClient` public surface, not just IDLE+listFolders. Reframe the title around "wedged connection silent failure" rather than "folder load".
2. **Generic guard** — add a private wrapper method on `ImapClient` (something like `private async guardedOp<T>(label: string, op: () => Promise<T>, timeoutMs: number): Promise<T>`) that (a) checks `flow` exists and `flow.usable`, (b) wraps the inner imapflow call with `withTimeout`, (c) on timeout or thrown wedge-shaped error calls `handleClose` so reconnect runs. Apply it to every public op: `fetchAllMessages`, `fetchNewMessages`, `moveMessage`, `appendMessage`, `searchByHeader`, `deleteMessage`, `listMailboxes`, `listFolders` (already done — refactor to use the wrapper), `status`, `createMailbox`, `renameFolder`, `getSpecialUseFolder`, plus the inner work inside `withMailboxLock` / `withMailboxSwitch` (the `getMailboxLock` call itself is unbounded — this is what hangs the Monitor).
3. **Bound `flow.connect()`** at `src/imap/client.ts:108` with a CONNECT_TIMEOUT_MS so a wedged handshake doesn't leave us stuck in `connecting`. On timeout transition to `error` and schedule reconnect.
4. **Verify in-flight rejection** — write a fault-injection test that starts an op (e.g. `fetchAllMessages` with a never-resolving fetch), triggers `handleClose` mid-flight, and asserts the in-flight promise rejects within the timeout window. If it doesn't, we need an explicit cancellation mechanism (AbortController plumbed through, or tracking pending promises and rejecting them in `cleanupFlow`).
5. **Tune `idleTimeout`** — current default is 300_000ms (5 min). Wedge-detection latency for a user-facing request can be that long in the worst case. Consider 60-90s as the new default in `src/config/schema.ts`.
6. **Tests** — extend `test/unit/imap/client.test.ts` `FM-002 wedged connection detection` describe block to cover each public op's two failure shapes (`usable=false` and never-resolving promise). Mirror the existing pattern.

Implement and ship as a single phase so the spec generalization lands with the code that satisfies it.
