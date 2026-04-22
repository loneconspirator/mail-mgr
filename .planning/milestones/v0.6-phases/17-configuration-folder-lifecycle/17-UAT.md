---
status: complete
phase: 17-configuration-folder-lifecycle
source: [17-01-SUMMARY.md, 17-02-SUMMARY.md]
started: 2026-04-20T21:00:00Z
updated: 2026-04-20T21:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running mail-mgr server. Start the application from scratch. Server boots without errors, startup sequence completes, IMAP connection establishes successfully.
result: pass

### 2. Action Folder Config Defaults
expected: With no actionFolders section in your config, the app should use defaults — enabled: true, prefix: "Actions", pollInterval: 15, and four emoji-prefixed folder names (⭐ VIP Sender, 🚫 Block Sender, ↩️ Undo VIP, ✅ Unblock Sender).
result: pass

### 3. Action Folder Config in default.yml
expected: Check config/default.yml — it should contain an actionFolders section with all defaults documented (enabled, prefix, pollInterval, and folders with vip/block/undoVip/unblock names).
result: pass

### 4. Action Folders Created on Startup
expected: After starting the server with actionFolders enabled, check your IMAP mailbox. Under the configured prefix (default "Actions"), four folders should exist: ⭐ VIP Sender, 🚫 Block Sender, ↩️ Undo VIP, ✅ Unblock Sender. If they already existed, no errors in the log.
result: pass

### 5. Action Folder Config Update
expected: Change an action folder name in your config (e.g., rename "⭐ VIP Sender" to "🌟 Super VIP"). The app should detect the change and create the new folder on the IMAP server without restarting.
result: resolved_stale
reason: Test assumed config.yml hot-reload via file watcher, but config changes go through API/UI by design. Phase 22 added folder rename through the settings UI, making manual-edit testing irrelevant.

### 6. Graceful Degradation on IMAP Failure
expected: If IMAP is unreachable or folder creation fails, the app should log a warning and continue running — not crash or hang.
result: pass

## Summary

total: 6
passed: 4
issues: 0
pending: 0
skipped: 0
resolved_stale: 1
blocked: 0

## Gaps

[none yet]
