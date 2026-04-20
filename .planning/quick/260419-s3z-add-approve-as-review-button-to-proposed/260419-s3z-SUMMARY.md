---
phase: quick-260419-s3z
plan: 01
subsystem: web-frontend, web-routes
tags: [proposals, review-rules, ui]
dependency_graph:
  requires: [conflict-checker, proposed-rules-api]
  provides: [approve-as-review-button]
  affects: [proposal-cards]
tech_stack:
  patterns: [query-param-feature-flag, cloned-handler-with-variant]
key_files:
  modified:
    - src/web/routes/proposed-rules.ts
    - src/web/frontend/api.ts
    - src/web/frontend/app.ts
decisions:
  - Used asReview query param on existing approve endpoint rather than separate endpoint
  - Cloned approve click handler for review variant to keep conflict logic independent
metrics:
  duration: 1min
  completed: 2026-04-19
---

# Quick Task 260419-s3z: Add Approve as Review Button to Proposed Rules Summary

Approve-as-review button on proposal cards using asReview query param on existing approve endpoint, creating review-type rules instead of move-type.

## What Was Done

### Task 1: Backend asReview param + API client methods
- Added `asReview` query param to POST `/api/proposed-rules/:id/approve`
- Both rule creation paths (normal + insertBefore) use ternary to select `review` vs `move` action type
- API client exposes `approveAsReview` and `approveAsReviewInsertBefore` methods

### Task 2: Approve as Review button in proposal card UI
- New `btn-secondary` button positioned between Approve Rule and Modify
- Full click handler with spinner, disable-all, fade-out, toast ("Review rule created and active.")
- Exact conflict: disables both approve buttons, re-enables Modify/Dismiss
- Shadow conflict: disables both approve buttons, shows "Save Ahead (Review)" variant button
- Cross-disabling: approveBtn conflicts disable approveReviewBtn and vice versa

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | 47e8f24 | feat(quick-260419-s3z): add asReview query param to approve endpoint and API client |
| 2 | 2c82696 | feat(quick-260419-s3z): add Approve as Review button to proposal cards |

## Self-Check: PASSED
