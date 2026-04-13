# Quick Task 260412-sob: Add deep scan trigger button

## Commits

- `f1c5122` feat(quick-260412-sob): expose triggerDeepScan on MoveTracker and add tracking API routes
- `423479a` feat(quick-260412-sob): add Move Tracking card with deep scan button to Settings page

## Changes

### Task 1: Backend — Expose deep scan API

- **src/tracking/index.ts** — Added public `triggerDeepScan()` method that delegates to private `runDeepScan()`, returning resolved count
- **src/shared/types.ts** — Added `MoveTrackerStatusResponse` and `DeepScanResponse` interfaces
- **src/web/routes/status.ts** — Added `GET /api/tracking/status` and `POST /api/tracking/deep-scan` routes

### Task 2: Frontend — Move Tracking card with deep scan button

- **src/web/frontend/api.ts** — Added `api.tracking.status()` and `api.tracking.triggerDeepScan()` methods
- **src/web/frontend/app.ts** — Added Move Tracking card on Settings page with stats (tracked/signals/pending), last scan timestamp, and a deep scan button with spinner + toast feedback

## Duration

~4min
