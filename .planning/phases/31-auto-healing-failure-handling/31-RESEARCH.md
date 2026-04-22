# Phase 31: Auto-Healing & Failure Handling - Research

**Researched:** 2026-04-22
**Domain:** IMAP sentinel healing, config mutation, failure notification
**Confidence:** HIGH

## Summary

This phase implements the reaction layer for the sentinel scanning system built in Phase 30. The scanner produces `ScanReport` objects via `onScanComplete` callback; this phase consumes those reports and takes healing or failure-handling actions. The three main scenarios are: (1) folder rename detected (sentinel found in different folder) -- update all config references and the sentinel store mapping; (2) sentinel missing but folder exists -- re-plant sentinel; (3) both sentinel and folder gone -- disable affected rules, notify user via INBOX message.

The codebase is well-prepared for this work. All needed primitives exist: `SentinelStore.updateFolderPath()`, `appendSentinel()` for re-planting, `saveConfig()` for direct persistence, `ImapClient.appendMessage()` for INBOX notifications, and `collectTrackedFolders()` for enumerating config folder references. The activity log needs a new method since the existing `logActivity()` is tightly coupled to `ActionResult`/`EmailMessage` types that don't fit healing events.

**Primary recommendation:** Create a `src/sentinel/healer.ts` module with a single `handleScanReport(report: ScanReport)` function that dispatches per-result to rename, re-plant, or failure handlers. Wire it as the `onScanComplete` callback in `src/index.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: On rename, update all config sources (rules action.folder, review.folder, review.defaultArchiveFolder, action folder paths)
- D-02: Use saveConfig() directly, do NOT fire ConfigRepository change listeners (no pipeline rebuilds)
- D-03: Update SentinelStore mapping via updateFolderPath(messageId, newPath)
- D-04: Process each rename independently, no batching
- D-05: On folder loss, APPEND notification to INBOX via ImapClient.appendMessage()
- D-06: Track notified folder losses to avoid re-notification; remove sentinel mapping after notification
- D-07: Do NOT auto-recreate deleted folders
- D-08: Set enabled: false on rules whose action.folder matches lost folder; persist via saveConfig()
- D-09: For review config references (review.folder, review.defaultArchiveFolder), log warning but do not disable
- D-10: For action folder paths, log warning but do not disable
- D-11: Re-plant sentinel when folder exists but sentinel is missing; update store with new Message-ID
- D-12: Re-planting logged to activity log but no INBOX notification
- D-13: Activity log entries with source type 'sentinel'
- D-14: Activity log entries include enough detail for user understanding
- D-15: Hook into SentinelScanner via onScanComplete callback
- D-16: Healer needs ConfigRepository, saveConfig, SentinelStore, ImapClient, ActivityLog, logger

### Claude's Discretion
- Internal module structure (single healer.ts vs split files)
- Folder existence check method (listMailboxes vs status call)
- Activity log entry format and detail level
- Whether to extract updateConfigWithoutListeners() helper or inline
- Test file organization and fixture design
- Type names for healing result reporting

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HEAL-01 | Config/rule references updated on rename | Config mutation via saveConfig(), collectTrackedFolders() for enumeration, direct in-memory updates |
| HEAL-02 | Atomic updates without pipeline rebuilds | saveConfig() bypasses ConfigRepository listeners; shared config object means in-memory reads see updates immediately |
| HEAL-03 | Re-plant missing sentinel when folder exists | appendSentinel() + SentinelStore.upsert() (via store param) already handles this |
| HEAL-04 | Activity log records all healing events | Needs new logSentinelEvent() method since existing logActivity() requires ActionResult/EmailMessage |
| FAIL-01 | Disable rules when folder lost | Set rule.enabled = false in config object, persist with saveConfig() |
| FAIL-02 | INBOX notification on folder loss | ImapClient.appendMessage() with plain-text RFC 2822 message |
| FAIL-03 | No auto-recreate of deleted folders | Verified as explicit decision D-07; healer never calls folder creation |
</phase_requirements>

## Standard Stack

No new dependencies needed. This phase uses only existing project infrastructure.

### Core (Existing)
| Library | Purpose | Why Used |
|---------|---------|----------|
| better-sqlite3 | SentinelStore, ActivityLog persistence | Already in use for all DB operations |
| imapflow (via ImapClient) | IMAP operations (folder checks, append, search) | Existing IMAP abstraction layer |
| pino | Structured logging | Project standard logger |
| vitest | Unit testing | Project standard test framework |

## Architecture Patterns

### Recommended Module Structure
```
src/sentinel/
  healer.ts          # Main handler: handleScanReport() + per-scenario handlers
  index.ts           # Extended barrel exports
