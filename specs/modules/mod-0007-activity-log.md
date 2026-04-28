---
id: MOD-0007
title: ActivityLog
interface-schema: src/log/index.ts
unit-test-path: test/unit/log/
integrations: [IX-002, IX-003, IX-006, IX-008]
invariants-enforced: []
architecture-section: architecture.md#configuration--state
---

## Responsibility

SQLite-backed persistence for all system actions and key-value state. Records every message processing outcome (arrivals, sweeps, batches, action-folder operations). Provides query access for activity history, system move detection, and recent folder lookups. Manages the lastUid cursor and sweep state. Auto-prunes old entries.

## Interface Summary

- `logActivity(result, message, rule, source)` — Record a processing outcome with message metadata, matched rule, action, destination, and success/error.
- `logSentinelEvent(event)` — Record sentinel-specific operations.
- `getRecentActivity(limit?, offset?)` — Paginated query of recent activity entries.
- `getRecentFolders(limit)` — List recently used destination folders.
- `isSystemMove(messageId)` — Check if a message was moved by the system (used by MoveTracker to exclude system moves).
- `getState(key)` / `setState(key, value)` — Persistent key-value store for lastUid, cursorEnabled, sweep state.
- `prune(days?)` — Remove entries older than the specified number of days (default 30).
- `purgeByAction(action, source?)` — Remove entries by action type and optional source.
- `startAutoPrune()` / `stopAutoPrune()` — Manage the daily auto-prune timer.
- `close()` — Close the database connection.

## Dependencies

- better-sqlite3 (external) — SQLite database driver.

## Notes

- Uses WAL mode for concurrent read/write access.
- Schema migrations are tracked in a `schema_migrations` table and run automatically on construction.
- The `source` field on activity entries distinguishes arrival, sweep, batch, action-folder, and sentinel operations.
- `isSystemMove` is critical for MoveTracker — without it, the system would detect its own moves as user moves and create spurious proposals.
