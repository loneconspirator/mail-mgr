---
phase: 10-move-tracking
plan: 02
subsystem: tracking
tags: [move-tracking, imap, uid-diffing, destination-resolution]
dependency_graph:
  requires: [10-01]
  provides: [MoveTracker, DestinationResolver, isSystemMove]
  affects: [src/tracking, src/log]
tech_stack:
  added: []
  patterns: [two-scan-confirmation, uid-snapshot-diffing, two-tier-resolution]
key_files:
  created:
    - src/tracking/index.ts
    - src/tracking/destinations.ts
    - test/unit/tracking/tracker.test.ts
    - test/unit/tracking/destinations.test.ts
  modified:
    - src/log/index.ts
decisions:
  - Two-scan confirmation order: check existing pending entries before adding new disappearances to prevent same-scan false confirmation
  - DestinationResolver uses injected listFolders function instead of FolderCache class (not yet in codebase)
  - ActivityLog.getRecentFolders queries last 7 days of successful activity grouped by folder frequency
metrics:
  duration: 334s
  completed: 2026-04-12
  tasks: 2
  files: 5
---

# Phase 10 Plan 02: MoveTracker Core Engine Summary

MoveTracker with UID snapshot diffing, two-scan confirmation, activity log cross-referencing for system move exclusion, and two-tier destination resolution (fast pass on recent/common folders + deep scan on all folders).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DestinationResolver with two-tier detection | 0f57c25 | src/tracking/destinations.ts, test/unit/tracking/destinations.test.ts, src/log/index.ts |
| 2 | MoveTracker class with UID snapshot diffing and lifecycle | 890e109 | src/tracking/index.ts, test/unit/tracking/tracker.test.ts, src/log/index.ts |

## Implementation Details

### DestinationResolver (src/tracking/destinations.ts)
- **resolveFast()**: Checks activityLog.getRecentFolders(10) + 9 hardcoded common folder names (Archive, All Mail, Trash, etc.), deduplicates, skips source folder
- **enqueueDeepScan()**: Adds message to pendingDeepScan map for next deep scan cycle
- **runDeepScan()**: Searches all IMAP folders via listFolders(), skips non-selectable and source folders, drops unresolvable messages per D-06

### MoveTracker (src/tracking/index.ts)
- **Snapshot diffing**: Fetches UIDs + envelopes from INBOX and Review folders, compares against persisted snapshots in ActivityLog state table
- **Two-scan confirmation**: New disappearances added to pendingConfirmation map; only confirmed on next scan when still missing. Reappeared messages are cleaned up.
- **System move exclusion**: isSystemMove() checks activity table for matching message_id with source in (arrival, sweep, batch) within last 24 hours
- **UIDVALIDITY handling**: Changed uidValidity causes snapshot re-baseline without generating false signals
- **Lifecycle**: start() fires immediate scan + sets 30s interval timer + 15-minute deep scan timer. stop() clears all timers. Skips scan when client not connected.

### ActivityLog additions (src/log/index.ts)
- **getRecentFolders(limit)**: Returns top destination folders from last 7 days of successful activity, ordered by frequency
- **isSystemMove(messageId)**: Parameterized SQL query (T-10-04 mitigation) checking activity table for system-initiated moves within 1 day

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted DestinationResolver to use injected listFolders function**
- **Found during:** Task 1
- **Issue:** Plan referenced FolderCache class and folderCache.listFolders() but neither exists in the codebase
- **Fix:** Changed DestinationResolverDeps to accept a `listFolders: () => Promise<FolderInfo[]>` function instead of a FolderCache instance
- **Files modified:** src/tracking/destinations.ts

**2. [Rule 1 - Bug] Fixed two-scan confirmation order to prevent same-scan false confirmation**
- **Found during:** Task 2 testing
- **Issue:** Processing new disappearances before checking pending entries caused messages to be immediately confirmed in the same scan they first disappeared
- **Fix:** Reordered scanFolder logic to check existing pendingConfirmation entries first, then add newly disappeared messages
- **Files modified:** src/tracking/index.ts

## Verification

- `npx vitest run test/unit/tracking` -- 27 tests pass (9 destinations + 9 tracker + 9 signals)
- `npm run build` -- succeeds

## Self-Check: PASSED