```
[VERIFIED: codebase inspection]

Single file is sufficient. The healer has three code paths (rename, re-plant, folder-loss) but they share deps and are small enough to colocate. The scanner test file is ~570 lines for a similarly scoped module.

### Pattern 1: Dependency Injection via Interface
**What:** Pass all dependencies as a typed object, matching the project's established pattern (SentinelScannerDeps, etc.)
**When to use:** Always for the healer constructor/factory.
**Example:**
```typescript
// [VERIFIED: matches SentinelScannerDeps pattern in scanner.ts]
export interface SentinelHealerDeps {
  configRepo: ConfigRepository;
  configPath: string;           // For saveConfig() calls
  sentinelStore: SentinelStore;
  client: ImapClient;
  activityLog: ActivityLog;
  logger: pino.Logger;
}

export function createScanCompleteHandler(deps: SentinelHealerDeps): (report: ScanReport) => void {
  return (report: ScanReport) => {
    handleScanReport(report, deps).catch((err) => {
      deps.logger.error({ err }, 'Sentinel healer failed');
    });
  };
}
```

### Pattern 2: Config Mutation Without Listeners (HEAL-02 Critical Path)
**What:** Mutate the Config object in-memory, then persist via saveConfig() directly, bypassing ConfigRepository's update methods that fire change listeners.
**Why:** ConfigRepository.updateRule/updateReviewConfig/etc. fire listeners that trigger full pipeline rebuilds (Monitor restart, ActionFolderPoller restart, Sweeper restart). The healer must avoid this.
**Example:**
```typescript
// [VERIFIED: ConfigRepository shares config by reference via getConfig()]
const config = deps.configRepo.getConfig();

// Mutate in-memory (shared reference -- all readers see updates immediately)
for (const rule of config.rules) {
  if (rule.action.type === 'move' && rule.action.folder === oldPath) {
    rule.action.folder = newPath;
  }
}

