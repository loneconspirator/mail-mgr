# Architecture Patterns

**Domain:** Sentinel message system for IMAP folder rename/deletion detection
**Researched:** 2026-04-21

## Recommended Architecture

### Overview

The sentinel system is a **cross-cutting tracking layer** that plants invisible IMAP messages into tracked folders, then periodically scans for them to detect folder renames and deletions. Unlike the existing pipelines (Monitor, Sweeper, ActionFolderPoller) which each own a specific folder domain, the sentinel system touches ALL folders referenced anywhere in config -- rule targets, review folder, action folder prefix, sweep destinations.

The system has three distinct responsibilities:
1. **Planting** -- APPEND sentinel messages into tracked folders
2. **Scanning** -- SEARCH for sentinels across all folders to detect renames
3. **Healing** -- Update config references and re-plant when renames/deletions detected

```
                     +------------------+
                     |    ImapClient     |  (shared, single connection)
                     +--------+---------+
                              |
         +--------------------+--------------------+
         |          |         |         |           |
  +------+------+  |  +------+------+  |  +--------+--------+
  |   Monitor   |  |  |   Sweeper   |  |  | ActionFolder    |
  | (IDLE/poll) |  |  | (periodic)  |  |  | Poller          |
  +-------------+  |  +-------------+  |  +-----------------+
                   |                   |
            +------+------+     +------+------+
            |  Sentinel   |     |  Sentinel   |
            |  Scanner    |     |  Store      |
            | (periodic   |     | (SQLite:    |
            |  SEARCH     |     |  message_id |
            |  across all |     |  -> folder  |
            |  folders)   |     |  + purpose) |
            +------+------+     +------+------+
                   |                   |
                   v                   v
            +------+-------------------+------+
            |       ConfigRepository          |
            |  (update folder refs on rename) |
            +------+--------------------------+
                   |
                   v
            +------+------+
            | ActivityLog |
            | (log heals, |
            |  notify on  |
            |  deletion)  |
            +--------------+
```

### Key Design Decision: Separate Timer, Not Piggyback on Existing Polls

The sentinel scanner runs on its own `setInterval` timer (recommended: every 5 minutes), NOT integrated into the Monitor's poll loop or the ActionFolderPoller. Rationale:

1. **Different cadence** -- Monitor polls for new INBOX mail (fast, event-driven via IDLE). Sentinel scanning is slow, infrequent, and scans ALL folders. Coupling them would either slow down mail processing or scan too frequently.
2. **Different IMAP operations** -- Monitor uses `fetch()` on INBOX. Sentinel uses `search()` across N folders. Completely different workloads.
3. **Independence** -- Sentinel scanning should work even if Monitor or ActionFolderPoller are stopped/rebuilding.

This follows the same pattern as ActionFolderPoller: a dedicated timer with its own `processing` guard.

## Component Boundaries

### New Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `SentinelStore` | `src/sentinel/store.ts` | SQLite table mapping Message-ID to folder path + purpose. CRUD operations. |
| `SentinelPlanter` | `src/sentinel/planter.ts` | Constructs RFC 822 sentinel messages, APPENDs to folders via ImapClient. Marks as `\Seen` to avoid unread noise. |
| `SentinelScanner` | `src/sentinel/scanner.ts` | Periodic timer. SEARCHes for sentinel header across all IMAP folders. Compares found locations to SentinelStore. Triggers healing. |
| `SentinelHealer` | `src/sentinel/healer.ts` | Updates ConfigRepository folder references when renames detected. Re-plants sentinels when deleted. Sends INBOX notification on folder deletion. |
| `SentinelManager` | `src/sentinel/index.ts` | Facade that wires Planter, Scanner, Store, Healer together. Exposes `start()`, `stop()`, `plantAll()`, `scan()`. |

### Existing Components Modified

| Component | Modification | Why |
|-----------|-------------|-----|
| `ImapClient` | Add `append()`, `search()`, `messageDelete()` methods wrapping ImapFlow | Sentinel needs APPEND to plant messages, SEARCH by header to find them, DELETE to clean up |
| `ImapFlowLike` interface | Add `append`, `search`, `messageDelete` to the interface | Type safety for the new ImapClient methods |
| `ActivityLog` / migrations | New `sentinel_mappings` table via migration | Persistent storage for sentinel Message-ID -> folder mappings |
| `ConfigRepository` | Add method to bulk-update folder references across all config sections | When a rename is detected, ALL references to old path must change atomically |
| `ensureActionFolders` | After creating folders, call `SentinelPlanter.plant()` for each | New action folders get sentinels immediately |
| `src/index.ts` | Wire up SentinelManager, pass to lifecycle hooks | Startup planting, periodic scanning, rebuild on IMAP reconnect |

