---
status: partial
phase: 25-action-folder-config-api-frontend-fix
source: [25-VERIFICATION.md]
started: 2026-04-21T22:15:00Z
updated: 2026-04-21T23:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Action folder rename guard works with dynamic prefix
expected: Clicking an action folder in settings shows "System folders cannot be renamed" message
result: issue
reported: "Renamed the VIP folder and it gave an error 'Rename failed: not found'. Frontend guard doesn't block action folder rename — hardcoded '/' delimiter doesn't match IMAP '.' delimiter."
severity: blocker

### 2. Normal folder rename still works
expected: Clicking a non-action, non-INBOX folder shows rename input
result: blocked
blocked_by: server
reason: "Server crashes on cold start — monitor.stop() disconnects shared IMAP client when null !== undefined triggers unnecessary monitor rebuild. Cannot test rename with server down."

### 3. Config API returns data in browser
expected: GET /api/config/action-folders returns 200 with JSON config object (check Network tab)
result: blocked
blocked_by: server
reason: "Server crashes on cold start — same startup bug as test 2."

## Summary

total: 3
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 2

## Gaps

- truth: "Clicking an action folder in settings shows 'System folders cannot be renamed' message"
  status: failed
  reason: "User reported: Renamed the VIP folder and it gave an error 'Rename failed: not found'. Frontend guard hardcodes '/' delimiter but IMAP uses '.' — guard check fails, rename input shown, rename attempt hits IMAP and errors."
  severity: blocker
  test: 1
  root_cause: "app.ts:1668 checks folderPath.startsWith(actionPrefix + '/') but IMAP delimiter is '.', so 'Actions.⭐ VIP Sender'.startsWith('Actions/') is false. Backend guard (folders.ts:65) also falls back to '/' when findNode returns null from stale cache."
  artifacts:
    - path: "src/web/frontend/app.ts"
      line: 1668
      issue: "Hardcoded '/' delimiter in action folder guard"
    - path: "src/web/routes/folders.ts"
      line: 51
      issue: "Delimiter fallback to '/' when node not found bypasses backend guard too"
  missing:
    - "Frontend guard should use the delimiter from the folder tree (available from folder picker data) instead of hardcoding '/'"
    - "Backend delimiter fallback should be '.' or fetched from config, not assumed '/'"