// Persist to disk without firing listeners
saveConfig(deps.configPath, config);
```

### Pattern 3: Per-Item Error Isolation
**What:** Wrap each scan result handler in try/catch so one failure doesn't abort processing of other results.
**Example:**
```typescript
// [VERIFIED: matches scanner.ts deep scan pattern and lifecycle.ts reconcileSentinels pattern]
for (const result of report.results) {
  try {
    await handleResult(result, deps);
  } catch (err) {
    deps.logger.error({ err, messageId: result.messageId }, 'Failed to handle scan result');
    errors++;
  }
}
```

### Pattern 4: Folder Existence Check for Not-Found Disambiguation
**What:** When scanner reports `not-found`, the healer must distinguish "folder exists but sentinel deleted" from "folder is gone." Check folder existence via IMAP.
**Approach:** Use the `listMailboxes()` result that the scanner already fetched during deep scan. However, since the healer receives only the ScanReport (no folder list), it needs its own check.
```typescript
// [VERIFIED: ImapClient.listMailboxes() returns Array<{ path: string; flags: string[] }>]
async function folderExists(client: ImapClient, folderPath: string): Promise<boolean> {
  const mailboxes = await client.listMailboxes();
  return mailboxes.some(mb => mb.path === folderPath);
}
```
**Optimization:** Cache the folder list for the duration of one report processing (multiple not-found results share the same list).

### Anti-Patterns to Avoid
- **Using ConfigRepository update methods:** These fire change listeners and cause full pipeline rebuilds. Always use direct `saveConfig()` for healer mutations. [VERIFIED: repository.ts lines 86-157 show all update methods fire listeners]
- **Re-reading config from disk after save:** The in-memory Config object is shared by reference. After mutation + saveConfig(), all components already see the updated values.
- **Sending INBOX notification without dedup:** Must track notified losses to prevent re-notification every 5-minute scan cycle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RFC 2822 message formatting | Manual header construction | Minimal raw message string (no MIME library needed) | Notification is plain text only; a simple template suffices for APPEND |
| Folder path enumeration | Manual config traversal | `collectTrackedFolders(config)` from lifecycle.ts | Already handles all config sources (rules, review, action folders) |
| Sentinel re-planting | Manual message build + IMAP append | `appendSentinel(client, folder, purpose, store)` from imap-ops.ts | Handles message format, APPEND, and store upsert in one call |

## Common Pitfalls

### Pitfall 1: Config Mutation Race with User Edits
**What goes wrong:** User saves config via API at the same time healer is mutating and saving. One write overwrites the other.
**Why it happens:** saveConfig() does read-file -> merge-env-vars -> write-file atomically, but the in-memory config object could be stale relative to disk.
**How to avoid:** The ConfigRepository holds the single source of truth in memory. The healer mutates this same in-memory object and calls saveConfig() to persist. Since both paths (API and healer) operate on the same in-memory Config object, JavaScript's single-threaded event loop ensures no concurrent mutation. The risk is low but document the assumption.
**Warning signs:** Config changes appearing to revert after a healing event.

### Pitfall 2: Re-notification Loop
**What goes wrong:** Every 5-minute scan reports the same lost folder, generating duplicate INBOX notifications.
**Why it happens:** Not tracking which folder losses have already been notified.
**How to avoid:** Per D-06, track notified losses. Two options: (a) add a `notified_at` field to the sentinel record before deleting it, or (b) use the ActivityLog state table (`setState/getState`) to record notified folders. Option (b) is simpler since the sentinel record gets deleted after notification per D-06. Use a state key like `sentinel:notified:{folderPath}` with timestamp value.
**Warning signs:** Multiple identical notification emails in INBOX.

### Pitfall 3: Action Folder Path Construction
**What goes wrong:** When updating action folder references on rename, the path comparison must account for the prefix/folder construction (`{prefix}/{folderName}`).
**Why it happens:** Action folder paths in config are stored as logical names (e.g., "VIP Sender") under a prefix (e.g., "Actions"), but the actual IMAP path is `Actions/VIP Sender`. The rename scanner reports the full IMAP path.
**How to avoid:** Use `collectTrackedFolders()` to get the full constructed paths, then match against those. For config updates, need to reverse-engineer which config field maps to the renamed path. For action folders specifically, this means updating `actionFolders.prefix` if the parent was renamed, or the individual folder name if a leaf was renamed.
**Warning signs:** Action folder paths not getting updated after parent folder rename.

### Pitfall 4: Review Folder Special Handling
**What goes wrong:** Disabling review.folder on loss would break the entire review pipeline silently.
**Why it happens:** review.folder is a critical system path, not just a rule target.
**How to avoid:** Per D-09, log warning but don't disable review config references. The INBOX notification tells the user to fix it manually.

### Pitfall 5: Forgetting to Update Both Config and Store
**What goes wrong:** Config paths updated but sentinel store still maps to old folder, or vice versa.
**Why it happens:** Rename handling requires TWO updates: (1) config references and (2) sentinel store mapping.
**How to avoid:** Always call both `saveConfig()` and `sentinelStore.updateFolderPath()` in the rename handler. Consider doing store update first (it's simpler/faster) as a guard.

## Code Examples

### Rename Handler
```typescript
// [VERIFIED: all APIs confirmed from codebase inspection]
async function handleRename(
  result: FoundInDifferentFolder,
  deps: SentinelHealerDeps,
): Promise<void> {
  const oldPath = result.expectedFolder;
  const newPath = result.actualFolder;
  const config = deps.configRepo.getConfig();
  const affectedRules: string[] = [];

  // Update rules with move/review actions pointing to old path
  for (const rule of config.rules) {
    if (rule.action.folder === oldPath) {
      rule.action.folder = newPath;
      affectedRules.push(rule.name ?? rule.id);
    }
  }

  // Update review config references
  if (config.review.folder === oldPath) {
    config.review.folder = newPath;
  }
  if (config.review.defaultArchiveFolder === oldPath) {
    config.review.defaultArchiveFolder = newPath;
  }

  // Update action folder paths (reverse lookup: find which folder key produces oldPath)
  if (config.actionFolders.enabled) {
    const prefix = config.actionFolders.prefix;
    for (const [key, folderName] of Object.entries(config.actionFolders.folders)) {
      if (`${prefix}/${folderName}` === oldPath) {
        // Extract new folder name from new path
        const newFolderName = newPath.startsWith(prefix + '/')
          ? newPath.slice(prefix.length + 1)
          : newPath; // Fallback if prefix changed too
        (config.actionFolders.folders as Record<string, string>)[key] = newFolderName;
      }
    }
  }

  // Persist config without firing listeners (HEAL-02)
  saveConfig(deps.configPath, config);

  // Update sentinel store mapping (D-03)
  deps.sentinelStore.updateFolderPath(result.messageId, newPath);

  deps.logger.info({ oldPath, newPath, affectedRules }, 'Healed folder rename');
}
```

### INBOX Notification Message
```typescript
// [VERIFIED: ImapClient.appendMessage(folder, raw, flags) signature]
function buildNotificationMessage(folderPath: string, affectedRules: string[]): string {
  const messageId = `<sentinel-notify-${Date.now()}@mail-mgr>`;
  const date = new Date().toUTCString();
  const ruleList = affectedRules.length > 0
    ? `\nDisabled rules:\n${affectedRules.map(r => `  - ${r}`).join('\n')}`
    : '';

  return [
    `From: Mail Manager <noreply@mail-mgr.local>`,
    `To: undisclosed-recipients:;`,
    `Subject: [Mail Manager] Folder lost: ${folderPath}`,
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `The folder "${folderPath}" has been deleted or is no longer accessible.`,
    ``,
    `Mail Manager has automatically disabled rules that targeted this folder`,
    `to prevent further errors.${ruleList}`,
    ``,
    `To fix this:`,
    `  1. Recreate the folder, or`,
    `  2. Update your Mail Manager configuration to point to a different folder`,
    ``,
    `This is an automated message from Mail Manager.`,
  ].join('\r\n');
}

