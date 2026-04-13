---
status: partial
phase: 11-pattern-detection
source: [11-VERIFICATION.md]
started: 2026-04-12T23:45:00Z
updated: 2026-04-12T23:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Empty state rendering
expected: Open Proposed tab with no proposals — "No proposed rules yet" with explanatory text, no console errors
result: [pending]

### 2. Proposal cards with live data
expected: Move messages manually, wait for MoveTracker scan, confirm cards appear with strength badge, sender -> destination route, example subjects, and action buttons
result: [pending]

### 3. Approve flow
expected: Click Approve on a card — exactly one new rule in Rules tab named "Auto: <sender>", card fades out with toast
result: [pending]

### 4. Modify flow (critical — no duplicate rules)
expected: Click Modify, edit in modal, save — exactly ONE new rule created (not two). markApproved vs approve endpoint invariant
result: [pending]

### 5. Dismiss flow
expected: Click Dismiss, card disappears with toast, badge count decrements
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