### Components NOT Modified

| Component | Why Left Alone |
|-----------|---------------|
| Monitor | Does not interact with sentinels. Sentinels are marked `\Seen` and have no From address, so they won't match any rules. |
| ReviewSweeper | Sentinels in Review folder will be old+read, but sweep should skip them. Add sentinel Message-ID check OR use a custom flag. |
| ActionFolderProcessor | Action folders should always be empty. If a sentinel somehow ends up being "processed," the lack of From header means extraction fails gracefully. |

## Data Model

### sentinel_mappings Table (SQLite, via migration)

```sql
CREATE TABLE sentinel_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,     -- RFC 822 Message-ID of sentinel
  folder_path TEXT NOT NULL,           -- Current known folder path
  purpose TEXT NOT NULL,               -- 'rule_target', 'review', 'action_prefix', 'sweep_default', 'trash'
  config_key TEXT,                     -- JSON path into config for this ref, e.g. 'review.folder' or 'rules[uuid].action.folder'
  planted_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,                   -- Updated each scan when sentinel found
  status TEXT NOT NULL DEFAULT 'active' -- 'active', 'missing', 'orphaned'
);
CREATE INDEX idx_sentinel_message_id ON sentinel_mappings(message_id);
CREATE INDEX idx_sentinel_folder ON sentinel_mappings(folder_path);
CREATE INDEX idx_sentinel_status ON sentinel_mappings(status);
```

**Purpose values and their config locations:**

| Purpose | Config Key Pattern | Example |
|---------|-------------------|---------|
| `rule_target` | `rules[{id}].action.folder` | `rules[abc-123].action.folder = "Receipts"` |
| `review` | `review.folder` | `review.folder = "Review"` |
| `review_archive` | `review.defaultArchiveFolder` | `review.defaultArchiveFolder = "MailingLists"` |
| `trash` | `review.trashFolder` | `review.trashFolder = "Trash"` |
| `action_prefix` | `actionFolders.prefix` | `actionFolders.prefix = "Actions"` |

### Sentinel Message Format

```
From: sentinel@mail-mgr.local
To: sentinel@mail-mgr.local
Subject: [mail-mgr sentinel] Do not delete
Date: {RFC 2822 date}
Message-ID: <sentinel-{uuid}@mail-mgr.local>
X-Mail-Mgr-Sentinel: {uuid}
X-Mail-Mgr-Version: 1
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

This message is a tracking sentinel planted by mail-mgr.
It is used to detect folder renames and deletions.
Do not delete this message. If you move it, mail-mgr will
detect the folder rename and update its configuration.
```

**Key design choices:**
- `X-Mail-Mgr-Sentinel` custom header with a UUID -- this is what SEARCH looks for
- Marked `\Seen` on APPEND so it doesn't show as unread
- Human-readable body explaining its purpose (in case user sees it)
- `Message-ID` uses a sentinel-prefixed UUID for uniqueness and identifiability
- The UUID in the header matches the UUID in Message-ID for cross-referencing

## Data Flow

### Planting Flow (Startup + On Folder Creation)

```
1. Collect all tracked folders from config:
   - review.folder
   - review.defaultArchiveFolder
   - review.trashFolder
   - All unique rule action.folder values (where action.type === 'move' or 'review')
   - actionFolders.prefix (plant in the prefix folder itself)

2. For each folder:
   a. Check SentinelStore -- does an active sentinel already exist for this folder?
   b. YES: Skip (already planted)
   c. NO: Generate UUID, build RFC 822 message, APPEND to folder with \Seen flag
   d. Store Message-ID -> folder mapping in SentinelStore

3. De-duplicate: Multiple rules targeting the same folder share ONE sentinel
```

### Scanning Flow (Periodic, every 5 minutes)

```
1. Get all IMAP folders via listMailboxes()
2. For each folder:
   a. SEARCH for messages with header X-Mail-Mgr-Sentinel (existence check)
   b. If found: FETCH the X-Mail-Mgr-Sentinel header value to get the UUID
   c. Look up UUID in SentinelStore
   d. Compare found folder path vs stored folder path

3. Three outcomes per sentinel:
   SAME FOLDER  -> Update last_seen_at, continue
   DIFFERENT FOLDER -> RENAME DETECTED: trigger healing
   NOT FOUND ANYWHERE -> DELETION or sentinel deleted: trigger re-plant or notify
```

