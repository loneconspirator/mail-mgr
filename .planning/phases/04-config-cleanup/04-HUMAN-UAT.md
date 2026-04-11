---
status: partial
phase: 04-config-cleanup
source: [04-VERIFICATION.md]
started: 2026-04-10T19:10:00Z
updated: 2026-04-10T19:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Sweep settings card shows editable form fields
expected: Three folder tree pickers (Review, Archive, Trash), three numeric inputs (Interval, Read Age, Unread Age), cursor toggle checkbox, and Save button — not a static read-only list
result: [pending]

### 2. Save sweep settings persists changes
expected: Change sweep interval to 12 → Save → toast "Sweep settings saved" → refresh → field shows 12
result: [pending]

### 3. Tree picker works for folder selection
expected: Tree picker opens showing folder hierarchy, selecting a folder updates value, saving persists
result: [pending]

### 4. Cursor toggle controls Monitor restart behavior
expected: Uncheck cursor → save → restart server → logs show UID 1:* range. Re-enable → restart → resumes from stored UID.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
