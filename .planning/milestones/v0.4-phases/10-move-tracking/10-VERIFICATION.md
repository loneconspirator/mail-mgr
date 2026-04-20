---
phase: 10-move-tracking
verified: 2026-04-12T19:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "move_signals table exists after migration with all LEARN-02 columns — runMigrations(this.db) now called in ActivityLog constructor (src/log/index.ts:57)"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "LEARN-03: Statistical analysis on move signals"
    addressed_in: "Phase 11"
    evidence: "Phase 11 goal: 'System analyzes accumulated move signals, identifies repeating patterns, and surfaces them as proposed rules'"
  - truth: "LEARN-04 and LEARN-05: Proposed rules surface and approval in UI"
    addressed_in: "Phase 11"
    evidence: "Phase 11 goal covers approve/modify/dismiss workflow for pattern-detected rules"
  - truth: "UI-02: Proposed rules view in UI"
    addressed_in: "Phase 11"
    evidence: "UI-02 depends on Phase 11 pattern detection output"
---

# Phase 10: Move Tracking Verification Report

**Phase Goal:** System detects when the user manually moves messages out of Inbox or Review and logs structured signal data for pattern analysis
**Verified:** 2026-04-12T19:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plan 04)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System periodically scans Inbox and Review folders and detects messages that disappeared since the last scan | VERIFIED | MoveTracker.runScan() fetches UIDs from INBOX and reviewFolder, diffs against persisted FolderSnapshot in ActivityLog state table. 30s default interval via setInterval. start() fires immediate scan. Tests pass for baseline, disappearance detection, and UIDVALIDITY reset. |
| 2 | Detected moves are cross-referenced against the activity log by Message-ID to exclude system-initiated moves | VERIFIED | ActivityLog.isSystemMove() at src/log/index.ts:190 uses parameterized SQL checking activity table for message_id with source IN ('arrival', 'sweep', 'batch') within last 1 day. Called in handleDisappearedMessage() before adding to pendingConfirmation. |
| 3 | For each confirmed user move, sender, envelope recipient, list headers, subject, read status, visibility, source folder, and destination folder are logged to the move_signals table | VERIFIED | runMigrations(this.db) called in ActivityLog constructor (line 57) ensures move_signals table exists at runtime. SignalStore.logSignal() inserts all 9 LEARN-02 fields via parameterized SQL. MoveTracker.logSignal() populates all fields. Deep-scan resolved messages now also produce signals via pendingDeepScanMeta map (plan 04 CR-02 fix). All 214 tests pass. |
| 4 | Move tracking runs continuously alongside Monitor without interfering with message processing | VERIFIED | MoveTracker uses withMailboxLock() same as Monitor (serialized IMAP access). Separate scan (30s) and deep scan (15min) timers. enabled=false guard. Skips scan when client.state !== 'connected'. No shared state with Monitor. |

**Score:** 4/4 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | LEARN-03: Statistical analysis on move signals | Phase 11 | Phase 11 goal: "System analyzes accumulated move signals, identifies repeating patterns" |
| 2 | LEARN-04, LEARN-05: Proposed rules surface and approval | Phase 11 | Phase 11 goal covers approve/modify/dismiss workflow for pattern-detected rules |
| 3 | UI-02: Proposed rules view in UI | Phase 11 | UI-02 depends on Phase 11 pattern detection output |