**Critical optimization:** Don't search every folder on every scan. Use a two-phase approach:
1. First, search ONLY the folders where sentinels are expected (from SentinelStore)
2. If any sentinel is missing from its expected folder, THEN do a broader search across all folders

This keeps the common case (nothing changed) to N SEARCH commands where N is the number of tracked folders, rather than scanning every folder in the account.

### Healing Flow (On Rename Detection)

```
1. Sentinel found in folder "NewReceipts" but SentinelStore says "Receipts"
2. SentinelHealer:
   a. Look up all config references to "Receipts" via SentinelStore.config_key
   b. Call ConfigRepository.updateFolderReferences("Receipts", "NewReceipts")
      - This updates rules, review config, action folder config as needed
   c. Update SentinelStore: folder_path = "NewReceipts"
   d. Log activity: "Folder renamed: Receipts -> NewReceipts (auto-healed)"
   e. FolderCache.refresh() to pick up new folder list
```

### Re-Plant Flow (On Sentinel Deletion)

```
1. Sentinel not found in expected folder OR anywhere
2. Check: Does the expected folder still exist? (via status())
   a. YES, folder exists but sentinel gone:
      - User deleted the sentinel message
      - Re-plant a new sentinel, update SentinelStore with new Message-ID
      - Log: "Re-planted sentinel in {folder} (previous sentinel was deleted)"
   b. NO, folder does not exist:
      - Check all folders (broader search) -- maybe it was renamed AND sentinel deleted
      - If still not found: folder is truly gone
      - Mark sentinel as 'orphaned' in SentinelStore
      - Send notification to INBOX (APPEND a notification message)
      - Log: "Folder deleted: {folder} -- sentinel lost, notification sent"
```

### INBOX Notification Format (On Folder Deletion)

```
From: mail-mgr@localhost
To: {user's email}
Subject: [mail-mgr] Folder deleted: {folder_path}
Date: {RFC 2822 date}
Message-ID: <notification-{uuid}@mail-mgr.local>
Content-Type: text/plain; charset=utf-8

mail-mgr detected that the folder "{folder_path}" no longer exists.

This folder was referenced by:
- {list of config references}

These references have been disabled. Please update your configuration
to point to a new folder, or recreate the original folder.
```

## Integration with IMAP Connection Sharing

The sentinel system shares the single ImapClient like everything else. Key considerations:

### Connection Contention

All IMAP operations go through the single ImapFlow connection. The sentinel scanner runs SEARCH commands that briefly lock the connection (via `withMailboxLock` or direct `search()` calls). This could block Monitor's `fetchNewMessages` or ActionFolderPoller's `status()` checks.

**Mitigation:**
- Sentinel scans run every 5 minutes (infrequent)
- Each SEARCH is fast (header-only search, no body scanning)
- Scanner yields between folders (process one folder at a time, release lock)
- ImapFlow internally queues commands, so there's no deadlock risk -- just queuing delay

### New ImapClient Methods Needed

```typescript
// Add to ImapClient class:

/** Append a message to the specified folder. Returns the UID if available. */
async append(folder: string, content: string | Buffer, flags?: string[]): Promise<{ uid?: number }> {
  if (!this.flow) throw new Error('Not connected');
  return await this.flow.append(folder, content, flags ?? []);
}

/** Search for messages matching criteria in the specified folder. Returns UIDs. */
async search(folder: string, criteria: Record<string, unknown>): Promise<number[]> {
  return this.withMailboxLock(folder, async (flow) => {
    const results = await flow.search(criteria, { uid: true });
    return results as number[];
  });
}

/** Delete messages by UID in the specified folder. */
async deleteMessages(folder: string, uids: number[]): Promise<void> {
  await this.withMailboxLock(folder, async (flow) => {
    await flow.messageDelete(uids.join(','), { uid: true });
  });
}
```

### ImapFlowLike Interface Additions

```typescript
// Add to ImapFlowLike interface:
append(path: string, content: string | Buffer, flags?: string[], idate?: Date): Promise<unknown>;
search(criteria: Record<string, unknown>, options?: { uid?: boolean }): Promise<number[]>;
messageDelete(range: string | number[], options?: { uid?: boolean }): Promise<boolean>;
```

## Integration with ensureActionFolders

When action folders are created on startup, sentinels should be planted immediately after. The integration point is in `src/index.ts`:

