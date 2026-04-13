---
status: complete
phase: 09-restore-clobbered-features
source: [09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md, 09-04-SUMMARY.md, 09-05-SUMMARY.md]
started: 2026-04-12T12:00:00Z
updated: 2026-04-12T12:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Recent Folders API
expected: GET /api/activity/recent-folders returns a JSON array of distinct folder paths that messages have been successfully moved to recently. Accepts an optional `limit` query parameter.
result: pass

### 3. Review Status API
expected: GET /api/review/status returns review folder stats: folder path, total/unread/read message counts, next sweep time, and last sweep summary.
result: pass

### 4. Review Config CRUD
expected: GET /api/review-config returns the current review configuration (folder, retention, sweep schedule). PUT /api/review-config updates the review config and changes take effect without restart.
result: pass

### 5. Batch Dry-Run Preview
expected: POST /api/batch/dry-run with a source folder returns a preview of which rules would match which messages, grouped by action. No messages are actually moved.
result: pass

### 6. Batch Execute and Cancel
expected: POST /api/batch/execute starts batch processing on a folder. Messages are moved/deleted per rules in chunks. POST /api/batch/cancel stops a running batch mid-execution.
result: pass

### 7. Batch Status API
expected: GET /api/batch/status returns current batch state: idle, running (with progress count), or completed (with result summary).
result: pass

### 8. Folder Tree API
expected: GET /api/folders returns the IMAP folder tree as nested JSON. Supports ?refresh=true to bypass cache and fetch fresh from server. Returns 503 if IMAP is disconnected.
result: pass

### 9. Batch Page in Web UI
expected: Clicking "Batch" in navigation shows the batch page. User can select a folder, run dry-run preview, review grouped results, execute batch, see progress, and view final results.
result: pass

### 10. Review Status Card in Web UI
expected: The dashboard/status page shows a review status card with the review folder name, message counts (total/unread/read), next sweep time, and last sweep summary.
result: pass

### 11. Sweep Settings in Web UI
expected: A sweep settings card allows configuring the review folder, retention period, and sweep destination using folder pickers. Changes persist via the review config API.
result: pass

### 12. Folder Picker in Rule Editor
expected: When creating or editing a rule with a "move" action, the folder destination field uses a tree-based folder picker showing the IMAP folder hierarchy with expand/collapse, recent folders section, and search/selection.
result: pass

### 13. Activity Source Badges
expected: Activity log entries show source badges indicating whether the action was triggered by arrival processing, sweep, or batch. Badges are visually distinct (e.g., different colors).
result: pass

### 14. Full Test Suite Green
expected: Running `npm test` (or equivalent) shows all 365 tests passing with zero failures.
result: pass

## Summary

total: 14
passed: 14
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
