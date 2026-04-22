# Phase 28: Sentinel Planting & Lifecycle - Research

**Researched:** 2026-04-21
**Domain:** Sentinel lifecycle orchestration (planting, reconciliation, cleanup)
**Confidence:** HIGH

## Summary

This phase wires together the sentinel foundation (Phase 26: format + store, Phase 27: IMAP ops) into automated lifecycle behavior. The work is purely application-level orchestration — no new external dependencies, no new IMAP protocol concerns, no new database tables. Everything needed already exists: `appendSentinel()`, `deleteSentinel()`, `findSentinel()`, `runSentinelSelfTest()`, `SentinelStore` with full CRUD including `getAll()`, and `ConfigRepository` with change event emitters.

The core task is implementing a `collectTrackedFolders()` function that enumerates all folders needing sentinels from config, a `reconcileSentinels()` function that diffs tracked folders against the store and plants/cleans as needed, and wiring these into the startup sequence and config change handlers in `src/index.ts`.

**Primary recommendation:** Implement a `SentinelLifecycle` class (or module of standalone functions) in `src/sentinel/lifecycle.ts` that owns reconciliation logic, with integration points in `main()` and config change handlers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Single `collectTrackedFolders()` function scanning rule move destinations, review folder, action folder paths, sweep target folders. Returns `Map<string, FolderPurpose>` excluding INBOX.
- **D-02:** Takes current config as input (not global state).
- **D-03:** On startup (after self-test): collect, diff against `SentinelStore.getAll()`, plant missing.
- **D-04:** On config changes: hook into `configRepo.onRulesChange`, `onActionFolderConfigChange`, `onReviewConfigChange` — each triggers re-collect and diff-plant.
- **D-05:** Planting is idempotent — skip if sentinel already exists in store for a folder.
- **D-06:** Diff-based reconciliation: sentinels in store whose folder_path is NOT in tracked set get deleted (IMAP + store).
- **D-07:** Cleanup runs at same trigger points as planting — single `reconcileSentinels()` function.
- **D-08:** SENT-07 satisfied via orphan detection in reconciliation.
- **D-09:** `runSentinelSelfTest()` runs in `main()` after IMAP connect, before planting.
- **D-10:** If self-test fails, `sentinelEnabled = false` — all lifecycle becomes no-op.
- **D-11:** Self-test result NOT persisted — runs fresh each startup.
- **D-12:** INBOX exclusion: `buildSentinelMessage()` throws on INBOX + `collectTrackedFolders()` filters it out.

### Claude's Discretion
- Internal naming (class vs standalone functions)
- Whether config change handlers debounce reconciliation
- Error handling granularity for individual folder planting failures
- Test file organization and mocking strategy

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SENT-01 | Plant sentinels on startup + when rules/config add folder refs | `collectTrackedFolders()` + `reconcileSentinels()` wired to startup and config change handlers (D-01 through D-05) |
| SENT-07 | Cleanup sentinels when folder refs removed (rule deleted, config changed) | Diff-based orphan detection in `reconcileSentinels()` — store entries without matching tracked folder get IMAP deleted + store removed (D-06 through D-08) |
</phase_requirements>

## Architecture Patterns

### Recommended Project Structure
```
src/sentinel/
  format.ts        # (existing) Message format + FolderPurpose type
  store.ts         # (existing) SentinelStore CRUD
  imap-ops.ts      # (existing) appendSentinel, findSentinel, deleteSentinel, runSentinelSelfTest
  lifecycle.ts     # (NEW) collectTrackedFolders, reconcileSentinels, SentinelLifecycle
  index.ts         # (existing) Barrel — extend with lifecycle exports
```

### Pattern 1: Tracked Folder Collection
**What:** Enumerate all IMAP folders that need sentinels from config state.
**When to use:** On startup and any config change event.

```typescript
// [VERIFIED: codebase inspection of config/schema.ts and action-folders/registry.ts]
import type { Config, Rule, ActionFolderConfig, ReviewConfig } from '../config/schema.js';
import type { FolderPurpose } from './format.js';

export function collectTrackedFolders(config: Config): Map<string, FolderPurpose> {
  const folders = new Map<string, FolderPurpose>();

  // 1. Rule move destinations
  for (const rule of config.rules) {
    if (rule.enabled && rule.action.type === 'move' && rule.action.folder) {
      addFolder(folders, rule.action.folder, 'rule-target');
    }
  }

  // 2. Review folder (also a rule action target when type === 'review' with custom folder)
  addFolder(folders, config.review.folder, 'review');

  // 3. Review action rules with explicit folder overrides
  for (const rule of config.rules) {
    if (rule.enabled && rule.action.type === 'review' && rule.action.folder) {
      addFolder(folders, rule.action.folder, 'review');
    }
  }

  // 4. Sweep target (defaultArchiveFolder)
  addFolder(folders, config.review.defaultArchiveFolder, 'sweep-target');

  // 5. Action folders (when enabled)
  if (config.actionFolders.enabled) {
    const af = config.actionFolders;
    for (const folderName of Object.values(af.folders)) {
      addFolder(folders, `${af.prefix}/${folderName}`, 'action-folder');
    }
  }

  return folders;
}

function addFolder(map: Map<string, FolderPurpose>, path: string, purpose: FolderPurpose): void {
  if (path.toUpperCase() === 'INBOX') return; // D-12: never sentinel INBOX
  if (!map.has(path)) map.set(path, purpose);
  // First purpose wins — a folder can only have one sentinel
}
```

