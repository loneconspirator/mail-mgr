---
phase: 11-pattern-detection
reviewed: 2026-04-12T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/index.ts
  - src/log/migrations.ts
  - src/shared/types.ts
  - src/tracking/detector.ts
  - src/tracking/index.ts
  - src/tracking/proposals.ts
  - src/web/frontend/api.ts
  - src/web/frontend/app.ts
  - src/web/frontend/index.html
  - src/web/frontend/styles.css
  - src/web/routes/proposed-rules.ts
  - src/web/server.ts
  - test/unit/tracking/detector.test.ts
  - test/unit/tracking/proposals.test.ts
  - test/unit/web/frontend.test.ts
  - test/unit/web/proposed-rules.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 11 introduces pattern detection on top of the existing move-tracking infrastructure: a `PatternDetector`, a `ProposalStore` backed by SQLite, frontend proposal cards with approve/modify/dismiss flows, and four new API routes. The implementation is coherent and the test coverage is solid.

Three warnings and three info items were found. No security vulnerabilities or crashes. The most important issue is a tie-breaking ambiguity in `ProposalStore.upsertProposal` that can silently flip the dominant destination when two folders have equal counts, and a subtle signal-fetch reliability issue in `MoveTracker.logSignal` when duplicate `messageId` values exist in the signal table.

---

## Warnings

### WR-01: Dominant-destination tie-break is non-deterministic

**File:** `src/tracking/proposals.ts:54-60`

