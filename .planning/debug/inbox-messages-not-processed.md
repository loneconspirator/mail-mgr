---
status: diagnosed
trigger: "Messages arriving in the user's inbox around 7:10 AM and 7:30 AM on 2026-04-25 should have been moved out of the inbox by mail-mgr rules, but they're still sitting there. The activity page shows nothing about these messages at all."
created: 2026-04-25T07:45:00Z
updated: 2026-04-25T10:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — MoveTracker's withMailboxLock('Review') leaves ImapFlow's selected mailbox on Review, causing IDLE to monitor Review instead of INBOX. New INBOX messages never trigger exists events.
test: Traced ImapFlow SELECT command handler — it sets mailbox.exists directly without emitting exists event
expecting: N/A — root cause confirmed
next_action: Return diagnosis

## Symptoms

expected: Messages matching rules should be automatically moved out of inbox to their target folders
actual: Messages from ~7:10 and ~7:30 AM today are still in the inbox, untouched
errors: None visible — activity page is blank for these messages
reproduction: Check inbox — messages that should have been processed are still there
started: 2026-04-25 morning, after IMAP socket timeout + reconnect at ~2:58 AM PDT

## Eliminated

- hypothesis: Circuit breaker or skip logic from phase 33 prevented processing
  evidence: No circuit breaker code exists in the codebase. Sentinel skip is header-based and only skips sentinel messages.
  timestamp: 2026-04-25T09:30:00Z

- hypothesis: Container crashed or Node.js process died
  evidence: Container up 16 hours, process alive (PID 1), web UI responding, MoveTracker lastScanAt is recent
  timestamp: 2026-04-25T09:35:00Z

- hypothesis: Monitor processing flag stuck at true (processNewMessages silently returning)
  evidence: After reconnect #1, all UIDs 196094-196101 were processed and loop completed normally. processing flag would have been reset.
  timestamp: 2026-04-25T09:40:00Z

## Evidence

- timestamp: 2026-04-25T09:30:00Z
  checked: Docker container logs since startup
  found: Last log entry is "IMAP connected, running initial scan" at 1777111097894 (2:58 AM PDT). Zero log output for 4+ hours despite process being alive.
  implication: Monitor is not receiving newMail events, so processNewMessages is never called after the initial scan

- timestamp: 2026-04-25T09:35:00Z
  checked: MoveTracker status via API (http://192.168.1.90:2999/api/tracking/status)
  found: lastScanAt "2026-04-25T16:05:28.073Z" (9:05 AM PDT), messagesTracked=159 — MoveTracker IS running
  implication: The IMAP connection is alive and working for MoveTracker, but Monitor is blind to new INBOX messages

- timestamp: 2026-04-25T09:40:00Z
  checked: MoveTracker scanFolder code (src/tracking/index.ts:138)
  found: MoveTracker scans [INBOX, Review] using withMailboxLock. INBOX is scanned first, then Review. After Review scan completes, mailbox is left selected on Review.
  implication: IDLE runs on Review folder, not INBOX. ImapFlow's exists event only fires for untagged EXISTS responses during IDLE, which are specific to the selected mailbox.

- timestamp: 2026-04-25T09:45:00Z
  checked: ImapFlow SELECT command handler (node_modules/imapflow/lib/commands/select.js:127-133)
  found: During SELECT, EXISTS count is stored in map.exists without emitting an 'exists' event. The event is only emitted via untaggedExists handler during IDLE.
  implication: When MoveTracker re-SELECTs INBOX every 30 seconds, the new message count is set silently. The Monitor's newMail chain (exists -> newMail -> processNewMessages) is never triggered.

- timestamp: 2026-04-25T09:50:00Z
  checked: ImapClient withMailboxLock vs withMailboxSwitch
  found: withMailboxSwitch (line 152) reopens INBOX after the operation and restarts IDLE. withMailboxLock (line 142) does NOT reopen INBOX. MoveTracker uses withMailboxLock for Review folder scanning.
  implication: withMailboxSwitch was designed exactly for this scenario but MoveTracker doesn't use it for the Review folder scan.

## Resolution

root_cause: MoveTracker uses withMailboxLock (not withMailboxSwitch) to scan the Review folder every 30 seconds. This leaves ImapFlow's selected mailbox on Review instead of INBOX. IDLE then monitors Review, not INBOX. New INBOX messages never trigger the exists event, so Monitor.processNewMessages() is never called. The problem manifests after any reconnect because the initial scan processes existing messages, but all subsequent new-mail detection is broken.
fix:
verification:
files_changed: []
