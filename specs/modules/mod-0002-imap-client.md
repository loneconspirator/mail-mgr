---
id: MOD-0002
title: ImapClient
interface-schema: src/imap/client.ts
unit-test-path: test/unit/imap/
integrations: [IX-001, IX-002, IX-003, IX-006, IX-007, IX-008, IX-009, IX-010]
invariants-enforced: [INV-001]
architecture-section: architecture.md#imap--infrastructure
---

## Responsibility

Abstraction over imapflow providing all IMAP operations: connect/disconnect with exponential backoff reconnect, IDLE support with polling fallback, message fetching (by UID range or full folder), message moving and deletion, mailbox creation/listing/renaming, and special-use folder lookup. Serializes mailbox operations via lock abstraction.

## Interface Summary

- `connect()` — Establish IMAP connection, begin IDLE or polling.
- `disconnect()` — Close connection gracefully.
- `moveMessage(uid, destination, sourceFolder?)` — Move a message by UID to a destination folder.
- `fetchNewMessages(sinceUid)` — Fetch messages from INBOX with UIDs greater than the given cursor.
- `fetchAllMessages(folder)` — Fetch all messages from a folder as ReviewMessage objects.
- `fetchMessagesRaw(range, query)` — Fetch raw imapflow message records for a UID range with the given query (used by signal-logging paths that need fields beyond ReviewMessage).
- `listMailboxes()` — List all mailboxes with flags.
- `listFolders()` — List folder tree as hierarchical FolderNode objects.
- `status(path)` — Get message count and unseen count for a folder.
- `createMailbox(path)` — Create a mailbox (supports nested paths).
- `renameFolder(oldPath, newPath)` — Rename a folder.
- `appendMessage(folder, raw, flags)` — Append a raw message to a folder.
- `searchByHeader(folder, headerName, headerValue)` — Search for messages by header value.
- `deleteMessage(folder, uid)` — Delete a message by UID.
- `getSpecialUseFolder(use)` — Look up special-use folders (e.g., `\Trash`).
- `withMailboxLock(folder, fn, workTimeoutMs?)` — Execute a function with an exclusive mailbox lock; `workTimeoutMs` bounds the inner work (defaults to `WRITE_TIMEOUT_MS`); the lock acquisition itself is bounded by `LOCK_TIMEOUT_MS`.
- `withMailboxSwitch(folder, fn, workTimeoutMs?)` — Execute a function after switching to a folder (shared access); same timeout shape as `withMailboxLock`; the post-work INBOX restore is also routed through `guardedOp`.
- `state` — Current connection state: disconnected, connecting, connected, or error.
- `idleSupported` — Whether the server supports IDLE.

## Dependencies

- imapflow (external) — Underlying IMAP protocol implementation.
- Config (imap section) — Host, port, auth, timeouts.

## Notes

- Emits `newMail`, `connected`, `disconnected`, and `error` events via EventEmitter.
- Reconnect uses exponential backoff from 1s to 60s.
- `withMailboxLock` and `withMailboxSwitch` handle folder context switching; callers should use the appropriate one based on whether they need exclusive access.
- **Wedge detection (FM-002).** Every public IMAP operation EXCEPT `connect` itself routes through a single private `guardedOp` chokepoint that (a) refuses to issue when `flow.usable` is false (force-closing so `scheduleReconnect` runs), (b) bounds the underlying imapflow call with a per-op timeout, and (c) force-closes on timeout. The `connect` path is the one exception — it uses raw `withTimeout` to bound `flow.connect()` and the initial `mailboxOpen('INBOX')` at `CONNECT_TIMEOUT_MS`, because `guardedOp`'s `flow.usable` precheck is undefined during the handshake; the timeout error still flows through the existing `connect()` catch → `setState('error')` → `scheduleReconnect()` path. Coverage is otherwise end-to-end: the IDLE keepalive's `noop`, every read op (`fetchNewMessages`, `fetchAllMessages`, `fetchMessagesRaw`, `listMailboxes`, `listFolders`, `status`, `getSpecialUseFolder`, `searchByHeader`), every write op (`moveMessage`, `appendMessage`, `createMailbox`, `renameFolder`, `deleteMessage`), and the lock-acquisition path inside `withMailboxLock` and `withMailboxSwitch`. Timeout buckets: `LOCK_TIMEOUT_MS`/`LIST_TIMEOUT_MS` 15s, `WRITE_TIMEOUT_MS`/`NOOP_TIMEOUT_MS`/`CONNECT_TIMEOUT_MS` 30s, `BULK_FETCH_TIMEOUT_MS` 120s (used by `fetchAllMessages`, `fetchNewMessages`, `fetchMessagesRaw`). `searchByHeader` uses `WRITE_TIMEOUT_MS` (30s) because a server-side SEARCH is a scan operation, not a metadata read like LIST/STATUS. The trip-wire keys off a `TimeoutError` sentinel class instance check (not a regex on the error message) so a server-side "timed out" error string can't falsely trigger reconnect. `cleanupFlow` calls `flow.close()` before nulling the reference so imapflow's internal `requestTagMap` and pending locks reject — without that call, callers already mid-await on the abandoned flow stay stuck forever. Silent no-op on a wedged socket is forbidden; every command path must surface a half-open socket as a thrown error within seconds so callers can fail fast and reconnect can run.
