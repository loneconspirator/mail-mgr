---
status: partial
phase: 08-extended-matchers-ui
source: [08-VERIFICATION.md]
started: 2026-04-12T10:25:00Z
updated: 2026-04-12T10:25:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Rule editor field order
expected: All 8 fields appear in exact order: Name, Match Sender, Match Subject, Delivered-To, Recipient Field, Read Status, Action, Folder
result: [pending]

### 2. Disabled fields when envelope header NOT discovered
expected: Delivered-To and Recipient Field have disabled attribute and grayed styling with info icon tooltip. Read Status is active.
result: [pending]

### 3. Enabled fields when envelope header IS discovered
expected: All five match fields are interactive and editable
result: [pending]

### 4. Empty match field validation
expected: Toast: "At least one match field is required" when saving with no match fields
result: [pending]

### 5. Settings discovery section layout
expected: Discovery section visible below IMAP form with either green badge+Re-run button (header found) or yellow warning+Run Discovery button (no header)
result: [pending]

### 6. Discovery button interaction
expected: Button shows spinner animation, disables pointer-events during API call, restores on completion/error, page re-renders with updated status and toast
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
