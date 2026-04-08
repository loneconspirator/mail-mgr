---
status: partial
phase: 03-batch-filing-engine
source: [03-VERIFICATION.md]
started: 2026-04-08T19:25:00.000Z
updated: 2026-04-08T19:25:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Browser end-to-end batch workflow
expected: Navigate to Batch page, select a source folder via tree picker, click "Preview Dry Run", see grouped results with expandable message lists, click "Run Batch", see progress, then results summary with Moved/Skipped/Errors stats
result: [pending]

### 2. Progress bar live polling
expected: During batch execution, progress bar updates every 2 seconds with current processed/total count and Moved/Skipped/Errors counters
result: [pending]

### 3. Activity badge display
expected: After batch completes, Activity page shows batch-originated entries with an amber [batch] badge
result: [pending]

### 4. Cancel mid-batch
expected: Clicking "Cancel Batch" during execution shows "Cancelling..." button state, then results page shows partial stats with "Remaining: N messages not processed" line
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
