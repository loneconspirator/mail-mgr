---
phase: 10-move-tracking
verified: 2026-04-12T18:24:00Z
status: gaps_found
score: 3/4 must-haves verified
overrides_applied: 0
gaps:
  - truth: "move_signals table exists after migration with all LEARN-02 columns"
    status: failed
    reason: "runMigrations() is defined in src/log/migrations.ts and tested, but is never called at runtime. ActivityLog.constructor calls this.migrate() which only runs the inline ALTER TABLE for the 'source' column. The move_signals table will not exist when SignalStore attempts INSERT/SELECT operations."
    artifacts:
      - path: "src/log/index.ts"
        issue: "ActivityLog constructor calls this.migrate() but never imports or calls runMigrations(). The move_signals table is never created at runtime."
      - path: "src/log/migrations.ts"
        issue: "runMigrations() is exported and fully implemented but has zero import sites in src/. Dead code at runtime."
    missing:
      - "ActivityLog constructor (or ActivityLog.fromDataPath) must call runMigrations(this.db) after the inline this.migrate() call"
      - "Add import of runMigrations at top of src/log/index.ts: import { runMigrations } from './migrations.js'"
deferred:
  - truth: "LEARN-03 (statistical analysis on move signals) addressed in Phase 10"
    addressed_in: "Phase 11"
    evidence: "Phase 11 goal: 'System analyzes accumulated move signals, identifies repeating patterns, and surfaces them as proposed rules' directly covers LEARN-03, LEARN-04, LEARN-05"
  - truth: "LEARN-04 (surface detected patterns as proposed rules in UI) addressed in Phase 10"
    addressed_in: "Phase 11"
    evidence: "Phase 11 goal covers proposed rules UI with approve/modify/dismiss controls per LEARN-04, LEARN-05"
  - truth: "UI-02 (proposed rules view) addressed in Phase 10"
    addressed_in: "Phase 11"
    evidence: "UI-02 requires proposed rules view which is part of Phase 11 pattern detection work"
---

# Phase 10: Move Tracking Verification Report

**Phase Goal:** System detects when the user manually moves messages out of Inbox or Review and logs structured signal data for pattern analysis
**Verified:** 2026-04-12T18:24:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System periodically scans Inbox and Review folders and detects messages that disappeared since the last scan | VERIFIED | MoveTracker.runScan() fetches UIDs from INBOX and reviewFolder, diffs against persisted FolderSnapshot in ActivityLog state table. 30s default interval via setInterval. Tests pass for baseline, disappearance detection, and UIDVALIDITY reset. |
| 2 | Detected moves are cross-referenced against the activity log by Message-ID to exclude system-initiated moves (Monitor, Sweep, Batch) | VERIFIED | ActivityLog.isSystemMove() at src/log/index.ts:188 uses parameterized SQL query checking activity table for message_id with source IN ('arrival', 'sweep', 'batch') within last 1 day. Called in handleDisappearedMessage() before adding to pendingConfirmation. |
| 3 | For each confirmed user move, sender, envelope recipient, list headers, subject, read status, visibility, source folder, and destination folder are logged to the move_signals table | FAILED | SignalStore.logSignal() correctly inserts all 9 LEARN-02 fields. MoveTracker.logSignal() populates all fields. BUT runMigrations() is never called at runtime so the move_signals table does not exist — every INSERT will throw "no such table: move_signals". |
| 4 | Move tracking runs continuously alongside Monitor without interfering with message processing | VERIFIED | MoveTracker uses withMailboxLock() same as Monitor (serialized IMAP access). Separate scan (30s) and deep scan (15min) timers. enabled=false guard. Skips scan when client.state !== 'connected'. No shared state with Monitor. |

**Score:** 3/4 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | LEARN-03: Statistical analysis on move signals | Phase 11 | Phase 11 goal: "System analyzes accumulated move signals, identifies repeating patterns" |
| 2 | LEARN-04, LEARN-05: Proposed rules surface/approval | Phase 11 | Phase 11 goal covers approve/modify/dismiss workflow for pattern-detected rules |
| 3 | UI-02: Proposed rules view in UI | Phase 11 | UI-02 depends on Phase 11 pattern detection output |

