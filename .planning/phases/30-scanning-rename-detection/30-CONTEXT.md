# Phase 30: Scanning & Rename Detection - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Periodic sentinel scanning: verify that each planted sentinel is still in its expected folder, and when it's not, search all IMAP folders to determine whether the folder was renamed or the sentinel was deleted. This phase produces scan results (found-in-place, found-elsewhere, not-found) — it does NOT act on them. Phase 31 consumes these results for auto-healing and failure handling.

</domain>

<decisions>
## Implementation Decisions

### Scan Result Types
- **D-01:** Three scan outcomes per sentinel: `found-in-place` (healthy), `found-in-different-folder` (rename detected — includes new folder path), `not-found` (sentinel missing from all folders)
- **D-02:** Scanner returns a complete scan report — array of per-sentinel results — so Phase 31's auto-healing logic can process them in bulk
- **D-03:** Detection only — the scanner does not update the SentinelStore or config. Phase 31 owns all healing/notification actions.

### Deep Scan Strategy
- **D-04:** Two-tier scan per sentinel: fast path checks expected folder via `findSentinel(client, expectedFolder, messageId)`, deep scan only triggers on miss
- **D-05:** Deep scan iterates all folders from IMAP namespace (via folder listing), calling `findSentinel()` on each folder until the sentinel is found or all folders are exhausted
- **D-06:** Short-circuit on first match — once found in any folder, stop searching remaining folders
- **D-07:** Results returned immediately to caller, no caching — scan runs periodically so stale cache is unnecessary

### Timer Architecture
- **D-08:** Standalone `SentinelScanner` class following the `MoveTracker` pattern: `start()`, `stop()`, `getState()`, with `running` guard against concurrent scans
- **D-09:** `start()` fires an initial scan immediately (fire-and-forget), then sets up `setInterval` for periodic runs
- **D-10:** Configurable scan interval with 5-minute default (SCAN-03). Config field alongside existing poll/sweep intervals.
- **D-11:** Transient IMAP errors (NoConnection, ETIMEOUT) caught at scan level, logged at debug, retried next interval — same pattern as MoveTracker

### Concurrency & Independence
- **D-12:** Independent timer, no explicit coordination with INBOX monitor or other timers (SCAN-04). IMAP connection serialization handled by `ImapClient.withMailboxLock()`
- **D-13:** Scanner respects the `sentinelEnabled` runtime flag from Phase 28 D-10 — if self-test failed, `start()` is a no-op

### Module Structure
- **D-14:** New file `src/sentinel/scanner.ts` — keeps scanning logic within the sentinel module alongside format, store, imap-ops, and lifecycle
- **D-15:** Exports added to `src/sentinel/index.ts` barrel

### Claude's Discretion
- Internal type names for scan results (e.g., `ScanResult`, `ScanReport`)
- Whether to expose a `runScanForTest()` method (MoveTracker does this)
- How to list all IMAP folders (client method reuse vs. new helper)
- Error handling granularity for individual folder search failures within deep scan
- Test file organization

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SCAN-01 (periodic check by Message-ID), SCAN-02 (deep scan on miss), SCAN-03 (independent configurable timer), SCAN-04 (non-blocking)

### Sentinel Infrastructure (Phases 26-29)
- `src/sentinel/imap-ops.ts` — `findSentinel()` (IMAP SEARCH by header), `appendSentinel()`, `deleteSentinel()`
- `src/sentinel/store.ts` — `SentinelStore` class with `getAll()`, `getByMessageId()`, `updateFolderPath()`
- `src/sentinel/lifecycle.ts` — `collectTrackedFolders()`, `reconcileSentinels()` (planting/cleanup — NOT scanning)
- `src/sentinel/detect.ts` — `isSentinel()` utility
- `src/sentinel/index.ts` — Barrel exports to extend

### Timer Pattern Reference
- `src/tracking/index.ts` — `MoveTracker` class: start/stop/getState pattern, setInterval with fire-and-forget initial scan, `running` guard, transient error handling (lines 53-158)

### IMAP Client
- `src/imap/index.ts` — `ImapClient` with `withMailboxLock()`, `searchByHeader()`, folder listing methods

### Application Wiring
- `src/index.ts` — Main startup sequence where scanner will be instantiated and started (after sentinel self-test)
- `src/config/schema.ts` — Config schema where scan interval config field will be added

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `findSentinel(client, folder, messageId)` — Core IMAP search primitive, ready to use for both fast-path and deep scan
- `SentinelStore.getAll()` — Returns all sentinel records for scan iteration
- `MoveTracker` class — Complete timer pattern template (start/stop/getState, running guard, error handling)
- `ImapClient.withMailboxLock()` — Connection serialization for concurrent access safety

### Established Patterns
- Timer-based periodic workers: `MoveTracker` (tracking), `ReviewSweeper` (sweep), `ActionFolderPoller` (action folders) — all follow start/stop/interval pattern
- Transient IMAP error handling: catch NoConnection/ETIMEOUT at scan level, log debug, retry next interval
- Config-driven intervals: sweep and poll intervals are in config schema, sentinel scan interval follows same pattern
- Fire-and-forget initial execution on `start()` before interval kicks in

### Integration Points
- `src/index.ts` main() — Scanner instantiation after self-test, `start()` after monitor starts, `stop()` in shutdown
- `src/sentinel/index.ts` — New exports for SentinelScanner
- Config schema — New `sentinel.scanIntervalMs` (or similar) field
- Status API — Scanner state can be exposed alongside MoveTracker state

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 30-scanning-rename-detection*
*Context gathered: 2026-04-22*
