---
phase: 21-idempotency-edge-cases
reviewed: 2026-04-20T12:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/action-folders/processor.ts
  - test/unit/action-folders/processor.test.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-04-20T12:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the `ActionFolderProcessor` class and its comprehensive test suite. The processor handles idempotency, conflict resolution, crash recovery, and multi-field rule preservation correctly. The code is well-structured with clear separation of concerns. Two minor issues found -- one potential logic gap and one test quality concern.

## Warnings

### WR-01: Stale rules snapshot used after mutation during conflict+duplicate check

**File:** `src/action-folders/processor.ts:59`
**Issue:** On line 43, `getRules()` is called once and stored in `rules`. On line 53, `deleteRule()` mutates the config repo (removing the conflict). On line 59, `findSenderRule` searches the same `rules` array for a duplicate. If `getRules()` returns a live reference (backed by an array that is mutated in-place by `deleteRule`), this works correctly. However, if `getRules()` returns a snapshot/copy, the deleted conflict rule would still appear in `rules` -- though in practice this is not a bug because `findSenderRule` filters by action type (the conflict is the opposite action type, so it would never match the duplicate check anyway). 

That said, the broader pattern of holding a stale snapshot across mutations is fragile for future changes. If someone adds logic that queries `rules` after a mutation expecting fresh state, they could hit a subtle bug.

**Fix:** Consider re-fetching rules after the conflict deletion, or add a comment documenting that the snapshot is intentionally stale and safe because the duplicate check uses a different action type filter:
```typescript
// Safe: conflict was opposite action type, won't appear in same-type duplicate check
const duplicate = findSenderRule(sender, actionDef.ruleAction, rules);
```

## Info

### IN-01: Unused import in test file

**File:** `test/unit/action-folders/processor.test.ts:9`
**Issue:** `ActionResult` type is imported but never used directly in the test file. The test assertions use `expect.objectContaining()` with inline objects rather than typed `ActionResult` values.
**Fix:** Remove the unused import:
```typescript
// Remove this line:
import type { ActionResult } from '../../../src/actions/index.js';
```

---

_Reviewed: 2026-04-20T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