### Pattern 2: Diff-Based Reconciliation
**What:** Compare tracked folders against store, plant missing, clean up orphaned.
**When to use:** Single function for both startup and config change events.

```typescript
// [VERIFIED: codebase inspection of sentinel/store.ts and sentinel/imap-ops.ts]
export async function reconcileSentinels(
  tracked: Map<string, FolderPurpose>,
  store: SentinelStore,
  client: ImapClient,
  logger: Logger,
): Promise<{ planted: number; removed: number; errors: number }> {
  const existing = store.getAll();
  const existingFolders = new Set(existing.map(s => s.folderPath));
  let planted = 0, removed = 0, errors = 0;

  // Plant missing sentinels
  for (const [folder, purpose] of tracked) {
    if (!existingFolders.has(folder)) {
      try {
        await appendSentinel(client, folder, purpose, store);
        planted++;
      } catch (err) {
        errors++;
        logger.warn({ err, folder }, 'Failed to plant sentinel');
      }
    }
  }

  // Remove orphaned sentinels
  for (const sentinel of existing) {
    if (!tracked.has(sentinel.folderPath)) {
      try {
        const uid = await findSentinel(client, sentinel.folderPath, sentinel.messageId);
        if (uid !== undefined) {
          await deleteSentinel(client, sentinel.folderPath, uid, store, sentinel.messageId);
        } else {
          // Sentinel not found on IMAP — just clean store
          store.deleteByMessageId(sentinel.messageId);
        }
        removed++;
      } catch (err) {
        errors++;
        logger.warn({ err, folder: sentinel.folderPath }, 'Failed to clean up orphaned sentinel');
      }
    }
  }

  return { planted, removed, errors };
}
```

### Pattern 3: Startup Integration (self-test gate)
**What:** Self-test then initial reconciliation in `main()`.
**Where:** Between IMAP connect + envelope discovery and `monitor.start()`.

```typescript
// [VERIFIED: codebase inspection of src/index.ts startup sequence]
// In main(), after IMAP connect and envelope header discovery:
const sentinelStore = new SentinelStore(activityLog.getDb());
let sentinelEnabled = false;
const selfTestFolder = config.review.folder; // Use review folder as test target
sentinelEnabled = await runSentinelSelfTest(imapClient, selfTestFolder, logger);

if (sentinelEnabled) {
  const tracked = collectTrackedFolders(config);
  const result = await reconcileSentinels(tracked, sentinelStore, imapClient, logger);
  logger.info({ ...result }, 'Initial sentinel reconciliation complete');
}
```

### Pattern 4: Config Change Handler Integration
**What:** Wire reconciliation into existing change handlers.

Critical finding: `onRulesChange` takes a **synchronous** callback `(rules: Rule[]) => void`, while `onReviewConfigChange` and `onActionFolderConfigChange` take **async** callbacks. The sentinel reconciliation requires IMAP operations (async). [VERIFIED: codebase inspection of config/repository.ts lines 85, 128, 156]

Options for rules change handler:
1. Fire-and-forget async reconciliation from the sync callback (catch errors, log them)
2. Change `onRulesChange` to accept async callbacks (breaking change, affects existing listeners in `src/index.ts`)

**Recommendation:** Fire-and-forget with `.catch()` error logging. Simpler, no breaking changes.

```typescript
// [VERIFIED: codebase pattern from src/index.ts config change handlers]
configRepo.onRulesChange((rules) => {
  // Existing handlers
  monitor.updateRules(rules);
  if (sweeper) sweeper.updateRules(rules);
  batchEngine.updateRules(rules);

  // Sentinel reconciliation (fire-and-forget from sync callback)
  if (sentinelEnabled) {
    const updatedConfig = configRepo.getConfig();
    const tracked = collectTrackedFolders(updatedConfig);
    reconcileSentinels(tracked, sentinelStore, imapClient, logger)
      .catch(err => logger.error({ err }, 'Sentinel reconciliation failed after rules change'));
  }
});
```