Note: REQUIREMENTS.md traceability table (last updated 2026-04-11) incorrectly maps LEARN-03, LEARN-04, LEARN-05, and UI-02 to Phase 10. The roadmap correctly places these in Phase 11. The traceability table should be updated when Phase 11 begins.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tracking/signals.ts` | SignalStore class for move_signals CRUD and pruning | VERIFIED | Exports SignalStore, MoveSignalInput, MoveSignal. All 4 methods present (logSignal, getSignals, getSignalByMessageId, prune). Parameterized SQL only. Default prune=90 days. |
| `src/log/migrations.ts` | Migration for move_signals table | VERIFIED | Version '20260412_001', CREATE TABLE with 11 columns, 3 indexes. runMigrations() idempotent via schema_migrations tracking table. |
| `src/config/schema.ts` | moveTracking config section | VERIFIED | moveTrackingConfigSchema exported. enabled: boolean default true, scanInterval: number default 30. Nested under reviewConfigSchema. MoveTrackingConfig type exported. |
| `src/tracking/index.ts` | MoveTracker class with lifecycle, snapshot diffing, signal creation | VERIFIED | MoveTracker, MoveTrackerDeps, MoveTrackerState exported. start/stop/getState implemented. runScan, runDeepScan, pendingConfirmation, pendingDeepScanMeta, uidValidity handling, signalStore.logSignal, destinationResolver.resolveFast all present. |
| `src/tracking/destinations.ts` | Two-tier destination resolver | VERIFIED | DestinationResolver, DestinationResolverDeps exported. resolveFast, enqueueDeepScan, runDeepScan present. getRecentFolders(10) called. All 9 common folder names present. pendingDeepScan map. Note: uses injected listFolders fn instead of FolderCache class (FolderCache does not exist in codebase — accepted deviation). |
| `src/log/index.ts` | ActivityLog with isSystemMove(), runMigrations call | VERIFIED | isSystemMove(messageId: string): boolean at line 190. runMigrations(this.db) called in constructor at line 57. getDb() accessor present. getRecentFolders() present. |
| `src/web/server.ts` | ServerDeps with getMoveTracker | VERIFIED | getMoveTracker: () => MoveTracker \| undefined in ServerDeps at line 18. MoveTracker type imported. |
| `src/index.ts` | MoveTracker creation, lifecycle, config listeners, .unref() on prune interval | VERIFIED | Imports MoveTracker, SignalStore, DestinationResolver. let imapClient (not const). Creates SignalStore with shared DB. setInterval(...).unref() at line 39. await imapClient.disconnect() in onImapConfigChange at line 55. MoveTracker created at line 102 and rebuilt on config change at line 69. Direct property access on moveTracking (no optional chaining). getMoveTracker getter in buildServer. |
| `test/unit/tracking/signals.test.ts` | Tests for signal storage and pruning | VERIFIED | 9 tests covering logSignal, getSignals ordering, getSignalByMessageId hit/miss, prune age boundary. All pass. |
| `test/unit/log/migrations.test.ts` | Test for move_signals migration | VERIFIED | 4 tests: column verification, index verification, idempotency, version check. All pass. |
| `test/unit/tracking/tracker.test.ts` | Tests for MoveTracker snapshot diffing and lifecycle | VERIFIED | 10 tests (9 original + 1 new deep-scan signal logging test at line 296). Covers baseline, disappeared UIDs, system move exclusion, two-scan confirmation, UIDVALIDITY reset, timer lifecycle, disconnected skip, enabled=false guard, deep-scan end-to-end. All pass. |
| `test/unit/tracking/destinations.test.ts` | Tests for destination resolution | VERIFIED | 9 tests covering fast pass hit in recent folder, fast pass hit in common folder, fast pass null, source folder skip, deep scan found, deep scan not found (dropped). All pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/log/index.ts` | `src/log/migrations.ts` | import and call runMigrations | VERIFIED | import at line 6, runMigrations(this.db) called at line 57 in constructor after this.migrate() |
| `src/tracking/signals.ts` | move_signals table | parameterized SQL queries | VERIFIED | db.prepare used throughout. Table now created at runtime via ActivityLog constructor. |
| `src/tracking/index.ts` | `src/tracking/signals.ts` | signalStore.logSignal() | VERIFIED | logSignal() called in private logSignal() at line 270 (fast pass) and in runDeepScan() at line 244 (deep scan via pendingDeepScanMeta). |
| `src/tracking/index.ts` | `src/log/index.ts` | activityLog.getState/setState | VERIFIED | getState at line 153, setState at line 325. Snapshot key pattern: "tracking:${folder}:snapshot". |
| `src/tracking/index.ts` | `src/tracking/destinations.ts` | destinationResolver.resolveFast() | VERIFIED | resolveFast called at line 224, enqueueDeepScan at line 233. |
| `src/tracking/destinations.ts` | `src/log/index.ts` | activityLog.getRecentFolders() | VERIFIED | getRecentFolders(10) called in resolveFast(). |
| `src/index.ts` | `src/tracking/index.ts` | new MoveTracker(deps) | VERIFIED | Created at line 102, rebuilt in onImapConfigChange at line 69. |
| `src/index.ts` | `src/tracking/signals.ts` | new SignalStore(db) | VERIFIED | Created at line 37 with activityLog.getDb(). |
| `src/web/server.ts` | `src/tracking/index.ts` | getMoveTracker getter | VERIFIED | getMoveTracker: () => moveTracker at line 87 in src/index.ts. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/tracking/signals.ts` | move_signals rows | db.prepare INSERT/SELECT with ? placeholders | Yes — parameterized SQL, correct schema, table created at runtime | FLOWING |
| `src/tracking/index.ts` | pendingConfirmation Map, pendingDeepScanMeta Map | IMAP withMailboxLock fetch, ActivityLog.getState snapshot | Yes — live IMAP UID fetch + persisted JSON snapshot | FLOWING |
| `src/tracking/destinations.ts` | candidate folders | activityLog.getRecentFolders(10) + COMMON_FOLDERS const | Yes — DB query + hardcoded list | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npx vitest run` | 214 tests passed, 16 files | PASS |
| Tracking-specific tests | `npx vitest run test/unit/tracking test/unit/log` | 47 tests passed | PASS |
| TypeScript build | `npm run build` | exits 0, no errors | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LEARN-01 | Plans 02, 03, 04 | UID snapshot diffing with activity log cross-reference | SATISFIED | MoveTracker.scanFolder() diffs UIDs, ActivityLog.isSystemMove() excludes system moves. Two-scan confirmation. UIDVALIDITY handling. 10 tests verified. |
| LEARN-02 | Plans 01, 02, 03, 04 | Log sender, envelope recipient, list headers, subject, read status, visibility, source/destination to move_signals | SATISFIED | All 9 fields captured in MoveSignalInput and populated by MoveTracker. Table schema correct. runMigrations() called in ActivityLog constructor ensures table exists at runtime. Deep-scan path now logs signals via pendingDeepScanMeta (plan 04 CR-02 fix). |
| LEARN-03 | Not in Phase 10 | Statistical analysis on move signals | DEFERRED to Phase 11 | Traceability table maps to Phase 10 but Phase 11 goal explicitly covers this. |
| LEARN-04 | Not in Phase 10 | Surface patterns as proposed rules in UI | DEFERRED to Phase 11 | Same as LEARN-03. |
| LEARN-05 | Not in Phase 10 | Approved proposed rules become real rules | DEFERRED to Phase 11 | Same as LEARN-03. |
| UI-02 | Not in Phase 10 | Proposed rules view in UI | DEFERRED to Phase 11 | Depends on Phase 11 LEARN-03/04 output. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/log/index.ts` | 194 | `source IN ('arrival', 'sweep', 'batch')` — 'batch' source value referenced but logActivity() only accepts 'arrival' \| 'sweep' | Info | isSystemMove() will never exclude batch-initiated moves since no code path writes 'batch'. Forward-compatibility clause with no current effect. |

No blockers found. The previous warning about unmanaged signalPruneInterval is resolved — .unref() is now used and no variable is kept (clean pattern).

### Human Verification Required

None — all automated checks are sufficient for this phase's scope.

### Gaps Summary

No gaps. The single gap from initial verification (move_signals table never created at runtime) was closed by Plan 04:

- `src/log/index.ts` now imports `runMigrations` from `./migrations.js` and calls `runMigrations(this.db)` in the constructor after `this.migrate()`
- Deep-scan resolved messages now log signals via `pendingDeepScanMeta` map (CR-02 fix)
- Old IMAP client disconnected on config reload (WR-01 fix)
- Signal prune interval uses `.unref()` (WR-02 fix)
- All 214 tests pass, build succeeds

---

_Verified: 2026-04-12T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
