---
phase: quick
plan: 260419-l2l
subsystem: rules/proposals
tags: [order, proposals, frontend, backend]
key-files:
  created: []
  modified:
    - src/config/repository.ts
    - src/web/routes/proposed-rules.ts
    - src/web/frontend/app.ts
decisions:
  - "Used api.rules.list() in frontend to compute next order dynamically rather than adding a dedicated API endpoint"
metrics:
  duration: 1min
  completed: "2026-04-19"
  tasks: 2
  files: 3
---

# Quick Task 260419-l2l: Assign Next Order When Approving Proposals

Added nextOrder() helper to ConfigRepository and wired it into approve endpoint and frontend rule creation so new rules always sort to the bottom.

## What Changed

### Task 1: Backend nextOrder() helper and approve endpoint fix
- Added `nextOrder()` method to `ConfigRepository` that computes `Math.max(...rules.map(r => r.order)) + 1`, returning `0` when no rules exist
- Updated the `/api/proposed-rules/:id/approve` endpoint to use `deps.configRepo.nextOrder()` instead of hardcoded `order: 0`
- Commit: `5d01144`

### Task 2: Frontend rule creation order defaults
- Modified `openRuleModal` save handler to fetch existing rules and compute next order for new rules
- Edit mode preserves the rule's existing order value unchanged
- The Modify flow (which creates a new rule with `forceCreate=true`) also benefits since `isEdit` is `false`
- Commit: `13a64ec`

## Deviations from Plan

### Minor Scope Adjustment
The plan mentioned an "approve-as-review" endpoint, but no such endpoint exists in the current codebase. There is only one `approve` endpoint in `proposed-rules.ts`. The "approve as review button" is listed as a separate pending TODO. No deviation needed -- the single approve endpoint was the only one requiring the fix.

## Known Stubs

None.

## Self-Check: PASSED