For async handlers (`onReviewConfigChange`, `onActionFolderConfigChange`), reconciliation can be awaited directly since those callbacks are already async.

### Anti-Patterns to Avoid
- **Per-folder sentinelEnabled checks:** The flag should gate at the reconciliation entry point, not inside `appendSentinel`. The low-level ops remain reusable. [ASSUMED]
- **Storing self-test result in DB:** D-11 explicitly says self-test is NOT persisted — runs fresh each startup.
- **Reconciling on IMAP config change:** The IMAP reconnect handler already rebuilds everything. Sentinel reconciliation should be added there too, but after the new client is connected. [VERIFIED: src/index.ts lines 144-242]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder enumeration | Manual folder list parsing | `collectTrackedFolders()` reading from `Config` object | Config schema is the source of truth; direct IMAP folder listing would miss intent |
| Sentinel existence check | IMAP SEARCH on every reconcile | `SentinelStore.getAll()` for diffing | Store is authoritative for "what we think exists"; IMAP verification is Phase 30's job |
| Debouncing rapid config changes | Custom timer/debounce logic | Simple sequential reconciliation | Config changes are rare (user-initiated); over-engineering debounce adds complexity for no real benefit |

## Common Pitfalls

### Pitfall 1: onRulesChange is synchronous
**What goes wrong:** Trying to `await` inside the `onRulesChange` callback or changing its signature breaks existing listeners.
**Why it happens:** The other config change handlers (`onReviewConfigChange`, `onActionFolderConfigChange`) are async, creating an expectation that rules handler is too.
**How to avoid:** Use fire-and-forget pattern with `.catch()` error logging for the sync callback. Or schedule reconciliation via `queueMicrotask` / `setImmediate`.
**Warning signs:** TypeScript error about `void` vs `Promise<void>` return type.

### Pitfall 2: Folder purpose conflicts when same folder serves multiple purposes
**What goes wrong:** A folder like "Archive" could be both a rule move target and the sweep defaultArchiveFolder. Planting two sentinels in the same folder creates confusion.
**Why it happens:** Multiple config paths can reference the same IMAP folder.
**How to avoid:** `collectTrackedFolders()` uses a `Map<string, FolderPurpose>` — first purpose wins. One sentinel per folder. The `SentinelStore.upsert` uses `INSERT OR REPLACE` keyed on `message_id`, and `getByFolder` returns a single result.
**Warning signs:** Duplicate sentinels in the same folder.

### Pitfall 3: Orphan cleanup races with folder that's still being created
**What goes wrong:** During action folder config change, `ensureActionFolders()` runs concurrently with reconciliation. If reconciliation runs first, it might try to plant in a folder that doesn't exist yet.
**Why it happens:** IMAP APPEND to a non-existent folder may fail on some servers.
**How to avoid:** In the `onActionFolderConfigChange` handler, run `ensureActionFolders()` FIRST (as it already does), then run reconciliation. For startup, action folder creation already happens before monitor.start — sentinel planting should go after folder creation too.
**Warning signs:** APPEND errors for folders that should exist.

### Pitfall 4: Review action rules with custom folder override
**What goes wrong:** Rules with `action.type === 'review'` can optionally specify a `folder` override (different from the default review folder). Missing these means those folders don't get sentinels.
**Why it happens:** Most review rules use the default `config.review.folder`, so the override case is easy to miss.
**How to avoid:** `collectTrackedFolders()` must iterate rules and check for review actions with explicit `folder` field.
**Warning signs:** Folders referenced by review rules don't appear in the tracked set.

### Pitfall 5: Disabled rules still referencing folders
**What goes wrong:** If a rule is disabled (`enabled: false`), should its target folder still get a sentinel? If yes, re-enabling later is seamless. If no, disabling a rule triggers cleanup.
**Why it happens:** Decision D-01 says scan "rule move destinations" but doesn't specify enabled-only.
**How to avoid:** Only track enabled rules. Disabled rules don't actively file mail, so their folders aren't "tracked" in the sentinel sense. If the user re-enables, the next reconciliation plants automatically. This matches the existing pattern where `monitor.updateRules()` only processes enabled rules.
**Warning signs:** Sentinels persisting in folders for long-disabled rules.

## Code Examples

