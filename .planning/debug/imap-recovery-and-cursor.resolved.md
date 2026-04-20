---
status: resolved
trigger: "MoveTracker fails to recover after IMAP socket timeouts, missing new mail. Non-cursor mode may not scan full inbox on startup."
created: 2026-04-19T00:00:00Z
updated: 2026-04-20T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — All three fixes already applied in commit 8e3a91e
test: Dev environment restart verified "IMAP already connected, running initial scan" fires on boot, all 9 messages processed
expecting: N/A — verified
next_action: None — resolved

## Symptoms

expected: MoveTracker should continuously monitor the INBOX via IMAP IDLE, recover from connection drops, and process all new/existing mail. When "keep mail cursor" is unchecked (non-cursor mode), it should scan the entire inbox on startup.
actual: After IMAP socket timeouts (ETIMEOUT), MoveTracker stops processing new mail and doesn't recover. Running a manual batch finds messages that should have been moved. On boot with cursor disabled, it's not scanning the full inbox.
errors: 1. Socket timeout: Error at TLSSocket._socketTimeout (imapflow/lib/imap-flow.js:803:29) - code: ETIMEOUT 2. Connection not available: Error at createNoConnectionError (imapflow/lib/imap-flow.js:1726:31) - code: NoConnection, "MoveTracker scan failed"
reproduction: Let the app run for a while on a real IMAP server. Connection drops happen naturally. The MoveTracker stops working after drops.
started: Ongoing issue.

## Eliminated

- hypothesis: ImapClient reconnection logic is broken (never reconnects after ETIMEOUT)
  evidence: Traced ImapFlow internals — emitError() always calls closeAfter() which triggers close(), which fires the 'close' event. Our handleClose() then schedules reconnect with backoff. The reconnection path itself is sound.
  timestamp: 2026-04-19

- hypothesis: MoveTracker setInterval stops firing after errors
  evidence: The setInterval in MoveTracker.start() (line 84) keeps firing regardless of errors — errors are caught in the .catch() handler. The scan simply skips when client.state !== 'connected' and resumes on next tick after reconnection.
  timestamp: 2026-04-19

## Evidence

- timestamp: 2026-04-19
  checked: Monitor.start() event registration vs ImapClient.connect() call order in main()
  found: In main() line 201, imapClient.connect() is called and awaited BEFORE monitor.start() on line 218. monitor.start() registers the 'connected' event handler, then calls this.client.connect() which early-returns because state is already 'connected'. The 'connected' event was emitted during the first connect() call when no handlers were registered. Result: processNewMessages() is NEVER called on initial startup.
  implication: This is why non-cursor mode (lastUid=0, intended to scan all messages) doesn't work on startup — the initial scan simply never fires. Messages only get processed when newMail events arrive from IDLE/polling.

- timestamp: 2026-04-19
  checked: Monitor 'connected' handler behavior on reconnection
  found: After disconnect+reconnect, connect() creates a new ImapFlow, connects, and emits 'connected'. Monitor's handler IS still registered and DOES fire processNewMessages(). This works correctly for reconnection.
  implication: Reconnection itself works for Monitor. The bug is only on initial startup.

- timestamp: 2026-04-19
  checked: MoveTracker recovery after IMAP reconnection
  found: MoveTracker does NOT listen for any ImapClient events (connected, disconnected, error). It relies on setInterval + checking client.state at scan time. After reconnection, the next scan interval finds client.state === 'connected' and proceeds. However, during ImapFlow's internal IDLE recovery window (NOOP + re-idle attempt), client state stays 'connected' even though the connection may be degraded. MoveTracker scans during this window hit NoConnection errors from ImapFlow's internal state.
  implication: The "MoveTracker scan failed" NoConnection errors are transient — they happen during the brief window where ImapFlow is internally recovering. The scan catches the error and the next interval retries. This is noisy but not the root cause of permanent failure.

- timestamp: 2026-04-19
  checked: Whether error events could crash the process
  found: Between imapClient.connect() (line 201) and monitor.start() (line 218) in main(), there is NO error listener on the ImapClient EventEmitter. If an IMAP error fires during envelope header probing (lines 203-208), the unhandled 'error' event on EventEmitter would throw and crash the process.
  implication: Secondary issue — potential crash on startup if IMAP error fires before Monitor registers its error handler.

- timestamp: 2026-04-19
  checked: Whether all three fixes from diagnosis are present in current codebase
  found: Commit 8e3a91e ("fix: resolve IMAP recovery failures — startup scan race, transient errors, listener gap") already applied all three fixes. It is an ancestor of HEAD on main. (1) Monitor.start() lines 96-99 detect already-connected state and trigger processNewMessages(). (2) MoveTracker.runScan() lines 145-156 catch NoConnection/ETIMEOUT at debug level. (3) src/index.ts lines 201-204 register error listener before connect().
  implication: No new code changes needed — the fixes were already implemented and committed before this session resumed.

## Resolution

root_cause: |
  PRIMARY (non-cursor startup scan never fires): In src/index.ts, imapClient.connect() is called on line 201 and awaited before monitor.start() on line 218. Monitor.start() registers the 'connected' event handler and then calls this.client.connect(), which early-returns because the client is already connected. The 'connected' event was already emitted (during the first connect()) when no listener was registered. Result: processNewMessages() never fires on startup. In non-cursor mode (lastUid=0), this means the full inbox scan that's supposed to happen on boot never occurs. Messages are only processed when new mail arrives via IDLE/polling.

  SECONDARY (transient NoConnection errors during IMAP recovery): When ImapFlow detects a socket timeout during IDLE, it attempts internal recovery (NOOP + re-idle) without emitting any events to our code. During this recovery window, our client state remains 'connected' but ImapFlow operations can throw NoConnection errors. MoveTracker scans during this window fail with "MoveTracker scan failed" NoConnection. These are transient and self-recovering once ImapFlow either recovers or fully disconnects (triggering our reconnect logic), but they are noisy and confuse the user into thinking MoveTracker is permanently broken.

  TERTIARY (missing error listener window): Between imapClient.connect() and monitor.start() in main(), no error listener is registered on ImapClient. An IMAP error during this window would crash the process via unhandled EventEmitter error.
fix: All three fixes applied in commit 8e3a91e. (1) Monitor.start() now checks client.state === 'connected' after registering listeners — if connect() already ran, triggers processNewMessages() explicitly. (2) MoveTracker.runScan() catches NoConnection/ETIMEOUT errors and logs at debug level instead of throwing. (3) Error listener registered on imapClient before connect() call in main().
verification: Verified all three fixes present in current HEAD (main branch). Commit 8e3a91e is an ancestor of HEAD (4ae085b).
files_changed: [src/index.ts, src/monitor/index.ts, src/tracking/index.ts]
