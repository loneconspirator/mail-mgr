---
id: MOD-0002
title: ImapClient
interface-schema: src/imap/client.ts
unit-test-path: test/unit/imap/
integrations: [IX-001, IX-002, IX-003, IX-006]
invariants-enforced: []
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
- `listMailboxes()` — List all mailboxes with flags.
- `listFolders()` — List folder tree as hierarchical FolderNode objects.
- `status(path)` — Get message count and unseen count for a folder.
- `createMailbox(path)` — Create a mailbox (supports nested paths).
- `renameFolder(oldPath, newPath)` — Rename a folder.
- `appendMessage(folder, raw, flags)` — Append a raw message to a folder.
- `searchByHeader(folder, headerName, headerValue)` — Search for messages by header value.
- `deleteMessage(folder, uid)` — Delete a message by UID.
- `getSpecialUseFolder(use)` — Look up special-use folders (e.g., `\Trash`).
- `withMailboxLock(folder, fn)` — Execute a function with an exclusive mailbox lock.
- `withMailboxSwitch(folder, fn)` — Execute a function after switching to a folder (shared access).
- `state` — Current connection state: disconnected, connecting, connected, or error.
- `idleSupported` — Whether the server supports IDLE.

## Dependencies

- imapflow (external) — Underlying IMAP protocol implementation.
- Config (imap section) — Host, port, auth, timeouts.

## Notes

- Emits `newMail`, `connected`, `disconnected`, and `error` events via EventEmitter.
- Reconnect uses exponential backoff from 1s to 60s.
- `withMailboxLock` and `withMailboxSwitch` handle folder context switching; callers should use the appropriate one based on whether they need exclusive access.
