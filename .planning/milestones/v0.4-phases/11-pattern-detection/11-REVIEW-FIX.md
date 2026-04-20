---
phase: 11-pattern-detection
fixed_at: 2026-04-13T00:00:00Z
review_path: .planning/phases/11-pattern-detection/11-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-04-13T00:00:00Z
**Source review:** .planning/phases/11-pattern-detection/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Dominant-destination tie-break is non-deterministic

**Files modified:** `src/tracking/proposals.ts`
**Commit:** 1e98f1a
**Applied fix:** Changed `dominantDest` initialization from the incoming `destination` to the existing row's `destination_folder`, so the incumbent destination is preserved on ties instead of non-deterministically flipping.

### WR-02: `getSignalByMessageId` may return the wrong signal after a message is re-delivered

**Files modified:** `src/tracking/signals.ts`, `src/tracking/index.ts`
**Commit:** 9ef7e7a
**Applied fix:** Added `getSignalById(id)` method to `SignalStore` that queries by primary key. Updated `MoveTracker.logSignal` to capture the row id returned by `signalStore.logSignal()` and use `getSignalById(insertedId)` instead of `getSignalByMessageId(input.messageId)`, ensuring the just-inserted signal is always retrieved.

### WR-03: `makeDeps` in `frontend.test.ts` does not provide `getProposalStore`, causing a runtime crash in tests that exercise proposal routes

**Files modified:** `test/unit/web/frontend.test.ts`
**Commit:** 4769a45
**Applied fix:** Added all missing `ServerDeps` getter stubs to `makeDeps`: `getSweeper` (returns undefined), `getFolderCache` and `getBatchEngine` (throw descriptive errors if called), `getMoveTracker` (returns undefined), and `getProposalStore` (returns a real `ProposalStore` backed by an in-memory DB with migrations applied).

---

_Fixed: 2026-04-13T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
