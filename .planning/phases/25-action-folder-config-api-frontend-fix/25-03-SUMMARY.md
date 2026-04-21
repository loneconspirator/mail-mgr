---
phase: 25-action-folder-config-api-frontend-fix
plan: 03
subsystem: web/folders, monitor, startup
tags: [bug-fix, delimiter, cold-start, gap-closure]
dependency_graph:
  requires: [25-01, 25-02]
  provides: [delimiter-guard-fix, cold-start-fix]
  affects: [src/web/frontend/app.ts, src/web/routes/folders.ts, src/index.ts, src/monitor/index.ts]
tech_stack:
  added: []
  patterns: [null-coalescing-normalization, shared-client-lifecycle]
key_files:
  created: []
  modified:
    - src/web/frontend/app.ts
    - src/web/routes/folders.ts
    - src/index.ts
    - src/monitor/index.ts
    - test/unit/web/folders-rename.test.ts
decisions:
  - "Delimiter guard checks both '/' and '.' rather than detecting delimiter first — simpler, no false negatives"
  - "monitor.stop() no longer disconnects shared IMAP client — monitor doesn't own the client"
  - "null-to-undefined coercion via ?? operator for envelope header comparison"
metrics:
  duration: 90s
  completed: 2026-04-21T23:35:30Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 25 Plan 03: Gap Closure - Delimiter Guard and Cold Start Crash Summary

Fix two UAT blockers: action folder rename guard bypassed with dot-delimited IMAP paths, and cold start crash from null-vs-undefined envelope header triggering unnecessary monitor rebuild.

## Task Results

| Task | Name | Commits | Status |
|------|------|---------|--------|
| 1 | Fix delimiter-aware action folder guard (frontend + backend) | b1a7c58, d99da8e | Done |
| 2 | Fix cold start crash from null-vs-undefined monitor rebuild | 761a33c | Done |

## Changes Made

### Task 1: Delimiter-aware action folder guard

**Frontend (app.ts line 1668):** Added `|| folderPath.startsWith(actionPrefix + '.')` to the action folder guard so both dot and slash delimiters are blocked.

**Backend (folders.ts line 51):** Changed delimiter fallback from hardcoded `'/'` to `(oldPath.includes('.') ? '.' : '/')` so the action folder guard works when tree node lookup returns null (stale cache).

**Test:** Added test case for dot-delimited action folder path (`Actions.VIP Sender`) with stale cache returning 403.

### Task 2: Cold start crash fix

**index.ts line 274:** Changed `initialHeader !== config.imap.envelopeHeader` to `(initialHeader ?? undefined) !== config.imap.envelopeHeader` so null and undefined are treated as equivalent (both mean "no header").

**monitor/index.ts stop():** Removed `await this.client.disconnect()` — the monitor receives the IMAP client via dependency injection and does not own it. Other consumers (action folder poller, trash resolution) use the same client after monitor.stop().

## Verification

- 11/11 folder rename tests pass (including new dot-delimiter test)
- 6/6 monitor tests pass
- TypeScript compiles clean (npx tsc --noEmit)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Surface

No new threat surface introduced. Both fixes reduce attack surface:
- T-25-03-01: Delimiter fallback now correctly blocks system folder rename attempts via dot-delimited paths
- T-25-03-02: Shared IMAP client no longer disconnected by monitor.stop(), preventing crash-on-start
