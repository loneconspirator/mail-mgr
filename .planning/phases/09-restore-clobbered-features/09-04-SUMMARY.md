---
phase: 09-restore-clobbered-features
plan: 04
subsystem: frontend
tags: [restore, frontend, merge, batch-ui, folder-picker, review-status]
dependency_graph:
  requires: [shared-types, imap-envelope, config-review-crud, folder-cache, recent-folders-api, sweep-engine, batch-engine]
  provides: [frontend-api-client, folder-picker-component, batch-page, review-status-card, sweep-settings-card, activity-badges]
  affects: [web-frontend]
tech_stack:
  added: []
  patterns: [additive-merge, pre-clobber-restoration, xss-prevention]
key_files:
  created:
    - src/web/frontend/folder-picker.ts
    - test/unit/web/folder-picker.test.ts
  modified:
    - src/web/frontend/api.ts
    - src/web/frontend/app.ts
    - src/web/frontend/styles.css
    - src/web/frontend/index.html
decisions: []
metrics:
  duration: 5m
  completed: 2026-04-12
  tasks: 2
  files: 6
---

# Phase 09 Plan 04: Restore Frontend Summary

Restored all v0.3 frontend features (batch page, review status card, sweep settings, activity source badges, folder picker component, full API client) merged alongside all Phase 8 additions (rule editor with deliveredTo/visibility/readStatus, esc() XSS helper, envelope discovery settings, generateBehaviorDescription).

## What Changed

### Task 1: Restore frontend API client and folder picker component
- **src/web/frontend/api.ts**: Merged to include review, folders, batch namespaces plus recentFolders, getReview/updateReview, getCursor/setCursor methods alongside Phase 8 getEnvelopeStatus/triggerDiscovery and ImapConfigResponse type (65 lines)
- **src/web/frontend/folder-picker.ts**: Restored entire tree-based folder picker component with TTL cache, recent folders section, expand/collapse, retry on error (198 lines)
- **test/unit/web/folder-picker.test.ts**: Restored full test suite with 11 tests covering tree rendering, recent folders, selection, expand/collapse, error state, ancestor auto-expansion (214 lines)
- Commit: `7664617`

### Task 2: Merge app.ts with restored features and update styles/HTML
- **src/web/frontend/app.ts**: Complex merge preserving Phase 8 rule editor (deliveredTo, visibility, readStatus, envelope status check, esc() XSS escaping, generateBehaviorDescription) while adding back batch page (idle/dry-run/preview/executing/results states with polling), review status card, sweep settings card with folder pickers, activity source badges (sweep/batch), folder picker integration in rule editor modal, batch navigation routing (880 lines)
- **src/web/frontend/styles.css**: Additive merge keeping Phase 8 discovery/disabled-field/spinner styles, adding back review-stats, sweep-info, badge-sweep/badge-batch, folder-picker tree styles, batch UI (progress bar, dry-run groups, loading pulse), button disabled state, rule display styles (474 lines)
- **src/web/frontend/index.html**: Added batch nav button to navigation bar
- Commit: `2518a8c`

## Deviations from Plan

None - plan executed exactly as written.

## Threat Mitigation

T-09-05 (XSS in DOM rendering): Phase 8's `esc()` function preserved and applied to all innerHTML templates in the restored review status card (folder name, sweep dates) and IMAP settings (host, port, user, pass, connection status, envelope header). Batch UI uses textContent assignment for user-provided data (folder names, message subjects) which is inherently safe.

## Verification Results

- `npm run build` exits 0
- `npx vitest run test/unit/web/folder-picker.test.ts` passes (11 tests)
- app.ts contains: renderBatch (17 occurrences), esc() (15), generateBehaviorDescription (2), deliveredTo (3), renderFolderPicker (6)
- styles.css contains: batch (3), folder-picker (6), discovery (3)
- index.html contains batch nav button

## Self-Check: PASSED

All 6 files exist, both commits found (7664617, 2518a8c), all content patterns verified.
