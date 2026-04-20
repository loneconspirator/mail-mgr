---
phase: 16-inline-sender-management
plan: 01
subsystem: web-frontend
tags: [disposition-views, sender-management, modal, folder-picker]
dependency_graph:
  requires: [phase-14-navigation, phase-15-folder-grouped-views]
  provides: [inline-add-sender, inline-remove-sender, inline-edit-rule]
  affects: [src/web/frontend/app.ts, src/web/frontend/styles.css]
tech_stack:
  added: []
  patterns: [openAddSenderModal-pattern, disposition-actions-column]
key_files:
  created: []
  modified:
    - src/web/frontend/app.ts
    - src/web/frontend/styles.css
decisions:
  - Used browser confirm() for remove confirmation (consistent with existing delete pattern)
  - openRuleModal save handler changed to navigate(currentPage) for universal view refresh
  - Add Sender modal computes order by fetching all rules and appending to end
metrics:
  duration: 235s
  completed: 2026-04-20T07:06:37Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 16 Plan 01: Inline Sender Management Summary

Add/Remove/Edit sender actions on all four disposition views with modal-based Add Sender flow and folder picker for Archived view.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c1e799b | Add Actions column with Edit Rule and Remove buttons to all disposition views |
| 2 | dde9e65 | Add openAddSenderModal with folder picker and Add Sender buttons to all views |

## What Was Built

### Task 1: Actions Column, Remove, Edit Rule

- Added `.disposition-edit-link`, `.disposition-actions`, and `.empty .btn` CSS classes to styles.css
- Added Actions column header (`<th>Actions</th>`) to both `renderDispositionView` and `renderFolderGroupedView` tables
- Each sender row now has an "Edit Rule" button (styled as text link) and a "Remove" button (danger style)
- Edit Rule fetches envelope status then opens `openRuleModal(rule, envelopeAvailable)`
- Remove shows `confirm()` dialog, deletes rule via `api.rules.delete()`, shows toast, refreshes view
- Updated `renderFolderGroupedView` signature to accept `reRender` and `viewType` parameters
- Changed `openRuleModal` save handler from `renderRules()` to `navigate(currentPage)` for universal view refresh

### Task 2: Add Sender Modal and CTA Buttons

- Created `openAddSenderModal(viewType, viewName, reRender)` function with view-specific titles
- Modal includes sender pattern input with `*@example.com` placeholder
- For Archived (move) view: folder picker rendered via `renderFolderPicker()`, submit disabled until both sender and folder filled
- Submit creates sender-only rule via `api.rules.create()` with correct action type per view
- Order computation fetches existing rules and appends new rule to end
- Added "+ Add Sender" button to toolbar in all four disposition views
- Added view-specific CTA buttons in empty states (e.g., "+ Add Priority Sender")

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed void ?? fallthrough in reRender callback**
- **Found during:** Task 1
- **Issue:** `reRender?.() ?? navigate(currentPage)` would always execute both sides because `reRender()` returns `void` (undefined), and `??` treats undefined as nullish
- **Fix:** Changed to `if (reRender) { reRender(); } else { navigate(currentPage); }`
- **Files modified:** src/web/frontend/app.ts
- **Commit:** c1e799b

## Verification

- TypeScript compilation passes with zero errors after both tasks
- All four MGMT requirements (01-04) implemented
- Threat mitigations verified: DOM textContent rendering (T-16-04), submit disabled during async (T-16-05), backend Zod validation (T-16-02)

## Self-Check: PASSED
