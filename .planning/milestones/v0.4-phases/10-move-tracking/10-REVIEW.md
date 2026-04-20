---
phase: 10-move-tracking
reviewed: 2026-04-12T12:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/config/index.ts
  - src/config/schema.ts
  - src/imap/client.ts
  - src/index.ts
  - src/log/index.ts
  - src/log/migrations.ts
  - src/tracking/destinations.ts
  - src/tracking/index.ts
  - src/tracking/signals.ts
  - src/web/server.ts
  - test/unit/log/migrations.test.ts
  - test/unit/tracking/destinations.test.ts
  - test/unit/tracking/signals.test.ts
  - test/unit/tracking/tracker.test.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-12T12:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 10 adds a move-tracking subsystem that detects user-initiated message moves by comparing IMAP UID snapshots across periodic scans. The implementation includes `MoveTracker` (scan loop with two-scan confirmation), `DestinationResolver` (two-tier fast-pass and deep-scan folder search), `SignalStore` (SQLite persistence), and a versioned migration framework.

Previous critical bugs identified in an earlier review (missing `runMigrations` call, dropped deep-scan signals, connection leak on config reload) have all been fixed. The codebase is now in solid shape. SQL queries use parameterized statements throughout. The two-scan confirmation logic correctly prevents false positives from transient IMAP state. Test coverage is thorough for the core scan/confirm/signal pipeline.

One critical issue remains: unguarded `JSON.parse` on persisted snapshot data can permanently disable the scan loop. Two warnings address a dual-migration-system maintenance risk and a uidValidity property accessed via unsafe cast. Two informational items round out the review.

## Critical Issues

### CR-01: Unguarded JSON.parse on persisted snapshot can permanently disable scan loop

**File:** `src/tracking/index.ts:153`
**Issue:** `JSON.parse(prevRaw)` is called on state retrieved from SQLite with no try/catch. If the persisted snapshot string is corrupted (disk error, manual edit, partial write on crash), this throws a `SyntaxError`. The error propagates up through `scanFolder` to `runScan`, where it is caught by the `setInterval` error handler that only logs it. However, the corrupted snapshot value remains in the database, so every subsequent scan attempt also throws the same `SyntaxError`. Move tracking is effectively dead until someone manually deletes the state row from SQLite. There is no self-healing path.
**Fix:**
```typescript
// In scanFolder(), replace line 153:
let prevSnapshot: FolderSnapshot | null = null;
if (prevRaw) {
  try {
    prevSnapshot = JSON.parse(prevRaw);
  } catch {
    this.deps.logger?.warn({ folder, stateKey }, 'Corrupted snapshot, re-baselining');
    // Fall through with prevSnapshot = null to trigger re-baseline
  }
}
```

## Warnings

### WR-01: Dual migration systems create maintenance risk

**File:** `src/log/index.ts:56-57`
**Issue:** The `ActivityLog` constructor runs two separate migration mechanisms in sequence: an inline `migrate()` method (line 63-68) that uses try/catch `ALTER TABLE` to add the `source` column, followed by `runMigrations(this.db)` (line 57) which uses a versioned `schema_migrations` table. Having two independent migration strategies operating on the same database is confusing. The inline approach cannot track whether it has already run -- it relies on error suppression. A future contributor adding a new column could reasonably follow either pattern, leading to inconsistency.
**Fix:** Consolidate the `source` column migration into the `migrations.ts` framework and remove the inline `migrate()` method:
```typescript
// Add to migrations array in src/log/migrations.ts (before the existing entry):
{
  version: '20260101_001',
  description: 'Add source column to activity table',
  up: (db) => {
    try {
      db.exec(`ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'`);
    } catch {
      // Column already exists -- idempotent
    }
  },
},
```
Then remove the private `migrate()` method and its call from the `ActivityLog` constructor.

### WR-02: uidValidity accessed via unsafe double-cast against undeclared interface property

**File:** `src/tracking/index.ts:279`
**Issue:** The code accesses `flow.mailbox.uidValidity` through an unsafe cast: `(flow as unknown as { mailbox?: { uidValidity?: number } }).mailbox`. The `ImapFlowLike` interface in `src/imap/client.ts` does not declare a `mailbox` property. This means: (a) the TypeScript compiler cannot verify the property exists at build time, and (b) if a future refactor changes the ImapFlow adapter to not expose `.mailbox`, `uidValidity` silently falls back to `0`. Since both scans would then see `uidValidity: 0`, the UIDVALIDITY-change detection (lines 156-163) would never trigger, silently disabling a safety mechanism that prevents false-positive signals after mailbox rebuilds.
**Fix:** Add `mailbox` as an optional property on the `ImapFlowLike` interface so the contract is explicit:
```typescript
// In src/imap/client.ts, add to ImapFlowLike interface:
mailbox?: { uidValidity?: number };
```
Then access it directly without casting:
```typescript
const uidValidity = flow.mailbox?.uidValidity ?? 0;
```

## Info

### IN-01: Envelope-based message search fetches all messages in folder

**File:** `src/tracking/destinations.ts:144`
**Issue:** `searchFolderForMessage` fetches all envelopes (`'1:*'`) and iterates them to match a single Message-ID. For large folders (thousands of messages), this is an expensive IMAP operation repeated for each candidate folder. The existing code comment on lines 139-140 already acknowledges this. IMAP SEARCH with a HEADER criterion would be more efficient but depends on ImapFlow API support. This is not a correctness issue.
**Fix:** When ImapFlow search support is available, replace the fetch loop:
```typescript
const results = await flow.search({ header: { 'Message-ID': messageId } }, { uid: true });
return results.length > 0;
```

### IN-02: Module-level mutable state in tracker test file

**File:** `test/unit/tracking/tracker.test.ts:360-372`
**Issue:** The `_tracker` variable is declared at module scope and shared across test cases via the `tracker_runScan` helper. This works because vitest runs tests within a file sequentially, but the pattern is fragile and would break under concurrent test execution. A per-test factory returning a bound scan helper would be more robust and self-documenting.
**Fix:** Replace the module-level variable with a per-test factory:
```typescript
function createTrackerHelper(deps: MoveTrackerDeps) {
  const tracker = new MoveTracker(deps);
  return {
    tracker,
    runScan: () => tracker.runScanForTest(),
  };
}
```

---

_Reviewed: 2026-04-12T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
