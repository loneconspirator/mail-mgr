---
phase: 08-extended-matchers-ui
fixed_at: 2026-04-12T19:30:00Z
review_path: .planning/phases/08-extended-matchers-ui/08-REVIEW.md
iteration: 2
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-04-12T19:30:00Z
**Source review:** .planning/phases/08-extended-matchers-ui/08-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Discovery Fetch Uses UID Mode With Sequence-Number Range

**Files modified:** `src/imap/discovery.ts`
**Commit:** 14d7231
**Applied fix:** Removed the third argument `{ uid: true }` from `flow.fetch()` so the sequence-number range (`start:*`) is correctly interpreted as sequence numbers rather than UIDs. The `uid: true` in the fetch items (second argument) is retained to request UID in results.

### WR-01: IMAP Client Connection Leak on Discovery Failure

**Files modified:** `src/web/routes/envelope.ts`
**Commit:** 8ab9e0a
**Applied fix:** Wrapped the `probeEnvelopeHeaders` call and config update in a try/finally block so `client.disconnect()` is always called, even if probing throws. The disconnect uses `.catch(() => {})` for best-effort cleanup. The outer try/catch for error response handling remains intact.

### WR-02: Activity Page Auto-Refresh Creates Accumulating Intervals

**Files modified:** `src/web/frontend/app.ts`
**Commit:** 292c12c
**Applied fix:** Added `clearInterval(activityTimer)` guard before creating a new interval in `renderActivity()`. This prevents interval accumulation when the auto-refresh callback re-invokes `renderActivity()`.

### IN-01: Rule Editor Missing Recipient Field

**Files modified:** `src/web/frontend/app.ts`
**Commit:** f2e1b17
**Applied fix:** Added a "Match Recipient" input field to the rule editor modal (between Subject and Delivered-To), added the DOM read for the recipient value in the save handler, and included `recipient` in the match object construction. This ensures rules with a `recipient` match condition can be created and edited through the UI without losing the field.

---

_Fixed: 2026-04-12T19:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
