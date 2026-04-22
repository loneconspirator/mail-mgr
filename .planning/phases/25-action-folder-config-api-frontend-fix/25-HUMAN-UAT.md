---
status: diagnosed
phase: 25-action-folder-config-api-frontend-fix
source: [25-VERIFICATION.md]
started: 2026-04-21T22:15:00Z
updated: 2026-04-22T00:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Action folder rename guard works with dynamic prefix
expected: Clicking an action folder in settings shows "System folders cannot be renamed" message
result: pass

### 2. Normal folder rename still works
expected: Clicking a non-action, non-INBOX folder shows rename input
result: issue
reported: "pass except that if I rename 'Review' to 'Low Priority', the Sweep settings' selected folder remains 'Review'. That seems like a problem"
severity: major

### 3. Config API returns data in browser
expected: GET /api/config/action-folders returns 200 with JSON config object (check Network tab)
result: pass

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Renaming a folder updates all references to that folder in config (e.g. Sweep settings)"
  status: failed
  reason: "User reported: if I rename 'Review' to 'Low Priority', the Sweep settings' selected folder remains 'Review'. That seems like a problem"
  severity: major
  test: 2
  root_cause: "POST /api/folders/rename in src/web/routes/folders.ts (lines 28-89) renames the folder on IMAP but never updates config references. review.folder, review.trashFolder, review.defaultArchiveFolder, and rules[].action.folder all retain the old path."
  artifacts:
    - path: "src/web/routes/folders.ts"
      line: 28
      issue: "Rename endpoint has no config update logic after IMAP rename"
    - path: "src/config/repository.ts"
      line: 107
      issue: "Has getReviewConfig/updateReviewConfig but rename endpoint doesn't use them"
  missing:
    - "After cache.renameFolder() succeeds, scan review config fields and rule action folders for oldPath references and update them to fullNewPath"
  debug_session: ""
