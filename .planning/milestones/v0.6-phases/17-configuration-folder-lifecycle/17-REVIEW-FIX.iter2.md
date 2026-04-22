---
phase: 17-configuration-folder-lifecycle
fixed_at: 2026-04-20T00:00:00Z
review_path: .planning/phases/17-configuration-folder-lifecycle/17-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-04-20T00:00:00Z
**Source review:** .planning/phases/17-configuration-folder-lifecycle/17-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Orphaned monitor instance when envelope header differs on startup

**Files modified:** `src/index.ts`
**Commit:** 0e64fd3
**Applied fix:** Added `await monitor.stop()` before reassigning the monitor variable when rebuilding due to envelope header change. This ensures defensive cleanup of the old instance, consistent with the reconnect handler pattern elsewhere in the file.

### WR-02: Hardcoded `/` separator in `folderExists` path construction

**Files modified:** `src/action-folders/folders.ts`
**Commit:** 47d7605
**Applied fix:** Added documentation comment above the path construction line explaining the hardcoded `/` delimiter assumption, noting it matches Gmail/most providers and describing the behavior on servers using alternative delimiters.

### WR-03: `status()` return values accessed without null guards

**Files modified:** `src/imap/client.ts`
**Commit:** d47c4f8
**Applied fix:** Added nullish coalescing (`?? 0`) to both `result.messages` and `result.unseen` in the `status()` method return, ensuring callers always receive numeric values even if the IMAP server omits fields from the STATUS response.

---

_Fixed: 2026-04-20T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