// Usage:
await deps.client.appendMessage('INBOX', raw, ['\\Seen']);
```

### Activity Log Extension
```typescript
// [VERIFIED: ActivityLog uses better-sqlite3, has migrate() pattern]
// New method on ActivityLog class:
logSentinelEvent(event: {
  action: string;          // 'rename-healed' | 'sentinel-replanted' | 'folder-lost'
  folder: string;
  details: string;         // JSON or human-readable detail string
}): void {
  // Use existing activity table with sentinel-specific fields:
  // message_uid=0 (no message), source='sentinel', action=event type
  this.db.prepare(`
    INSERT INTO activity (
      timestamp, message_uid, message_subject, action, folder, success, source
    ) VALUES (datetime('now'), 0, ?, ?, ?, 1, 'sentinel')
  `).run(event.details, event.action, event.folder);
}
```

**Note:** The existing `source` column allows values 'arrival' | 'sweep' | 'batch' | 'action-folder'. The TypeScript type needs to be extended to include 'sentinel'. The SQLite column has no CHECK constraint, so the DB accepts any string. [VERIFIED: migration adds source column as TEXT with default 'arrival', no enum constraint]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project standard) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/sentinel/healer.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HEAL-01 | Rename updates all config references (rules, review, action folders) | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "rename"` | No - Wave 0 |
| HEAL-02 | Updates do not fire config change listeners | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "no listeners"` | No - Wave 0 |
| HEAL-03 | Re-plant sentinel when folder exists but sentinel missing | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "replant"` | No - Wave 0 |
| HEAL-04 | All healing events logged to activity log | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "activity log"` | No - Wave 0 |
| FAIL-01 | Rules disabled when folder lost | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "disable"` | No - Wave 0 |
| FAIL-02 | INBOX notification on folder loss | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "notification"` | No - Wave 0 |
| FAIL-03 | No auto-recreate of deleted folders | unit | `npx vitest run test/unit/sentinel/healer.test.ts -t "no recreate"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/sentinel/healer.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `test/unit/sentinel/healer.test.ts` -- covers all HEAL-* and FAIL-* requirements
- [ ] Mock helpers for ConfigRepository, SentinelStore, ImapClient, ActivityLog (can reuse patterns from scanner.test.ts)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual folder rename via API/UI | Automatic sentinel-based detection + healing | v0.7 (this milestone) | Eliminates manual rename workflow entirely |
| Plan 25-04 folder rename propagation | Superseded by sentinel system | v0.7 planning | Old plan skipped in v0.6 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | JavaScript single-threaded event loop prevents config mutation races between healer and API | Common Pitfalls | LOW -- would need mutex/lock if concurrent mutation possible, but Node.js is single-threaded for sync operations |
| A2 | ActivityLog source column accepts arbitrary strings (no CHECK constraint) | Code Examples | LOW -- if constrained, migration needed; verified schema uses TEXT type |
| A3 | Notification dedup via ActivityLog state table (setState/getState) is adequate | Common Pitfalls | LOW -- alternative is sentinel record field, but record gets deleted |

