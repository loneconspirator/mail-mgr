---
status: complete
phase: 08-extended-matchers-ui
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md]
started: 2026-04-12T18:00:00Z
updated: 2026-04-12T18:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start fresh. Server boots without errors, IMAP connects, web UI loads. No crashes or unhandled exceptions.
result: pass

### 2. Rule editor field order
expected: Open Add Rule or Edit Rule modal. All 8 fields appear in exact order: Name, Match Sender, Match Subject, Delivered-To, Recipient Field, Read Status, Action, Folder.
result: issue
reported: "The new fields are present, but there appears to have been several regressions: Name is required, the only Action option is Move, and Folder is not a picker, but a plain text input (which is rejected when submitted as required even when populated)"
severity: major

### 3. Disabled fields when envelope header NOT discovered
expected: If no envelope header has been discovered yet, Delivered-To and Recipient Field inputs are disabled (grayed out) with info icon tooltip explaining why. Read Status remains active.
result: blocked
blocked_by: server
reason: "Auto-detection runs on startup and config changes are not reloaded while the app is running"

### 4. Enabled fields when envelope header IS discovered
expected: After envelope header discovery has found a header, all five match fields (Sender, Subject, Delivered-To, Recipient Field, Read Status) are interactive and editable.
result: pass

### 5. Empty match field validation
expected: Try saving a rule with no match fields filled in. A toast notification appears: "At least one match field is required". Rule is NOT saved.
result: pass

### 6. Settings discovery section layout
expected: On the Settings page, below the IMAP form, there's a discovery section. If header was found: green badge with header name + "Re-run Discovery" button. If no header found: yellow warning message + "Run Discovery" button.
result: skipped
reason: "User could only verify first half (header found state). No-header state not testable without resetting discovery."

### 7. Discovery button interaction
expected: Click the discovery button. Button shows spinner animation, becomes unclickable during the API call. On completion, page re-renders with updated status and a toast notification.
result: issue
reported: "Clicking re-run detection simply shows Bad Request error"
severity: major

## Summary

total: 7
passed: 3
issues: 2
pending: 0
skipped: 1
blocked: 1

## Gaps

- truth: "Rule editor modal preserves all pre-existing field behaviors (Name optional, Action dropdown with all options, Folder as picker)"
  status: failed
  reason: "User reported: Name is required, the only Action option is Move, and Folder is not a picker but a plain text input (rejected when submitted)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Discovery re-run button triggers probe and updates UI with result"
  status: failed
  reason: "User reported: Clicking re-run detection simply shows Bad Request error"
  severity: major
  test: 7
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
