---
phase: quick-260420-dsq
plan: 01
subsystem: frontend
tags: [ui, rename, display-label]
dependency_graph:
  requires: []
  provides: [user-facing-skip-renamed]
  affects: [src/web/frontend/app.ts]
tech_stack:
  added: []
  patterns: [actionLabel-display-helper]
key_files:
  modified:
    - src/web/frontend/app.ts
decisions:
  - Added actionLabel() helper for centralized action type display mapping
  - Activity log skip case left unchanged since it already shows descriptive "-- Inbox" label
metrics:
  duration: "~3 minutes"
  completed: "2026-04-20"
  tasks_completed: 1
  tasks_total: 1
---

# Quick Task 260420-dsq: Rename Skip Rule Display to Leave in Place Summary

Display-only rename of all user-facing "Skip" action labels to "Leave in Place" via centralized actionLabel() helper, preserving all internal `value="skip"` and type references.

## Changes Made

### Task 1: Rename all user-facing "Skip" labels to "Leave in Place"
**Commit:** 7422b67

1. **actionLabel() helper** (line 33-36): New function maps `'skip'` to `'Leave in Place'` and capitalizes other action types for consistent display.

2. **Rules list action display** (line 113): Applied `actionLabel()` to `rule.action.type` in both the folder-path and standalone action renderings.

3. **Rule edit modal dropdown** (line 203): Changed `>Skip</option>` to `>Leave in Place</option>` while keeping `value="skip"` intact.

4. **Empty priority senders text** (line 446): Updated body text from referencing "skip" and "Skip" to "Leave in Place".

5. **Batch progress counters** (lines 1217, 1245): Changed `'Skipped: '` to `'Left in Place: '`.

6. **Batch results stat label** (line 1287): Changed `'SKIPPED'` to `'LEFT IN PLACE'`.

7. **Conflict checker fallback names** (lines 1435, 1501): Applied `actionLabel()` to `conflict.rule.action.type` fallback display.

8. **Activity log** (line 731): Left `case 'skip': actionDisplay = '-- Inbox'` unchanged per plan -- already shows a descriptive destination label.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- TypeScript compiles cleanly (`npx tsc --noEmit` passes)
- Zero user-facing "Skip"/"Skipped"/"SKIPPED" display labels in app.ts
- "Leave in Place" confirmed in dropdown, rules list helper, batch stats, empty state text
- All `value="skip"`, `type: 'skip'`, and `=== 'skip'` internal references preserved

## Self-Check: PASSED