## Open Questions

1. **Action folder prefix rename handling**
   - What we know: If a user renames the "Actions" parent folder, all action folder paths change. collectTrackedFolders builds paths as `{prefix}/{folderName}`.
   - What's unclear: Should the healer update `actionFolders.prefix` in config if the parent folder is renamed? This is an edge case where the renamed folder IS the prefix.
   - Recommendation: Handle it -- if old path starts with current prefix and the rename target has a different prefix, update `actionFolders.prefix`. Flag with a test case.

2. **onScanComplete callback is synchronous signature**
   - What we know: The callback type is `(report: ScanReport) => void` (sync). The healer needs to do async IMAP operations.
   - What's unclear: Whether to change the callback to async or fire-and-forget inside.
   - Recommendation: Use fire-and-forget with error catching (`.catch()`), matching the scanner's own pattern for initial scan. The callback wrapper handles this.

## Sources

### Primary (HIGH confidence)
- `src/sentinel/scanner.ts` -- ScanReport types, onScanComplete callback signature
- `src/sentinel/store.ts` -- SentinelStore.updateFolderPath(), deleteByMessageId()
- `src/sentinel/imap-ops.ts` -- appendSentinel() for re-planting
- `src/sentinel/lifecycle.ts` -- collectTrackedFolders() for config enumeration
- `src/config/repository.ts` -- ConfigRepository change listener pattern (what to avoid)
- `src/config/loader.ts` -- saveConfig() direct persistence function
- `src/config/schema.ts` -- Config type with all folder path locations
- `src/log/index.ts` -- ActivityLog.logActivity() signature (needs extension)
- `src/log/migrations.ts` -- Migration pattern for schema changes
- `src/index.ts` -- Scanner wiring points (lines 368-375 initial, lines 277-285 reconnect)
- `test/unit/sentinel/scanner.test.ts` -- Test patterns, mock helpers

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all primitives exist
- Architecture: HIGH -- clear integration point (onScanComplete), well-defined scenarios
- Pitfalls: HIGH -- enumerated from codebase analysis of config mutation paths

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (stable internal codebase, no external deps)
