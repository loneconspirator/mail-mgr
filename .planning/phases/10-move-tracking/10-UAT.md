---
status: partial
phase: 10-move-tracking
source: [10-01-SUMMARY.md, 10-02-SUMMARY.md, 10-03-SUMMARY.md, 10-04-SUMMARY.md]
started: 2026-04-12T22:00:00Z
updated: 2026-04-12T22:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, migrations run (including move_signals table creation), and the web UI or health endpoint responds with live data.
result: pass

### 2. Move Tracking Enabled by Default
expected: With a fresh or existing config that has NO moveTracking section, the app starts with move tracking enabled and a 30-second scan interval (defaults from config schema). No config file changes required.
result: pass

### 3. MoveTracker Starts on IMAP Connect
expected: After the app connects to IMAP, the MoveTracker begins scanning. You should see move tracking activity in logs (initial UID snapshot scan of INBOX and Review folders). No errors about missing tables or failed scans.
result: pass

### 4. Signal Logging on Manual Move
expected: Move an email manually from INBOX to another folder (e.g., Archive). Wait ~60 seconds (two scan cycles). The move should be detected — a signal is logged to the move_signals table. Check via logs or DB inspection.
result: pass

### 5. System Move Exclusion
expected: When the app itself moves a message (via sweep rules or batch operations), that move is NOT logged as a user signal. Only manual/external moves produce signals.
result: pass

### 6. Destination Resolution (Fast Path)
expected: When a message disappears from INBOX, the system first checks recent/common folders (Archive, Trash, All Mail, etc.) to find where it went. For moves to common destinations, resolution should happen within the same scan cycle.
result: pass

### 7. Deep Scan Fallback
expected: If a moved message isn't found in common folders, a deep scan across all IMAP folders runs (on 15-minute timer). Once found, the destination is logged as a signal — not silently dropped.
result: skipped
reason: Requires 15-minute wait; core mechanism verified via code review and unit tests

### 8. IMAP Config Reload Rebuilds Tracker
expected: Change IMAP config (e.g., credentials or server). The old IMAP client disconnects (no connection leak), and MoveTracker is rebuilt with new settings. No orphaned connections or timers.
result: skipped
reason: Disruptive to test with live IMAP; code path verified in phase 10-03

### 9. Signal Pruning
expected: Signals older than 90 days are automatically pruned. A daily prune interval runs in the background. The prune interval uses .unref() so it doesn't prevent clean process shutdown.
result: skipped
reason: Daily interval; verified via unit tests and code review

### 10. Clean Shutdown
expected: Stop the application (Ctrl+C or SIGTERM). The process exits cleanly — no hanging timers, no error messages about unfinished operations, no zombie connections.
result: pass

## Summary

total: 10
passed: 7
issues: 0
pending: 0
skipped: 3
blocked: 0

## Gaps

[none yet]
