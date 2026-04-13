# Phase 10: Move Tracking - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

System detects when the user manually moves messages out of Inbox or Review and logs structured signal data for pattern analysis. This phase delivers the detection engine and signal storage only — pattern analysis (Phase 11) is separate.

</domain>

<decisions>
## Implementation Decisions

### Scan Timing & Frequency
- **D-01:** MoveTracker runs its own independent setInterval loop, decoupled from Monitor's IDLE/poll cycle. No dependency on Monitor's connection state or message processing activity.
- **D-02:** Default scan interval is 30 seconds. Near-real-time detection of user moves.
- **D-03:** Scan interval is configurable via review config YAML (e.g., `moveTracking.scanInterval`). Exposed alongside other sweep settings.

### Destination Detection
- **D-04:** Two-tier destination resolution. Immediate fast pass scans "usual suspects" — recent folders from the activity log (top 10 by frequency) plus hardcoded common names (Archive, All Mail, Trash, Deleted Items, Junk, Spam). Covers ~80% of moves instantly.
- **D-05:** Messages not found in the fast pass are enqueued for a deep background scan that runs every 15 minutes. Deep scan searches all IMAP folders by Message-ID.
- **D-06:** If the deep scan also fails to locate the message, the signal is dropped entirely. No incomplete data in the move_signals table.

### Signal Data
- **D-07:** move_signals table stores exactly what LEARN-02 specifies: sender, envelope recipient, List-Id header, subject, read status, visibility, source folder, destination folder. Plus timestamp and message_id for dedup/cross-referencing.
- **D-08:** Signal retention is 90 days with auto-pruning (longer than the 30-day activity log, giving Phase 11 pattern analysis a wider data window).

### Lifecycle & Wiring
- **D-09:** MoveTracker is a standalone class at `src/tracking/index.ts`. Follows the ReviewSweeper pattern — independent lifecycle with start()/stop(), injected deps, exposed to server via ServerDeps (`getMoveTracker()`).
- **D-10:** Move tracking is on by default. No opt-in required. Can be disabled via config if needed.
- **D-11:** MoveTracker shares the same ImapClient instance as Monitor and ReviewSweeper. Uses `withMailboxLock()` for serialized folder access — proven pattern, no concurrent connection issues.

### Claude's Discretion
- UID snapshot storage mechanism (state table keys, data structure)
- Message-ID cross-referencing query against activity log (SQL approach)
- Deep scan queue implementation (in-memory array vs SQLite pending table)
- How to detect "common" folder names across different IMAP providers (case-insensitive matching, aliases)
- Error handling for IMAP failures during scan (skip cycle, retry, backoff)
- Whether to expose move tracker status via a web API endpoint (for future UI)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — LEARN-01 (UID snapshot diffing, activity log cross-reference), LEARN-02 (signal fields and move_signals table)

### Upstream Phase Context
- `.planning/phases/06-extended-message-data/06-CONTEXT.md` — D-07/D-08 define visibility classification, D-09/D-10 define versioned migration system (reuse for move_signals table)

### Existing Code
- `src/imap/client.ts` — ImapClient with `withMailboxLock()`, `fetchAllMessages()`, `listFolders()` — integration points for folder scanning
- `src/imap/messages.ts` — EmailMessage and ReviewMessage types, `parseMessage()`, `classifyVisibility()` — message data extraction
- `src/log/index.ts` — ActivityLog with `message_id` column for cross-referencing system moves, `getState()`/`setState()` for persistent snapshots, `getRecentFolders()` for fast-pass candidate list
- `src/log/migrations.ts` — `runMigrations()` for versioned schema changes — use for move_signals table creation
- `src/sweep/index.ts` — ReviewSweeper pattern to follow for standalone lifecycle class
- `src/index.ts` — Main entry wiring pattern for new components (creation, config listeners, server deps)
- `src/web/server.ts` — ServerDeps interface to extend with `getMoveTracker()`
- `src/config/schema.ts` — reviewConfigSchema to extend with moveTracking settings

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ActivityLog.getRecentFolders()` — returns distinct successful move destinations, directly usable for fast-pass candidate list
- `ActivityLog.getState()`/`setState()` — key-value store for persisting UID snapshots between scans
- `runMigrations()` in migrations.ts — versioned migration system for creating move_signals table
- `withMailboxLock()` — serialized IMAP folder access, prevents conflicts with Monitor
- `FolderCache.listFolders()` — cached folder tree for deep scan without repeated IMAP LIST commands

### Established Patterns
- ReviewSweeper: standalone class with start()/stop(), own timer, injected ImapClient and ActivityLog — MoveTracker follows identical pattern
- ServerDeps expansion: Phase 9 already added getSweeper/getFolderCache/getBatchEngine — adding getMoveTracker is the same pattern
- Config hot-reload: onReviewConfigChange listener rebuilds sweeper — same pattern for MoveTracker when scan interval changes

### Integration Points
- `src/index.ts` main() — create MoveTracker, wire config change listeners, pass to buildServer
- ServerDeps — add getMoveTracker() for potential future API routes
- Config schema — extend reviewConfigSchema with moveTracking section (enabled, scanInterval)
- ActivityLog — cross-reference query by message_id to filter system-initiated moves

</code_context>

<specifics>
## Specific Ideas

- Two-tier destination detection was the user's idea — fast pass for common destinations, lazy deep scan for the rest. This is the core architectural decision for this phase.
- Signals with unresolvable destinations are dropped, not stored with null — user wants clean data only
- 30-second scan interval chosen for near-real-time detection despite the overhead — user prioritizes signal freshness
- 90-day retention gives Phase 11 a wider analysis window than the 30-day activity log

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-move-tracking*
*Context gathered: 2026-04-12*