Note: REQUIREMENTS.md traceability table (last updated 2026-04-11) incorrectly maps LEARN-03, LEARN-04, LEARN-05, and UI-02 to Phase 10. The roadmap correctly places these in Phase 11. The traceability table should be updated.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tracking/signals.ts` | SignalStore class for move_signals CRUD and pruning | VERIFIED | Exports SignalStore, MoveSignalInput, MoveSignal. All 4 methods present (logSignal, getSignals, getSignalByMessageId, prune). Parameterized SQL only. Default prune=90 days. |
| `src/log/migrations.ts` | Migration for move_signals table | VERIFIED | Version '20260412_001', CREATE TABLE with 11 columns, 3 indexes. runMigrations() idempotent. Schema_migrations tracking table. |
| `src/config/schema.ts` | moveTracking config section | VERIFIED | moveTrackingConfigSchema exported. enabled: boolean default true, scanInterval: number default 30. Nested under reviewConfigSchema. MoveTrackingConfig type exported. |
| `src/tracking/index.ts` | MoveTracker class with lifecycle, snapshot diffing, signal creation | VERIFIED | MoveTracker, MoveTrackerDeps, MoveTrackerState all exported. start/stop/getState implemented. runScan, runDeepScan, pendingConfirmation, uidValidity handling, signalStore.logSignal, destinationResolver.resolveFast all present. |
| `src/tracking/destinations.ts` | Two-tier destination resolver | VERIFIED | DestinationResolver, DestinationResolverDeps exported. resolveFast, enqueueDeepScan, runDeepScan present. getRecentFolders(10) called. All 9 common folder names present. pendingDeepScan map. Deviation: uses injected listFolders fn instead of FolderCache class (FolderCache does not exist). |
| `src/log/index.ts` | ActivityLog with isSystemMove() | VERIFIED | isSystemMove(messageId: string): boolean present at line 188. Parameterized query, checks 'arrival'/'sweep'/'batch' sources within 1 day. getDb() accessor added. getRecentFolders() added. |
| `src/web/server.ts` | ServerDeps with getMoveTracker | VERIFIED | getMoveTracker: () => MoveTracker | undefined in ServerDeps. MoveTracker type imported from tracking/index.js. |
| `src/index.ts` | MoveTracker creation, lifecycle, config listeners | VERIFIED | Imports MoveTracker, SignalStore, DestinationResolver. Creates SignalStore after ActivityLog with shared DB. Creates MoveTracker after monitor.start(). Rebuilds on onImapConfigChange. getMoveTracker getter provided to buildServer. Signal prune interval created. |
| `test/unit/tracking/signals.test.ts` | Tests for signal storage and pruning | VERIFIED | 9 tests covering logSignal, getSignals ordering, getSignalByMessageId hit/miss, prune age boundary. All pass. |
| `test/unit/log/migrations.test.ts` | Test for move_signals migration | VERIFIED | 4 tests: column verification, index verification, idempotency, version check. All pass. |
| `test/unit/tracking/tracker.test.ts` | Tests for MoveTracker snapshot diffing and lifecycle | VERIFIED | 9 tests covering baseline, disappeared UIDs, system move exclusion, two-scan confirmation, UIDVALIDITY reset, timer lifecycle, disconnected skip, enabled=false guard. All pass. |
| `test/unit/tracking/destinations.test.ts` | Tests for destination resolution | VERIFIED | 9 tests covering fast pass hit in recent folder, fast pass hit in common folder, fast pass null, source folder skip, deep scan found, deep scan not found (dropped). All pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/tracking/signals.ts` | move_signals table | parameterized SQL queries | VERIFIED (unit) / BROKEN (runtime) | db.prepare used throughout. But table never created at runtime — see gap. |
| `src/log/migrations.ts` | move_signals table | CREATE TABLE | VERIFIED | SQL correct, idempotent, 11 columns, 3 indexes. Never called at runtime. |
| `src/tracking/index.ts` | `src/tracking/signals.ts` | signalStore.logSignal() | VERIFIED | signalStore.logSignal() called in private logSignal() at line 269. |
| `src/tracking/index.ts` | `src/log/index.ts` | activityLog.getState/setState | VERIFIED | getState at line 150, setState at line 324. Snapshot key pattern: "tracking:${folder}:snapshot". |
| `src/tracking/index.ts` | `src/tracking/destinations.ts` | destinationResolver.resolveFast() | VERIFIED | resolveFast called at line 221, enqueueDeepScan at line 230. |
| `src/tracking/destinations.ts` | `src/log/index.ts` | activityLog.getRecentFolders() | VERIFIED | getRecentFolders(10) called at line 51 in resolveFast(). |
| `src/index.ts` | `src/tracking/index.ts` | new MoveTracker(deps) | VERIFIED | Created at line 100, also rebuilt in onImapConfigChange at line 67. |
| `src/index.ts` | `src/tracking/signals.ts` | new SignalStore(db) | VERIFIED | Created at line 37 with activityLog.getDb(). |
| `src/web/server.ts` | `src/tracking/index.ts` | getMoveTracker getter | VERIFIED | getMoveTracker: () => moveTracker at line 85 in src/index.ts. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/tracking/signals.ts` | move_signals rows | db.prepare INSERT/SELECT with ? placeholders | Yes — parameterized SQL, correct schema | FLOWING (unit) / DISCONNECTED (runtime) — table never created |
| `src/tracking/index.ts` | pendingConfirmation Map | IMAP withMailboxLock fetch, ActivityLog.getState snapshot | Yes — live IMAP UID fetch + persisted JSON snapshot | FLOWING |
| `src/tracking/destinations.ts` | candidate folders | activityLog.getRecentFolders(10) + COMMON_FOLDERS const | Yes — DB query + hardcoded list | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED for server start behavior (requires IMAP credentials). Module export checks run below.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SignalStore exports correct names | `node -e "const m = require('./dist/tracking/signals.js'); console.log(typeof m.SignalStore)"` | function | PASS |
| MoveTracker exports correct names | `node -e "const m = require('./dist/tracking/index.js'); console.log(typeof m.MoveTracker)"` | function | PASS |
| Full test suite | `npx vitest run` | 213 tests passed, 16 files | PASS |
| Tracking-specific tests | `npx vitest run test/unit/tracking` | 27 tests passed (9 destinations, 9 tracker, 9 signals) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LEARN-01 | Plans 02, 03 | UID snapshot diffing with activity log cross-reference | SATISFIED | MoveTracker.scanFolder() diffs UIDs, ActivityLog.isSystemMove() excludes system moves. Tests verified. |
| LEARN-02 | Plans 01, 02, 03 | Log sender, envelope recipient, list headers, subject, read status, visibility, source/destination to move_signals | PARTIALLY SATISFIED | All 9 fields captured in MoveSignalInput and populated by MoveTracker. Table schema correct. Gap: table never created at runtime due to missing runMigrations() call. |
| LEARN-03 | Not in any plan | Statistical analysis on move signals | ORPHANED in REQUIREMENTS.md | Traceability table maps to Phase 10 but no plan claims it. Phase 11 goal explicitly covers this. |
| LEARN-04 | Not in any plan | Surface patterns as proposed rules in UI | ORPHANED in REQUIREMENTS.md | Same as LEARN-03 — Phase 11 work, not Phase 10. |
| LEARN-05 | Not in any plan | Approved proposed rules become real rules | ORPHANED in REQUIREMENTS.md | Same as LEARN-03 — Phase 11 work, not Phase 10. |
| UI-02 | Not in any plan | Proposed rules view in UI | ORPHANED in REQUIREMENTS.md | Depends on Phase 11 LEARN-03/04 output. Not Phase 10 scope. |

**Orphaned requirements:** LEARN-03, LEARN-04, LEARN-05, UI-02 appear in the REQUIREMENTS.md traceability table as "Phase 10" but no Phase 10 plan claimed them, and the Phase 11 roadmap entry clearly covers this work. The traceability table requires correction.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/log/index.ts` | 191 | `source IN ('arrival', 'sweep', 'batch')` — 'batch' source value referenced but no code path writes it | Info | isSystemMove() will never exclude batch-initiated moves since logActivity() only accepts 'arrival' \| 'sweep'. Forward-compatibility clause with no current effect. |
| `src/index.ts` | 39 | `signalPruneInterval` created with setInterval but never assigned to a clearable variable in shutdown path | Warning | Resource leak on config reload. No process shutdown handler clears this timer. Low impact for single-instance app (process exit clears timers) but asymmetric with how activity prune is managed. |

### Human Verification Required

None — all automated checks are sufficient for this phase's scope.

### Gaps Summary

**One critical gap blocking goal achievement:**

The `runMigrations()` function in `src/log/migrations.ts` is never called. The `ActivityLog` constructor calls its own private `migrate()` method (which runs the old inline ALTER TABLE for the `source` column) but has no reference to the new versioned migration system. As a result, the `move_signals` table is never created in the SQLite database.

Every `SignalStore.logSignal()` call at runtime will throw `SQLITE_ERROR: no such table: move_signals`. The phase's core deliverable — logging structured signal data — is non-functional despite all 213 tests passing (tests create the table manually in beforeEach).

**Fix is minimal:** Add `import { runMigrations } from './migrations.js'` to `src/log/index.ts` and call `runMigrations(this.db)` inside the `ActivityLog` constructor after the existing `this.migrate()` call.

---

_Verified: 2026-04-12T18:24:00Z_
_Verifier: Claude (gsd-verifier)_