### Complete collectTrackedFolders (all sources)
```typescript
// Source: [VERIFIED: codebase analysis of config/schema.ts, action-folders/registry.ts]
// Folder sources that need sentinels:
// 1. rule.action.folder (where type === 'move')
// 2. rule.action.folder (where type === 'review' and folder is set)
// 3. config.review.folder (always)
// 4. config.review.defaultArchiveFolder (sweep target)
// 5. action folder paths: `${config.actionFolders.prefix}/${folderName}` for each action type
//
// NOT included:
// - INBOX (D-12)
// - config.review.trashFolder (system folder, cannot be renamed meaningfully)
// - Disabled rules (see Pitfall 5)
```

### Startup sequence insertion point
```typescript
// Source: [VERIFIED: src/index.ts lines 265-311]
// Current startup order:
// 1. IMAP connect
// 2. Envelope header discovery
// 3. Trash folder resolution
// 4. ensureActionFolders (if enabled)
// 5. Action folder pre-scan
// 6. monitor.start()
// 7. sweeper.start()
// 8. moveTracker.start()
//
// Sentinel insertion:
// After step 2 (IMAP is connected, headers resolved)
// Before step 4 (so sentinels are planted in action folders AFTER they exist)
// Actually: self-test can go after step 2, but planting should go after step 4
// to ensure action folders exist before we try to plant sentinels in them.
//
// Revised order:
// 1. IMAP connect
// 2. Envelope header discovery
// 3. Trash folder resolution
// 4. Sentinel self-test (needs connected IMAP)
// 5. ensureActionFolders
// 6. Initial sentinel reconciliation (if self-test passed)
// 7. Action folder pre-scan
// 8. monitor.start()
// 9. sweeper.start()
// 10. moveTracker.start()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Folder rename via API endpoint (Phase 25) | Sentinel-based auto-detection | v0.7 | Manual rename is being superseded by sentinel system |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Only enabled rules should have their target folders tracked | Pitfall 5 | Disabled rules' folders would lose sentinels; re-enabling triggers replant automatically so risk is low |
| A2 | `config.review.trashFolder` does NOT need a sentinel | Code Examples | If trash folder gets renamed, sweeper would break — but trash is typically a special-use folder that IMAP servers don't allow renaming |
| A3 | Per-folder error isolation (continue planting others if one fails) is the right approach | Architecture Pattern 2 | If a batch-abort approach were preferred, partial planting could leave inconsistent state |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (via `vitest run`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/sentinel/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SENT-01 (startup) | On startup, all tracked folders get sentinels | unit | `npx vitest run test/unit/sentinel/lifecycle.test.ts -t "startup"` | Wave 0 |
| SENT-01 (config change) | Config changes trigger replanting | unit | `npx vitest run test/unit/sentinel/lifecycle.test.ts -t "config change"` | Wave 0 |
| SENT-07 | Orphaned sentinels cleaned on rule/config removal | unit | `npx vitest run test/unit/sentinel/lifecycle.test.ts -t "orphan"` | Wave 0 |
| D-12 | INBOX never gets a sentinel | unit | `npx vitest run test/unit/sentinel/lifecycle.test.ts -t "INBOX"` | Wave 0 |
| D-10 | Self-test failure disables all sentinel ops | unit | `npx vitest run test/unit/sentinel/lifecycle.test.ts -t "self-test"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/sentinel/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/sentinel/lifecycle.test.ts` — covers SENT-01, SENT-07, D-10, D-12
- Existing test infrastructure (vitest, mock patterns from `imap-ops.test.ts`) is sufficient — no new framework setup needed

## Security Domain

Not applicable for this phase. Sentinel lifecycle is internal application orchestration with no user-facing input surfaces, no authentication changes, and no new API endpoints. The IMAP operations use the existing authenticated client. INBOX exclusion is a safety guard (D-12), not a security control.

## Sources

### Primary (HIGH confidence)
- `src/sentinel/format.ts` — FolderPurpose type, buildSentinelMessage with INBOX guard
- `src/sentinel/store.ts` — SentinelStore with getAll(), upsert(), deleteByMessageId(), deleteByFolder()
- `src/sentinel/imap-ops.ts` — appendSentinel(), findSentinel(), deleteSentinel(), runSentinelSelfTest()
- `src/config/repository.ts` — ConfigRepository with onRulesChange (sync), onReviewConfigChange (async), onActionFolderConfigChange (async)
- `src/config/schema.ts` — Config type, Rule action types, ActionFolderConfig, ReviewConfig
- `src/action-folders/registry.ts` — ACTION_REGISTRY with folderConfigKey mappings
- `src/index.ts` — main() startup sequence and all config change handlers

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all building blocks exist from Phase 26/27
- Architecture: HIGH — patterns directly derive from existing codebase patterns and locked decisions
- Pitfalls: HIGH — identified from direct codebase analysis (sync vs async callbacks, folder overlap, startup ordering)

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable — no external dependencies)
