---
status: diagnosed
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
  root_cause: "Pre-existing gaps in rule editor (not phase 08 regressions). Line 196 validates !name making Name required. Line 174 hard-codes only Move option. Line 175 uses text input instead of select for folder. Line 210 hard-codes action type as move."
  artifacts:
    - path: "src/web/frontend/app.ts"
      issue: "Line 196: validation treats Name as required; Line 174: Action dropdown only has Move option; Line 175: Folder is text input not select; Line 210: action payload hard-coded to move"
    - path: "src/config/schema.ts"
      issue: "Lines 5-27: defines move, review, skip, delete but frontend only exposes move"
  missing:
    - "Remove !name from validation guard at line 196"
    - "Add review, skip, delete options to Action dropdown at line 174"
    - "Replace Folder text input with select populated from IMAP folder list"
    - "Update save handler at line 210 to construct correct action shape based on selected type"
  debug_session: ""

- truth: "Discovery re-run button triggers probe and updates UI with result"
  status: failed
  reason: "User reported: Clicking re-run detection simply shows Bad Request error"
  severity: major
  test: 7
  root_cause: "Content-Type/empty body mismatch. request() helper at api.ts:10-11 unconditionally sets Content-Type: application/json. triggerDiscovery() at api.ts:40 sends POST with no body. Fastify JSON parser rejects the empty body as invalid JSON, returning 400 before the handler runs."
  artifacts:
    - path: "src/web/frontend/api.ts"
      issue: "Line 10-11: Content-Type application/json set unconditionally; Line 40: triggerDiscovery sends POST with no body"
    - path: "src/web/routes/envelope.ts"
      issue: "Line 17: handler never reached — Fastify rejects at framework layer"
  missing:
    - "Only set Content-Type: application/json in request() when body is present, OR send body: JSON.stringify({}) in triggerDiscovery()"
  debug_session: ""