```
Current flow:
  ensureActionFolders() -> actionFolderPoller.scanAll() -> monitor.start()

New flow:
  ensureActionFolders() -> sentinelManager.plantAll() -> actionFolderPoller.scanAll() -> monitor.start()
```

`plantAll()` is idempotent -- it checks SentinelStore before planting. So it's safe to call on every startup. It plants sentinels in ALL tracked folders, not just action folders.

## Integration with ConfigRepository for Folder Reference Updates

### New Method: updateFolderReferences

```typescript
// Add to ConfigRepository:
async updateFolderReferences(oldPath: string, newPath: string): Promise<string[]> {
  const changes: string[] = [];

  // 1. Review folder
  if (this.config.review.folder === oldPath) {
    this.config.review.folder = newPath;
    changes.push('review.folder');
  }

  // 2. Default archive folder
  if (this.config.review.defaultArchiveFolder === oldPath) {
    this.config.review.defaultArchiveFolder = newPath;
    changes.push('review.defaultArchiveFolder');
  }

  // 3. Trash folder
  if (this.config.review.trashFolder === oldPath) {
    this.config.review.trashFolder = newPath;
    changes.push('review.trashFolder');
  }

  // 4. Rule move/review targets
  for (const rule of this.config.rules) {
    if (rule.action.type === 'move' && rule.action.folder === oldPath) {
      rule.action.folder = newPath;
      changes.push(`rules[${rule.id}].action.folder`);
    }
    if (rule.action.type === 'review' && rule.action.folder === oldPath) {
      rule.action.folder = newPath;
      changes.push(`rules[${rule.id}].action.folder`);
    }
  }

  // 5. Action folder prefix
  if (this.config.actionFolders.prefix === oldPath) {
    this.config.actionFolders.prefix = newPath;
    changes.push('actionFolders.prefix');
  }

  if (changes.length > 0) {
    this.persist();
    // Notify listeners so running components pick up changes
    this.notifyRulesChange();
    // NOTE: Do NOT fire onReviewConfigChange or onActionFolderConfigChange
    // because those trigger full rebuilds. The sentinel healer handles
    // the update surgically -- only the path changed, not the structure.
  }

  return changes;
}
```

**Critical concern:** The existing config change listeners (`onReviewConfigChange`, `onActionFolderConfigChange`) tear down and rebuild entire pipelines. A sentinel-triggered rename should NOT trigger those full rebuilds. The `updateFolderReferences` method persists the change but only fires `notifyRulesChange` (lightweight) -- the running Sweeper, Monitor, etc. will pick up the new paths on their next cycle naturally since they read from config.

## Patterns to Follow

### Pattern 1: Idempotent Planting

**What:** Every call to `plantAll()` checks SentinelStore before planting. If a sentinel already exists for a folder, skip it. If a sentinel exists but the folder no longer needs tracking, mark it orphaned.

**When:** Startup, after folder creation, after config changes.

**Why:** The system may restart, reconnect, or have config changes at any time. Planting must be safe to repeat.

### Pattern 2: Two-Phase Scan

**What:** First check expected locations (fast path). Only broaden search if something is missing.

**When:** Every scan cycle.

**Why:** An account may have hundreds of folders. Searching them all when nothing has changed is wasteful. The fast path checks only N tracked folders where N is typically 5-15.

### Pattern 3: Defensive Sentinel Identification

**What:** Use both the custom header (`X-Mail-Mgr-Sentinel`) AND the Message-ID pattern (`sentinel-*@mail-mgr.local`) for identification. The header is for IMAP SEARCH (server-side). The Message-ID is for cross-referencing with the SQLite store.

**When:** Scanning and healing.

**Why:** Some IMAP servers may not support header search perfectly. Having two identification methods provides a fallback. Also prevents collision with user messages.

### Pattern 4: Processing Guard (Same as ActionFolderPoller)

**What:** `SentinelScanner` uses a `processing` boolean guard to prevent concurrent scans, identical to `ActionFolderPoller.scanAll()`.

**When:** Scan timer fires while a previous scan is still running.

**Why:** IMAP operations are slow. A 5-minute scan interval with many folders could overlap.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Scanning Inside Monitor's Poll Loop

**What:** Adding sentinel search into the Monitor's `processNewMessages` or the IDLE cycle.

**Why bad:** Monitor is latency-sensitive for mail delivery. Adding SEARCH commands for N folders would add seconds of latency to every mail check. Also, Monitor only watches INBOX -- sentinels are in arbitrary folders.