**Issue:** When two destination folders have equal counts, `Object.entries(destCounts)` iteration order is insertion order in V8, but the code initialises `dominantDest = destination` (the *current* signal's destination) before the loop and only overwrites it with `count > maxCount` (strict greater-than). If the incoming destination is already tied for the lead, it becomes dominant rather than the pre-existing leader. This means a single signal to the previously-minority folder can steal "dominant" status the moment it ties, then the next signal to the other folder steals it back. The `destination_folder` column flips back and forth at the tie point, which in turn changes the `strengthLabel` and `conflictAnnotation` presented to the user.

**Fix:** Initialise `dominantDest` to the *current* `destination_folder` in the existing row (i.e. retain the incumbent on ties) instead of initialising it to the incoming destination:

```typescript
// Before the loop, seed with the row's current dominant folder to preserve it on ties
let dominantDest = existing.destination_folder as string;
let maxCount = 0;
for (const [dest, count] of Object.entries(destCounts)) {
  if (count > maxCount) {
    maxCount = count;
    dominantDest = dest;
  }
}
```

---

### WR-02: `getSignalByMessageId` may return the wrong signal after a message is re-delivered

**File:** `src/tracking/index.ts:291-295`

**Issue:** After `signalStore.logSignal(input)` inserts a new row, the code immediately calls `signalStore.getSignalByMessageId(input.messageId)` to retrieve the persisted signal (with its database-assigned `id`) so `patternDetector.processSignal` receives a complete `MoveSignal`. The SQL query in `getSignalByMessageId` is `WHERE message_id = ? LIMIT 1` with no `ORDER BY`, so SQLite may return *any* matching row — not necessarily the one just inserted. If a message was re-delivered (same `messageId`, different move), an older signal's `id` could be passed to `upsertProposal`, making the `_signalId` parameter reference a stale row.

`_signalId` is currently unused by `upsertProposal` (it is only logged for tracing), so this does not cause incorrect counts today. However, if future code uses the signal ID for deduplication or linking, it will silently produce wrong results.

**Fix:** Either add `ORDER BY id DESC` to the query in `signals.ts` so the most-recently inserted row is always returned, or (better) have `logSignal` return the inserted row id directly so the fetch is unnecessary:

```typescript
// In SignalStore.logSignal — return the new row id
logSignal(input: MoveSignalInput): number {
  const result = this.db.prepare(`INSERT INTO move_signals ...`).run(...);
  return result.lastInsertRowid as number;
}
```

Then in `MoveTracker.logSignal`, pass the returned id straight to `processSignal` after fetching by id instead of by messageId.

---

### WR-03: `makeDeps` in `frontend.test.ts` does not provide `getProposalStore`, causing a runtime crash in tests that exercise proposal routes

**File:** `test/unit/web/frontend.test.ts:35-51`

**Issue:** `makeDeps` constructs a `ServerDeps` object without `getProposalStore`, `getSweeper`, `getFolderCache`, `getBatchEngine`, or `getMoveTracker`. The server registers `registerProposedRuleRoutes(app, deps)` which calls `deps.getProposalStore()` on every `GET /api/proposed-rules` request. The test at line 166 (`compiled app.js contains proposed page logic`) does not exercise that route directly so it passes today, but any future test added under the `Frontend SPA serving` describe block that happens to hit `GET /api/proposed-rules` (or any other route using the missing getters) will crash with a `TypeError: deps.getProposalStore is not a function` at runtime rather than a clear test failure.

**Fix:** Provide stub implementations for all optional getter deps in `makeDeps`, or extract a shared `makeMinimalDeps` helper that both test suites can extend:

```typescript
function makeDeps(config: Config): ServerDeps {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
  const configRepo = new ConfigRepository(configPath);
  const db = new Database(':memory:');
  // ... run migrations or create tables ...
  return {
    configRepo,
    activityLog,
    staticRoot: path.join(process.cwd(), 'dist', 'public'),
    getMonitor: () => ({ getState() { return { ... }; } } as any),
    getSweeper: () => undefined,
    getFolderCache: () => { throw new Error('not wired'); },
    getBatchEngine: () => { throw new Error('not wired'); },
    getMoveTracker: () => undefined,
    getProposalStore: () => new ProposalStore(db),
  };
}
```

---

## Info

### IN-01: `_signalId` parameter in `upsertProposal` is accepted but never used

**File:** `src/tracking/proposals.ts:19`

**Issue:** The third parameter `_signalId: number` of `upsertProposal` is prefixed with `_` to indicate intentional non-use. The comment in `detector.ts` (line 18) passes the signal's `id` here. If this parameter is purely reserved for future use, it should be documented; if it was intended for deduplication (preventing the same signal from being counted twice), that logic was never implemented.

**Fix:** Add a brief JSDoc comment explaining the intent, or remove the parameter entirely until it is needed, to avoid confusion about whether deduplication is happening.

---

### IN-02: `src/index.ts` builds a second `ReviewSweeper` at line 221 that shadows the one started at line 56, but the first instance is never stopped

**File:** `src/index.ts:56-63, 221-229`

**Issue:** At startup, a `ReviewSweeper` is constructed at line 56 (assigned to `sweeper`) before IMAP connects, then a new one is built at line 221 with a resolved trash folder and immediately started. The first instance is never explicitly stopped — it was never started either (`.start()` is only called at line 229 on the second instance), so there is no timer leak. However, the first construction at line 56 is dead work and the pattern is confusing: someone adding a `sweeper.start()` call between lines 63 and 201 would accidentally start both instances.

**Fix:** Remove the premature construction at lines 56-63 and construct the sweeper only once after IMAP connects (the pattern already used correctly at lines 221-229).

---

### IN-03: `app.ts` uses `err: any` type assertions in promise-rejection handlers on the Proposed Rules page

**File:** `src/web/frontend/app.ts:1046, 1080, 1095`

**Issue:** Three `catch` blocks in the proposal card event handlers use `err: any` (e.g., `catch (err: any)` followed by `err.message`). The rest of the file consistently uses `e: unknown` with `e instanceof Error ? e.message : String(e)`. Using `any` bypasses type-checking and can hide bugs if the thrown value is not an Error object.

**Fix:** Replace `catch (err: any)` with the project-consistent pattern:

```typescript
} catch (e: unknown) {
  toast(e instanceof Error ? e.message : 'Failed to approve', true);
```

---

_Reviewed: 2026-04-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
