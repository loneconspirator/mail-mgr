---
phase: 10-move-tracking
reviewed: 2026-04-12T00:00:00Z
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
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

This phase adds move tracking to the mail manager: a `MoveTracker` that snapshots INBOX/Review folder UIDs, detects disappearances across two consecutive scans, resolves destinations via a two-tier fast-pass/deep-scan resolver, and logs move signals to a new `move_signals` SQLite table via `SignalStore`. The `ActivityLog` gains an `isSystemMove()` helper to exclude system-generated moves from user-signal detection.

Two critical bugs were found. First, the `move_signals` table is never created in the production code path — `runMigrations()` exists and is tested but is never called from `ActivityLog` or `src/index.ts`, so every `SignalStore` operation crashes at startup. Second, the deep-scan resolution path in `MoveTracker` is entirely broken: entries are deleted from `pendingConfirmation` before being enqueued for deep scan, so when deep scan resolves a message the metadata lookup always fails and the signal is silently dropped.

Three additional warnings cover a connection leak on IMAP config reload, an uncleared interval reference, and a misleading internal counter. The rest of the code — schema definitions, `DestinationResolver` fast-pass logic, `SignalStore` CRUD, and test coverage for the working paths — is solid.

---

## Critical Issues

### CR-01: `move_signals` table is never created in production — `SignalStore` crashes on startup

**File:** `src/index.ts:37`

**Issue:** `SignalStore` is instantiated and `signalStore.prune()` is called immediately at line 38. `SignalStore` operates against a `move_signals` table that only exists after `runMigrations()` is called. `runMigrations()` is defined in `src/log/migrations.ts` and is tested in isolation, but it is never imported or called anywhere in the production source. The `ActivityLog` constructor calls its own `private migrate()` method, which only handles the `source` column via `ALTER TABLE` — it does not call `runMigrations()`. Result: the first `SignalStore` query at startup throws `SQLITE_ERROR: no such table: move_signals`.

**Fix:** Call `runMigrations` from the `ActivityLog` constructor after the inline `migrate()` call, so the same DB lifecycle that creates the base schema also runs the versioned migration table:

```typescript
// src/log/index.ts
import { runMigrations } from './migrations.js';

constructor(dbPath: string) {
  this.db = new Database(dbPath);
  this.db.pragma('journal_mode = WAL');
  this.db.exec(SCHEMA);
  this.migrate();          // existing: adds `source` column
  runMigrations(this.db);  // add: runs versioned migrations (creates move_signals, etc.)
}
```

Alternatively, call it in `src/index.ts` before constructing `SignalStore`, but wiring it into `ActivityLog` is cleaner and ensures it always runs regardless of call site.

---

### CR-02: Deep-scan signals are silently dropped — `pendingConfirmation` entry removed before deep-scan resolution

**File:** `src/tracking/index.ts:219`

**Issue:** In `confirmDisappearedMessage()`, the entry is deleted from `pendingConfirmation` at line 219 *before* deciding whether to enqueue it for deep scan (line 230). When the `runDeepScan()` timer fires later (line 235–249), it iterates `pendingConfirmation` looking for the entry with a matching `messageId` to call `logSignal()` — but that entry no longer exists. Every message that required a deep scan to resolve its destination has its signal permanently dropped. The `DestinationResolver` finds the folder correctly, but `MoveTracker` cannot retrieve the original `TrackedMessage` metadata (sender, subject, readStatus, etc.) to compose the signal.

**Fix:** Keep a separate map of messages waiting for deep-scan results. Do not delete from `pendingConfirmation` until after the signal is logged, or use a dedicated `pendingDeepScanMeta` store:

```typescript
// In MoveTracker class, add:
private pendingDeepScanMeta: Map<string, TrackedMessage & { sourceFolder: string }> = new Map();

// In confirmDisappearedMessage:
private async confirmDisappearedMessage(
  key: string,
  entry: TrackedMessage & { sourceFolder: string },
  folder: string,
): Promise<void> {
  this.pendingConfirmation.delete(key);

  const destination = await this.deps.destinationResolver.resolveFast(
    entry.messageId,
    folder,
  );

  if (destination) {
    this.logSignal(entry, folder, destination);
  } else {
    // Store metadata for deep scan resolution
    this.pendingDeepScanMeta.set(entry.messageId, entry);
    this.deps.destinationResolver.enqueueDeepScan(entry.messageId, folder);
  }
}

// In runDeepScan:
private async runDeepScan(): Promise<void> {
  const resolved = await this.deps.destinationResolver.runDeepScan();

  for (const [messageId, destinationFolder] of resolved) {
    const entry = this.pendingDeepScanMeta.get(messageId);
    if (entry) {
      this.logSignal(entry, entry.sourceFolder, destinationFolder);
      this.pendingDeepScanMeta.delete(messageId);
    }
  }
  // D-06: Unresolved entries are dropped -- clear remaining pending meta
  this.pendingDeepScanMeta.clear();
}
```

---

## Warnings

### WR-01: Old `ImapClient` not disconnected on IMAP config reload — connection leak

**File:** `src/index.ts:50-79`

