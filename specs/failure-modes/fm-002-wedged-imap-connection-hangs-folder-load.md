---
id: FM-002
title: Wedged IMAP connection silently halts every ImapClient operation
fault-injection-test: test/unit/imap/client.test.ts
integrations: [IX-001]
invariants-protected: []
modules: [MOD-0002]
---

## Trigger

The single shared IMAP socket enters a half-open state — TCP-alive from the client's point of view, but no longer responsive to the server (NAT translation timeout, server-side close without FIN, intermediate firewall reset, transient network partition followed by silent recovery). The local `imapflow` instance does not detect the wedge: `flow.usable` may flip to `false`, or the socket may sit in a state where new commands are written but no response ever arrives.

The `ImapClient` is still in the `connected` state at the application level. The IDLE cycler ticks but every IMAP command issued against the wedged socket either:

1. Returns immediately because `flow.usable` is `false`, with no error and no reconnect, **or**
2. Hangs indefinitely because the underlying `await` on the imapflow command never resolves and never rejects.

This was first discovered in production after ~four days of container uptime: the `/api/folders` endpoint was awaiting `flow.listTree()` against a wedged socket and the request hung silently. Subsequent incident review identified the same failure shape on every IMAP operation reachable from background processes (Monitor's fetchNewMessages, ReviewSweeper's fetchAllMessages, ActionFolderPoller's status + fetchAllMessages, MoveTracker's deep scan) and from web request handlers (batch dry-run/execute, envelope discovery, action-folder config, move-action routes, sentinel append/search/delete, sentinel scanner/healer LIST). All shared the same root cause: the single ImapClient socket wedged at the application layer with no protocol-level error to surface. Restarting the container restored function instantly because a fresh IMAP connection was established.

## Required behavior

The `ImapClient` MUST treat a wedged socket as a fatal connection error and force the reconnect path, regardless of which IMAP operation surfaces the wedge. Specifically:

- The IDLE/poll keepalive MUST detect both `flow.usable === false` and a hung NOOP. On either condition it MUST tear the connection down (calling the same handler that runs on an unexpected close) so exponential-backoff reconnect runs. It MUST NOT silently no-op and reschedule itself.

- **Every public IMAP operation EXCEPT `connect` itself** on `ImapClient` MUST route through a single chokepoint (`guardedOp`) that (a) refuses to issue when `flow.usable` is `false` and force-closes so reconnect runs, (b) bounds the underlying imapflow call with a per-op timeout, and (c) on timeout force-closes so reconnect runs. The covered operations are: `fetchNewMessages`, `fetchAllMessages`, `fetchMessagesRaw`, `moveMessage`, `appendMessage`, `searchByHeader`, `deleteMessage`, `listMailboxes`, `listFolders`, `status`, `createMailbox`, `renameFolder`, `getSpecialUseFolder`, plus the lock-acquisition path inside `withMailboxLock` and `withMailboxSwitch` (both can hang on the underlying `SELECT` command and must be guarded independently of the inner work).

- The **`connect` path** is the one exception: it cannot route through `guardedOp` because the `flow.usable` precheck is undefined while the freshly-created flow is still mid-handshake. Instead, `connect` uses raw `withTimeout` to bound `flow.connect()` and the initial `mailboxOpen('INBOX')` at `CONNECT_TIMEOUT_MS` each. Timeout errors from those bounds flow through the existing `connect()` catch block into `setState('error')` → `emit('error')` → `scheduleReconnect()`, so a wedge during the handshake still self-heals; it just takes a different path than the in-session wedge.

- When the wrapper detects a wedge it MUST transition out of `connected` so subsequent calls also fail fast rather than queueing behind the wedged socket.

- When `handleClose` runs (either from the IDLE trip-wire or from a per-op timeout) `cleanupFlow` MUST call `flow.close()` on the abandoned imapflow instance so its internal `requestTagMap` and pending locks are drained — without that call, callers already awaiting in-flight commands stay stuck forever even after a fresh reconnect.