**Instead:** Dedicated timer with its own cadence.

### Anti-Pattern 2: Firing Full Config Rebuild on Rename

**What:** Calling `updateReviewConfig()` or `updateActionFolderConfig()` to propagate a rename.

**Why bad:** Those methods trigger `onReviewConfigChange` / `onActionFolderConfigChange` listeners which tear down and rebuild Sweeper, ActionFolderPoller, etc. A simple path rename doesn't require full reconstruction.

**Instead:** Direct config mutation + persist + lightweight notification. Running components read paths from config on each cycle.

### Anti-Pattern 3: One Sentinel Per Config Reference

**What:** Planting separate sentinels for every config reference to the same folder (e.g., 5 rules targeting "Receipts" = 5 sentinels in "Receipts").

**Why bad:** Wastes messages, makes scanning slower, and folder rename produces 5 identical healing operations.

**Instead:** One sentinel per unique folder path. The SentinelStore tracks which config keys reference that folder.

### Anti-Pattern 4: Relying on UID Stability Across Sessions

**What:** Storing the UID of planted sentinels and using it to find them later.

**Why bad:** UIDs can change on IMAP server compaction, migration, or when UIDVALIDITY changes. The sentinel could get a new UID.

**Instead:** Use SEARCH by header on every scan. Message-ID is the stable identifier, not UID.

## Build Order

Based on dependency analysis, build in this order:

### Phase 1: Foundation (no IMAP needed)

1. **SentinelStore** -- SQLite table + CRUD. No external dependencies beyond `better-sqlite3`. Can be fully unit tested.
2. **Sentinel message builder** -- Pure function that generates RFC 822 message string from UUID. No I/O, fully unit testable.

### Phase 2: IMAP Capabilities

3. **ImapClient additions** -- Add `append()`, `search()`, `messageDelete()` methods. Add to `ImapFlowLike` interface. Integration-testable with mock ImapFlow.

### Phase 3: Planting

4. **SentinelPlanter** -- Depends on ImapClient.append() and SentinelStore. Collects tracked folders from config, deduplicates, plants, records.

### Phase 4: Scanning

5. **SentinelScanner** -- Depends on ImapClient.search(), SentinelStore, and folder listing. Implements two-phase scan. Detects renames and deletions.

### Phase 5: Healing

6. **ConfigRepository.updateFolderReferences()** -- Surgical config update method.
7. **SentinelHealer** -- Depends on Scanner output, ConfigRepository, ImapClient (for re-planting and notifications). Orchestrates the response to detected changes.

### Phase 6: Integration

8. **SentinelManager facade** -- Wires everything together, exposes `start()`/`stop()`/`plantAll()`.
9. **Startup integration** -- Wire into `src/index.ts` lifecycle: plant on startup, start scanner, rebuild on IMAP reconnect, handle config changes.

### Phase 7: Sweeper Guard

10. **ReviewSweeper sentinel exclusion** -- Ensure sweeper skips sentinel messages in Review folder. Simplest approach: check if message has `X-Mail-Mgr-Sentinel` header before sweeping.

### Phase 8: UI Cleanup

11. **Remove folder rename card** from settings page -- The sentinel system replaces manual folder rename management.

## Scalability Considerations

| Concern | 5 tracked folders | 50 tracked folders | 200+ tracked folders |
|---------|-------------------|--------------------|----------------------|
| Scan time (fast path) | ~1s (5 SEARCH) | ~10s (50 SEARCH) | ~40s (serialize, stagger) |
| Sentinel messages | 5 messages total | 50 messages total | Consider batching scans |
| IMAP contention | Negligible | Moderate (10s lock) | Must yield between folders |
| SQLite queries | Trivial | Trivial | Still trivial (indexed) |

For this personal-use single-instance app, even 50 tracked folders is unlikely. The two-phase scan optimization keeps the common case fast.

## Sources

- [ImapFlow documentation](https://imapflow.com/docs/) -- APPEND, SEARCH, messageDelete APIs
- [ImapFlow search guide](https://imapflow.com/docs/guides/searching/) -- Header search syntax: `{ header: { 'X-Custom': true } }`
- [ImapFlow message operations](https://deepwiki.com/postalsys/imapflow/5-message-operations) -- append() signature: `append(path, content, flags, idate)`
- Existing codebase: `src/imap/client.ts`, `src/action-folders/poller.ts`, `src/config/repository.ts`, `src/index.ts`