**Issue:** The `onImapConfigChange` handler stops the old `monitor` and `moveTracker` but never calls `disconnect()` on the original `imapClient`. The original `ImapClient` instance (created at line 41) holds an open IMAP connection with active reconnect timers. After the config change, it will keep trying to reconnect indefinitely in the background while a new client takes over. On repeated config changes this accumulates orphaned connections.

**Fix:** Disconnect the outgoing client before replacing it:

```typescript
configRepo.onImapConfigChange(async (newConfig) => {
  await monitor.stop();
  if (moveTracker) moveTracker.stop();
  moveTracker = undefined;

  // Disconnect the old IMAP client before replacing
  await imapClient.disconnect();
  imapClient = new ImapClient(newConfig.imap, createImapFlow);
  // ... rest of rebuild
});
```

Note: `imapClient` must be changed from `const` to `let` for this to work.

---

### WR-02: `signalPruneInterval` is never cleared — unmanaged interval reference

**File:** `src/index.ts:39`

**Issue:** `signalPruneInterval` is assigned from `setInterval()` but the variable is never referenced again and never cleared. While this does not cause a runtime crash (the process exits on shutdown anyway), the interval cannot be stopped on IMAP config reload either. The `signalStore` itself is long-lived and reused across reloads, so the prune interval is intentionally continuous — but the variable declaration as a `const` with no cleanup path signals incomplete lifecycle management and will confuse future maintainers.

**Fix:** Either drop the variable and use a fire-and-forget pattern explicitly, or store it for potential cleanup:

```typescript
// Option A: make the intent explicit if cleanup is not needed
setInterval(() => signalStore.prune(), 24 * 60 * 60 * 1000).unref();

// Option B: store for shutdown cleanup alongside other lifecycle teardown
const signalPruneInterval = setInterval(() => signalStore.prune(), 24 * 60 * 60 * 1000);
process.on('SIGTERM', () => { clearInterval(signalPruneInterval); });
```

---

### WR-03: `countPendingDeepScan()` reports `pendingConfirmation` size, not actual deep-scan queue depth

**File:** `src/tracking/index.ts:328-335`

**Issue:** `MoveTrackerState.pendingDeepScan` is documented as the count of messages enqueued for deep scan. The implementation counts all entries in `pendingConfirmation`, which includes messages waiting for two-scan confirmation (first-detection stage) and messages already confirmed and awaiting deep scan. After CR-02 is fixed and a `pendingDeepScanMeta` map is introduced, this counter should reflect that map's size instead. Currently the count is always wrong in the upward direction — it over-reports.

**Fix (after CR-02 fix):**

```typescript
private countPendingDeepScan(): number {
  return this.pendingDeepScanMeta.size;
}
```

---

## Info

### IN-01: `moveTracking` config accessed with unnecessary optional chaining in `src/index.ts`

**File:** `src/index.ts:74-75, 107-108`

**Issue:** `newConfig.review.moveTracking?.scanInterval` and `newConfig.review.moveTracking?.enabled` use optional chaining, but the Zod schema defines `moveTracking` with `.default(moveTrackingDefaults)` inside `reviewConfigSchema`, guaranteeing it is always present after parsing. The `?.` chaining and `?? 30` / `?? true` fallbacks are dead code that suggest the author was uncertain whether the field could be absent.

**Fix:** Remove the optional chaining and nullish-coalescing fallbacks:

```typescript
scanIntervalMs: config.review.moveTracking.scanInterval * 1000,
enabled: config.review.moveTracking.enabled,
```

---

### IN-02: `rowToSignal` optional-field cast pattern is fragile

**File:** `src/tracking/signals.ts:94-96`

**Issue:** The pattern `(row.envelope_recipient as string) ?? undefined` works correctly at runtime because `null ?? undefined` evaluates to `undefined`. However, the TypeScript cast `as string` lies to the compiler — the actual runtime value is `null`, not `string`. A reader unfamiliar with SQLite's null representation could easily mistake the intent. A `null` value slipping through a future refactor of this cast could cause subtle type errors.

**Fix:** Use an explicit null check:

```typescript
envelopeRecipient: row.envelope_recipient != null ? (row.envelope_recipient as string) : undefined,
listId: row.list_id != null ? (row.list_id as string) : undefined,
visibility: row.visibility != null ? (row.visibility as string) : undefined,
```

---

### IN-03: Deep scan re-searches recent folders already checked during fast pass

**File:** `src/tracking/destinations.ts:96-132`

**Issue:** `runDeepScan()` skips `COMMON_FOLDERS` (the hardcoded list) but does not skip recent folders returned by `activityLog.getRecentFolders()` that were already searched during the fast-pass stage. If the fast pass checked "Projects" and "Receipts/2024" and did not find the message, the deep scan will check them again. This is a redundancy, not a correctness bug — the message still won't be found there — but it adds unnecessary IMAP round-trips for large folder counts.

**Fix (optional, consider for future):** Capture the folders searched during `resolveFast()` and pass them as an exclusion set to `runDeepScan()`, or cache the result per message-id. Since performance is out of v1 scope, this is flagged for awareness only.

---

_Reviewed: 2026-04-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
