---
id: INV-001
title: IMAP IDLE always returns to INBOX after non-INBOX folder operations
enforcement:
  - type: code-discipline
    ref: src/imap/client.ts#withMailboxSwitch
  - type: fault-injection-test
    ref: test/integration/fm-001-scheduled-scan-strands-idle.test.ts
modules: [MOD-0002, MOD-0009, MOD-0016, MOD-0017, MOD-0018]
---

## Statement

After any IMAP operation against a folder other than INBOX completes — successfully or with an error — the `ImapClient` MUST leave the connection in a state where:

1. The currently selected mailbox is INBOX, and
2. IDLE (or the polling fallback when IDLE is unsupported) is actively listening on INBOX such that arrivals dispatch the `newMail` event consumed by IX-001.1.

This invariant binds every consumer of `ImapClient` that operates on a non-INBOX folder, including arrival-handling code that walks into the trash, the review-sweep folder scan, the action-folder poller, and any future scheduled job. The invariant holds even if the scheduled job throws partway through.

## Why this exists

The single shared IMAP connection is also the heartbeat that keeps inbound rule processing alive. If a scheduled process selects a different folder and forgets to re-select INBOX and re-arm IDLE, IX-001 (arrival detection and rule evaluation) silently stops firing for new mail until the next reconnect. There is no automatic detection of this state because the connection itself is still healthy and other scheduled jobs continue to function — only the arrival path breaks, and only when there is mail to process.

This was discovered after a production incident in which rules stopped firing because a scheduled folder-scan held the connection on a non-INBOX folder and never returned. See FM-001 for the adversarial condition this invariant defends against.

## Enforcement

- **Code discipline (`withMailboxSwitch`)** — The canonical path for any non-INBOX folder operation is `ImapClient.withMailboxSwitch(folder, fn)`. Its `finally` block re-opens INBOX (best-effort) and restarts IDLE/polling. New scheduled consumers MUST go through this helper rather than calling `getMailboxLock` or `mailboxOpen` directly. `withMailboxLock` is reserved for INBOX-only operations.
- **Fault-injection test (FM-001)** — Exercises each scheduled consumer (ReviewSweeper, ActionFolderPoller) and asserts that after the consumer's tick — both the success path and a forced-error path — the connection is back on INBOX and a freshly appended INBOX message produces a `newMail` event.

## Known violation modes

- **FM-001** — Scheduled folder scan leaves IMAP IDLE on non-inbox folder.
