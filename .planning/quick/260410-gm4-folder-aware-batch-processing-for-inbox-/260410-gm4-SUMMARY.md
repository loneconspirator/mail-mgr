# Quick Task 260410-gm4: Folder-aware batch processing for INBOX and Review

**Completed:** 2026-04-10
**Commit:** b75a0bf

## What Changed

BatchEngine now detects which folder it's processing and switches behavior:

- **INBOX mode**: Behaves like the monitor — review actions route to the review folder, skip/no-match messages stay in INBOX
- **Review mode**: Behaves like the sweeper — checks message age eligibility, routes eligible messages via `resolveSweepDestination`, ineligible messages are skipped
- **Generic mode**: Unchanged — review actions resolve to the rule's destination folder

## Files Modified

| File | Change |
|------|--------|
| `src/batch/index.ts` | Added `getProcessingMode()`, updated `resolveDestination()` and `processChunk()` for inbox/review/generic branching. Added sweep imports. |
| `src/index.ts` | Passes `reviewFolder` and `reviewConfig` to BatchEngine constructor |
| `test/unit/batch/engine.test.ts` | 10 new tests covering INBOX mode (5) and Review mode (5). 38 total tests passing. |

## Test Results

```
✓ test/unit/batch/engine.test.ts (38 tests) 11ms
Test Files  1 passed (1)
Tests       38 passed (38)
```
