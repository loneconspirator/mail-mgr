---
status: partial
phase: 12-retroactive-verification
source: [12-VERIFICATION.md]
started: 2026-04-20T00:25:00Z
updated: 2026-04-20T00:25:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Click Run Discovery button on IMAP settings page
expected: Network request fires to POST /api/config/envelope/discover, discovery result updates on page
result: [pending]

### 2. Remove envelope config, open rule editor, verify deliveredTo and visibility fields are disabled
expected: Fields appear disabled with info icon indicating envelope data unavailable, while readStatus remains enabled
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
