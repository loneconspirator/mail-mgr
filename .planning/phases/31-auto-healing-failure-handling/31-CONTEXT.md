# Phase 31: Auto-Healing & Failure Handling - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

When the SentinelScanner detects folder renames (sentinel found in different folder) or folder deletions (sentinel and folder both gone), automatically repair configuration and rule references or notify the user. This phase consumes ScanReport results from Phase 30's scanner via the `onScanComplete` callback and takes all healing/notification actions. It does NOT modify the scanner itself.

</domain>

<decisions>
## Implementation Decisions

### Reference Update on Rename (HEAL-01, HEAL-02)
- **D-01:** On `found-in-different-folder` result, iterate all config sources that reference the old folder path: rules with `action.folder` matching old path, rules with `action.folder` for review actions, `review.folder`, `review.defaultArchiveFolder`, and action folder paths (derived from prefix + folder name). Replace old path with new path in each.
- **D-02:** Updates are applied in-memory to the Config object and persisted via `saveConfig()` directly — do NOT fire ConfigRepository change listeners (`onRulesChange`, `onReviewConfigChange`, `onActionFolderConfigChange`) to avoid triggering full pipeline rebuilds (HEAL-02). The in-memory config object is already shared, so the next time any component reads config, it sees the updated paths.
- **D-03:** Update the SentinelStore mapping via `updateFolderPath(messageId, newPath)` so the sentinel record now points to the renamed folder.
- **D-04:** Process each rename independently within a single scan report — no batching across renames. Multiple renames in one 5-minute scan window is rare.

### INBOX Notification on Folder Loss (FAIL-01, FAIL-02)
- **D-05:** On `not-found` result where the folder no longer exists on IMAP either, APPEND a plain-text notification email to INBOX using `ImapClient.appendMessage()`. Subject: `[Mail Manager] Folder lost: {folderPath}`. Body explains: the folder was deleted or is inaccessible, which rules/configs referenced it, those rules have been disabled, and the user should recreate the folder or update their config.
- **D-06:** Track notified folder losses (e.g., a `notified_at` timestamp in the sentinel record or a separate tracking mechanism) to avoid re-notifying on every subsequent scan cycle. Once notified, the sentinel mapping is removed from the store.
- **D-07:** System does NOT auto-recreate deleted folders (FAIL-03).

### Rule Disabling on Folder Loss (FAIL-01)
- **D-08:** When a folder is confirmed lost (sentinel missing AND folder not found on IMAP), set `enabled: false` on all rules whose `action.folder` matches the lost folder path. Persist via `saveConfig()` directly (same no-listener approach as D-02).
- **D-09:** For review config references (`review.folder`, `review.defaultArchiveFolder`): log a warning but do not disable them — losing the review folder is a critical situation that needs user attention via the INBOX notification. The system continues to run with stale references until the user fixes config.
- **D-10:** For action folder paths: log a warning but do not disable action folder config — the user can manually recreate the folder or change config.

### Sentinel Re-planting (HEAL-03)
- **D-11:** On `not-found` result where the folder DOES still exist on IMAP (sentinel was deleted by user or mail client but folder is intact), re-plant a new sentinel via `appendSentinel()` and update the store mapping with the new Message-ID.
- **D-12:** Re-planting is logged to the activity log for audit trail (HEAL-04) but does NOT generate an INBOX notification — this is a self-healing operation invisible to the user.

### Activity Logging (HEAL-04)
- **D-13:** All healing events are logged to the activity log with a new source type (e.g., `sentinel`): rename detected (old path, new path, affected rules/config), references updated, sentinel re-planted, folder lost (affected rules disabled, notification sent).
- **D-14:** Activity log entries should include enough detail for the user to understand what changed when they view the activity page.

### Integration Point
- **D-15:** Hook into the SentinelScanner via the `onScanComplete` callback in `SentinelScannerDeps`. The healing handler function is wired up in `src/index.ts` when creating the SentinelScanner instance.
- **D-16:** The healer needs access to: `ConfigRepository` (for reading current config), `saveConfig` (for persisting without listeners), `SentinelStore` (for updating mappings), `ImapClient` (for folder existence checks, re-planting, INBOX notification), `ActivityLog` (for audit trail), and a logger.

### Claude's Discretion
- Internal module structure (single `healer.ts` file vs. split into `rename-handler.ts` / `failure-handler.ts`)
- Whether to check folder existence via `listMailboxes()` or a targeted `status()` call
- Activity log entry format and detail level
- Whether to extract a shared `updateConfigWithoutListeners()` helper or inline the save
- Test file organization and fixture design
- Type names for healing result reporting

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — HEAL-01 (rename reference update), HEAL-02 (atomic, no rebuild), HEAL-03 (re-plant missing sentinel), HEAL-04 (activity logging), FAIL-01 (disable on folder loss), FAIL-02 (INBOX notification), FAIL-03 (no auto-recreate)

### Scanner Output (Phase 30)
- `src/sentinel/scanner.ts` — `ScanReport`, `ScanResult` types, `onScanComplete` callback, `FoundInDifferentFolder` (rename) and `NotFound` (missing) result types

### Sentinel Infrastructure
- `src/sentinel/store.ts` — `SentinelStore.updateFolderPath()`, `deleteByMessageId()`, `getByFolder()`
- `src/sentinel/imap-ops.ts` — `appendSentinel()` (for re-planting), `findSentinel()`, `deleteSentinel()`
- `src/sentinel/lifecycle.ts` — `collectTrackedFolders()` (enumerates all config folder references)
- `src/sentinel/index.ts` — Barrel exports to extend

### Config System
- `src/config/repository.ts` — `ConfigRepository` class with change listeners (which healer must bypass per HEAL-02)
- `src/config/loader.ts` — `saveConfig()` function for direct persistence without listeners
- `src/config/schema.ts` — `Config` type with all folder path locations (rules, review, actionFolders)

### Activity Logging
- `src/log/index.ts` — `ActivityLog.logActivity()` interface (may need extension for sentinel events)

### Application Wiring
- `src/index.ts` — Where SentinelScanner is instantiated with `onScanComplete` callback (lines 368-375), and reconnect handler (lines 276-285)

### Phase 30 Context
- `.planning/phases/30-scanning-rename-detection/30-CONTEXT.md` — Scanner architecture decisions, especially D-02 (bulk report), D-03 (detection only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SentinelScanner.onScanComplete` callback — Ready-made hook for Phase 31 healing logic
- `SentinelStore.updateFolderPath(messageId, newPath)` — Already exists for rename handling
- `appendSentinel(client, folder, purpose, store)` — Re-planting uses existing function
- `collectTrackedFolders(config)` — Enumerates all folder references (rules, review, action folders) — useful for finding what to update
- `ImapClient.appendMessage()` — For INBOX notification messages
- `ImapClient.listMailboxes()` — For checking whether folders still exist
- `saveConfig(configPath, config)` — Direct config persistence without change listeners

### Established Patterns
- Timer-based workers with `onScanComplete` callback (SentinelScanner)
- Config persistence via `saveConfig()` for direct writes, `ConfigRepository` methods for listener-triggering writes
- Activity logging via `ActivityLog.logActivity()` with source parameter
- Per-error isolation: catch errors per-item (per-sentinel) so one failure doesn't abort all healing

### Integration Points
- `src/index.ts` — Wire `onScanComplete` callback when creating SentinelScanner (initial startup and reconnect handler)
- `src/sentinel/index.ts` — Export new healer module
- `src/log/index.ts` — May need new activity log method or source type for sentinel healing events

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

*Phase: 31-auto-healing-failure-handling*
*Context gathered: 2026-04-22*
