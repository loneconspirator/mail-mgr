# Phase 28: Sentinel Planting & Lifecycle - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Sentinel lifecycle orchestration: automatically plant sentinels in every tracked folder on startup, plant new sentinels when config/rules add folder references, and clean up sentinels when folder references are removed. This phase wires together the format (Phase 26) and IMAP operations (Phase 27) into automated behavior driven by config state. No scanning or rename detection (Phase 30) — just planting and cleanup.

</domain>

<decisions>
## Implementation Decisions

### Tracked Folder Discovery
- **D-01:** A single `collectTrackedFolders()` function enumerates all folders needing sentinels by scanning: rule move destinations, review folder, action folder paths, and sweep target folders from config. Returns a `Map<string, FolderPurpose>` excluding INBOX.
- **D-02:** This function takes the current config as input (not global state) so it can be called from any context — startup or config change handlers.

### Planting Trigger Points
- **D-03:** On startup (after self-test passes): call `collectTrackedFolders()`, diff against `SentinelStore.getAll()`, plant sentinels in any folder that's tracked but has no sentinel in the store.
- **D-04:** On config changes: hook into existing `configRepo.onRulesChange`, `configRepo.onActionFolderConfigChange`, and `configRepo.onReviewConfigChange` — each triggers a re-collect and diff-plant cycle.
- **D-05:** Planting is idempotent — if a sentinel already exists in the store for a folder, skip it. No duplicate sentinels.

### Cleanup & Orphan Detection
- **D-06:** Diff-based reconciliation: after `collectTrackedFolders()`, compare result against all sentinels in the store. Sentinels in the store whose folder_path is NOT in the tracked set get deleted (IMAP delete + store removal).
- **D-07:** Cleanup runs at the same trigger points as planting — startup and config changes. Single `reconcileSentinels()` function handles both planting missing and cleaning up orphaned.
- **D-08:** SENT-07 satisfied: when a rule is deleted or config change removes a folder reference, the next reconciliation pass detects the orphan and removes it.

### Self-Test Gate
- **D-09:** `runSentinelSelfTest()` runs in `main()` after IMAP connect, before any sentinel planting occurs. Uses an existing tracked folder (or falls back to review folder) as the test target.
- **D-10:** If self-test fails, set a runtime flag `sentinelEnabled = false` — all planting/lifecycle/cleanup becomes a no-op. Log a warning. Rest of the app runs normally without sentinel protection.
- **D-11:** Self-test result is NOT persisted — it runs fresh on each startup to account for server changes.

### INBOX Exclusion
- **D-12:** Carried from Phase 26: `buildSentinelMessage()` already throws on INBOX. `collectTrackedFolders()` also filters out INBOX as a secondary guard.

### Claude's Discretion
- Internal naming of the reconciliation orchestrator (e.g., `SentinelLifecycle` class vs standalone functions)
- Whether config change handlers call reconcile directly or go through a debounced wrapper
- Error handling granularity for individual folder planting failures within a batch
- Test file organization and mocking strategy

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SENT-01 (plant on startup + new folder refs), SENT-05 (INBOX exclusion), SENT-06 (self-test before planting), SENT-07 (cleanup on removed refs)

### Phase 26 & 27 Foundation
- `.planning/phases/26-sentinel-store-message-format/26-CONTEXT.md` — Sentinel format, store schema, module structure decisions
- `.planning/phases/27-imap-sentinel-operations/27-CONTEXT.md` — IMAP ops interface, self-test design, error handling decisions
- `src/sentinel/format.ts` — `buildSentinelMessage()`, `FolderPurpose` type, `purposeBody()`
- `src/sentinel/store.ts` — `SentinelStore` class with `upsert()`, `getByFolder()`, `getByMessageId()`, `deleteByMessageId()`
- `src/sentinel/imap-ops.ts` — `appendSentinel()`, `findSentinel()`, `deleteSentinel()`, `runSentinelSelfTest()`
- `src/sentinel/index.ts` — Barrel exports to extend

### Application Startup & Config
- `src/index.ts` — Main startup sequence where self-test and initial planting will be wired in; config change handlers (`onRulesChange`, `onActionFolderConfigChange`, `onReviewConfigChange`) where lifecycle hooks will be added
- `src/config/index.ts` — `ConfigRepository` with change event emitters

### Tracked Folder Sources
- `src/shared/types.ts` — Rule type with `folder` field (move destination), config types with review/sweep folder references
- `src/action-folders/` — Action folder config and path computation

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `appendSentinel()` — full APPEND + optional store upsert, ready to use for planting
- `deleteSentinel()` — full DELETE + optional store removal, ready to use for cleanup
- `runSentinelSelfTest()` — complete round-trip test, returns boolean, never throws
- `SentinelStore` — all CRUD operations needed for diffing and reconciliation
- `ConfigRepository` change emitters — `onRulesChange`, `onActionFolderConfigChange`, `onReviewConfigChange` already exist and fire on relevant changes

### Established Patterns
- Config change handlers in `src/index.ts` follow stop-rebuild-start pattern (see sweeper, poller, monitor rebuild logic)
- Action folder poller uses `ensureActionFolders()` before starting — sentinel planting can follow similar ensure-before-start pattern
- All startup operations happen sequentially in `main()` between IMAP connect and `monitor.start()`

### Integration Points
- `main()` in `src/index.ts` — self-test and initial reconciliation inserted between IMAP connect and monitor start
- Config change handlers — sentinel reconciliation added alongside existing rebuild logic
- `SentinelStore` needs a `getAll()` method (or equivalent) for reconciliation diffing
- `src/sentinel/index.ts` — new lifecycle exports

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

*Phase: 28-sentinel-planting-lifecycle*
*Context gathered: 2026-04-21*