- Caches that have a stale-fallback path (e.g. `FolderCache.refresh`'s catch branch) MUST be reachable: the underlying client error must propagate, not hang.

The system is NOT required to detect a wedge proactively (e.g. a separate watchdog) — the contract is that the **next command issued** against a wedged socket fails fast (within the per-op timeout window: 15s for LIST/STATUS/lock acquisition, 30s for WRITE/MOVE/APPEND, 120s for whole-folder FETCH).

## Why this exists

The single IMAP connection is shared by both the arrival path (IX-001) and on-demand request handlers (folder picker, batch dry-run, etc.). A wedge that the keepalive ignores is doubly dangerous:

1. **Silent IX-001 loss.** Even though the connection looked healthy at the application level, no new mail was being processed — the socket was dead. INV-001 only protects against IDLE being stranded on the wrong folder; it does not protect against IDLE running on a dead socket.
2. **Silent web hangs.** Any handler that awaits an IMAP operation hangs forever, with no log line, because no IMAP error is ever raised. The hang masquerades as "the page is loading slowly" indefinitely.
3. **Silent background-process loss.** Monitor (rule processing for new mail), ReviewSweeper (aged-message filing), ActionFolderPoller (drag-into-action-folder), and MoveTracker (manual-move detection for UC-001) all stop processing on a wedge. None of them log an error because the underlying `await` never throws. Symptoms range from "the inbox just stopped getting filed" to "drag stops working" — all environmental and impossible to reproduce on demand.

The "container restart fixed it" recovery path is unacceptable for a long-running service; the failure must self-heal via the existing exponential-backoff reconnect machinery. The trigger is environmental and difficult to reproduce reliably in a staging environment, so the contract is enforced by unit-level fault injection (forcing `usable=false`, returning a never-resolving promise from `noop` / `listTree`) rather than a network-level integration test.

## Test approach

`test/unit/imap/client.test.ts` (describe: `FM-002 wedged connection detection`) drives the wedge directly through the `ImapFlowLike` mock seam. The block has two layers:

1. **Existing per-op tests** for the pre-existing FM-002 surface (cycleIdle × usable=false, cycleIdle × hung-noop, listFolders × usable=false, listFolders × hung-listTree) — kept verbatim as the template.

2. **`it.each` matrix** generated over every public op covered by `guardedOp`. For each op, two cases:
   - **`usable=false`**: connect normally, flip `mockFlow.usable = false`, invoke the op, expect rejection with `/not usable/i`.
   - **never-resolving inner promise**: substitute the relevant mock method (e.g. `fetch`, `messageMove`, `getMailboxLock`) with a never-resolving promise, advance fake timers past the op's timeout, expect rejection with `/timed out/i`. Lock-acquisition cases (`withMailboxLock`, `withMailboxSwitch`) get a separate `it.each` block because they exercise a different mock key (`getMailboxLock`).

3. **R4 in-flight rejection test** (`R4: in-flight fetchAllMessages rejects when handleClose fires mid-flight`) — verifies the `cleanupFlow → flow.close() → imapflow rejects requestTagMap and locks` chain works end-to-end. Asserts that `mockFlow.close` was called and that the in-flight promise rejected.

4. **Connect-path tests** — connect-hang and mailboxOpen-hang variants inside the `connect` describe block, verifying that a wedge during reconnect doesn't leave the client stuck in `connecting`.

The fault-injection seam is `ImapFlowLike` (the existing test double interface), which is sufficient to exercise both wedge-detection paths and their interaction with `handleClose` / `scheduleReconnect`.

A future integration-level fault test could use a TCP proxy (Toxiproxy or similar) to drop traffic mid-IDLE and assert the same end-to-end recovery; that is intentionally out of scope here because the wedge is per-connection state, not a protocol-level invariant, and the unit-level injection is both faster and more deterministic.
