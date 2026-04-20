# Architecture Patterns

**Domain:** Action folder integration into existing IMAP email management system
**Researched:** 2026-04-20

## Recommended Architecture

### Overview

Action folders are a **new processing pipeline** that sits alongside the existing Monitor (arrival routing) and Sweep (review lifecycle) pipelines. They share the IMAP client, rule service (ConfigRepository), and activity log, but have their own dedicated processor with a distinct processing model: extract sender from message, create/remove a rule, move message to its final destination.

The recommended approach is **Option B from the PRD: a dedicated ActionFolderProcessor** with its own poll timer, not piggybacked on MoveTracker or the Monitor's IDLE loop. The reasoning is architectural clarity and the fact that IMAP IDLE only watches one mailbox at a time (ImapFlow opens INBOX for IDLE). Action folders need polling anyway.

```
                     +------------------+
                     |    ImapClient     |  (shared, single connection)
                     +--------+---------+
                              |
            +-----------------+------------------+
            |                 |                  |
     +------+------+  +------+------+  +--------+--------+
     |   Monitor   |  |   Sweeper   |  | ActionFolder    |
     | (IDLE/poll  |  | (periodic   |  | Processor       |
     |  on INBOX)  |  |  on Review) |  | (poll Actions/*)|
     +------+------+  +------+------+  +--------+--------+
            |                 |                  |
            v                 v                  v
     +------+------+  +------+------+  +--------+--------+
     | evaluateRules| | sweepResolve|  | ActionRegistry  |
     | executeAction| | moveMessage |  | (lookup action, |
     +------+------+  +------+------+  |  create/remove  |
            |                 |        |  rule, move msg) |
            |                 |        +--------+--------+
            |                 |                  |
            +--------+--------+------------------+
                     |
              +------+------+
              | ActivityLog  |  (shared, source='action-folder')
              +------+------+
              | ConfigRepo   |  (shared, addRule/deleteRule)
              +-------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | New/Modified |
|-----------|---------------|-------------------|--------------|
| `ActionFolderProcessor` | Poll action folders, process messages, orchestrate rule ops + message moves | ImapClient, ActionRegistry, ConfigRepository, ActivityLog | **NEW** |
| `ActionRegistry` | Define action types (vip, block, undoVip, unblock) with folder name, processing function, message destination | ConfigRepository (for rule CRUD) | **NEW** |
| `ActionFolderConfig` (Zod schema) | Validate `actionFolders` config section (enabled, prefix, folder names) | Config schema | **MODIFIED** (schema.ts) |
| `ConfigRepository` | Rule CRUD (addRule, deleteRule already exist) | Persists to config file | **MODIFIED** (add `findSenderRule` helper) |
| `ActivityLog` | Log action-folder operations | SQLite | **MODIFIED** (extend source type) |
| `ImapClient` | Folder creation on startup, message fetch from action folders, message move | IMAP server | **EXISTING** (no changes needed -- createMailbox and withMailboxLock already exist) |
| `src/index.ts` (main) | Wire up ActionFolderProcessor, run startup folder creation and recovery processing | All components | **MODIFIED** |
| `isSenderOnly` predicate | Already in dispositions.ts, reusable for finding matching sender rules | N/A | **EXISTING** (extract to shared util) |

### Data Flow

**Happy path: User moves message to `Actions/VIP Sender`**

```
1. ActionFolderProcessor poll fires
2. Fetch messages from "Actions/VIP Sender" folder (withMailboxLock)
3. For each message:
   a. Extract sender from envelope From header -> normalize to lowercase bare address
   b. Look up action type from ActionRegistry by folder path -> "vip"
   c. Registry says: { ruleAction: 'skip', destination: defaultArchiveFolder }
   d. Check for existing sender-only skip rule with same sender glob (idempotency)
   e. If no existing rule: ConfigRepository.addRule({ match: { sender: addr }, action: { type: 'skip' }, name: 'VIP: sender@example.com', order: nextOrder() })
   f. Move message from "Actions/VIP Sender" to defaultArchiveFolder
   g. Log to ActivityLog with source='action-folder'
4. Folder is now empty
```

**Undo path: User moves message to `Actions/Undo VIP`**

```
1-3a. Same as above
   b. Registry says: { undoAction: 'skip', destination: defaultArchiveFolder }
   c. Find existing sender-only skip rule for this sender
   d. If found: ConfigRepository.deleteRule(rule.id)
   e. Move message to defaultArchiveFolder (regardless of whether rule existed)
   f. Log to ActivityLog
```

**Error path: No parseable From address**

```
1-3a. From header missing or malformed
   b. Log error with message details
   c. Move message to INBOX (safe fallback)
   d. Do NOT leave message in action folder
```

**Startup recovery path:**

```
1. After IMAP connect, before starting normal monitoring
2. For each action folder: fetch all messages
3. Process each message through normal action folder pipeline
4. Idempotency ensures no duplicate rules if crash was mid-processing
5. Then start normal poll timer
```

## New Components Detail

### ActionRegistry

A static registry mapping action type keys to their behavior. Use a plain object/Map, not a class hierarchy.

```typescript
interface ActionDefinition {
  folderSuffix: string;           // e.g., "VIP Sender"
  mode: 'create' | 'remove';     // create rule or remove rule
  ruleActionType: 'skip' | 'delete'; // the rule action type to create/find
  getDestination: (ctx: ActionContext) => string; // where to move the message after
  namePrefix: string;             // e.g., "VIP" -> "VIP: sender@example.com"
}

// Registry is a Map<string, ActionDefinition> keyed by action type id
const DEFAULT_ACTIONS: Record<string, ActionDefinition> = {
  vip: {
    folderSuffix: 'VIP Sender',
    mode: 'create',
    ruleActionType: 'skip',
    getDestination: (ctx) => ctx.defaultArchiveFolder,
    namePrefix: 'VIP',
  },
  block: {
    folderSuffix: 'Block Sender',
    mode: 'create',
    ruleActionType: 'delete',
    getDestination: (ctx) => ctx.trashFolder,
    namePrefix: 'Block',
  },
  undoVip: {
    folderSuffix: 'Undo VIP',
    mode: 'remove',
    ruleActionType: 'skip',
    getDestination: (ctx) => ctx.defaultArchiveFolder,
    namePrefix: 'Undo VIP',
  },
  unblock: {
    folderSuffix: 'Unblock Sender',
    mode: 'remove',
    ruleActionType: 'delete',
    getDestination: (ctx) => 'INBOX',
    namePrefix: 'Unblock',
  },
};
```

This is extensible: adding `Actions/Route to Review` in a future milestone means adding one entry to the registry.

### ActionFolderProcessor

```typescript
interface ActionFolderProcessorDeps {
  imapClient: ImapClient;
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  registry: ActionRegistry;
  config: ActionFolderConfig;  // prefix, folder names, poll interval
  trashFolder: string;
  defaultArchiveFolder: string;
  logger: pino.Logger;
}
```

Key design decisions:
- **Own poll timer** (not shared with MoveTracker). Default interval: 15 seconds for responsiveness. Configurable.
- **Serialized processing** (same `processing` guard as Monitor). One poll at a time.
- **Per-message error isolation** (same pattern as Monitor: try/catch per message, log error, continue to next).
- **Folder-path-to-action lookup**: Build a Map from full folder path (e.g., `Actions/VIP Sender`) to ActionDefinition on construction. Rebuilt on config change.

### Config Schema Addition

```typescript
const actionFolderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).default('Actions'),
  pollInterval: z.number().int().positive().default(15),  // seconds
  folders: z.object({
    vip: z.string().min(1).default('VIP Sender'),
    block: z.string().min(1).default('Block Sender'),
    undoVip: z.string().min(1).default('Undo VIP'),
    unblock: z.string().min(1).default('Unblock Sender'),
  }).default({}),
});

// Added to configSchema:
export const configSchema = z.object({
  imap: imapConfigSchema,
  server: serverConfigSchema,
  rules: z.array(ruleSchema).default([]),
  review: reviewConfigSchema.default(reviewDefaults),
  actionFolders: actionFolderConfigSchema.default({}),  // NEW
});
```

### ConfigRepository Addition: findSenderRule

The disposition routes already filter sender-only rules by action type. Action folder processing needs the same query but for a specific sender. Add to ConfigRepository:

```typescript
findSenderRule(sender: string, actionType: string): Rule | undefined {
  return this.config.rules.find(r =>
    isSenderOnly(r) &&
    r.enabled &&
    r.action.type === actionType &&
    r.match.sender?.toLowerCase() === sender.toLowerCase()
  );
}
```

This reuses the `isSenderOnly` predicate from `dispositions.ts`. Extract `isSenderOnly` to a shared location (e.g., `src/rules/predicates.ts`) so both dispositions routes and ConfigRepository can import it without a circular dependency.

### ActivityLog Source Extension

The `logActivity` method currently types `source` as `'arrival' | 'sweep' | 'batch'`. Extend to include `'action-folder'`:

```typescript
logActivity(result: ActionResult, message: EmailMessage, rule: Rule | null,
  source: 'arrival' | 'sweep' | 'batch' | 'action-folder' = 'arrival'): void
```

Also update `isSystemMove` to include `'action-folder'` in the source list, since action folder moves are system-initiated (the MoveTracker should not re-detect them as user moves).

### MoveTracker Exclusion

The MoveTracker watches INBOX + Review for user-initiated moves. Action folders introduce system-initiated moves *from* action folders. Two concerns:

1. **Messages disappearing from action folders**: MoveTracker doesn't watch action folders, so this is not an issue by default. Do NOT add action folders to MoveTracker's scan list.
2. **Messages appearing in INBOX** (from Unblock Sender) or archive folders (from VIP/Undo): These are system moves. The `isSystemMove` check already covers this as long as we log with `source='action-folder'` and include `'action-folder'` in the system source list.

## Patterns to Follow

### Pattern 1: Per-Message Error Isolation
**What:** Wrap each message's processing in try/catch, log error, continue to next message.
**When:** All message processing loops (Monitor, Sweep, ActionFolderProcessor).
**Why:** One malformed message must not block processing of remaining messages.
**Example:** Already implemented in Monitor.processNewMessages and ReviewSweeper.runSweep.

### Pattern 2: Serialized Processing Guard
**What:** Boolean `processing` flag that skips re-entrant calls.
**When:** Any async processing triggered by timer/event that could overlap.
**Example:** Monitor's `if (this.processing) return;` pattern.

### Pattern 3: Getter Functions for Hot-Swappable Components
**What:** Pass `() => component` getters to the web server, not direct references.
**When:** Components that get rebuilt on config change (Monitor, Sweeper, BatchEngine, now ActionFolderProcessor).
**Example:** `getActionFolderProcessor: () => actionFolderProcessor` in buildServer deps.

### Pattern 4: ConfigRepository as Single Source of Truth for Rules
**What:** All rule mutations go through ConfigRepository (addRule, deleteRule, updateRule).
**When:** Always. Action folder processing MUST use ConfigRepository, not direct config file writes.
**Why:** ConfigRepository notifies listeners (Monitor.updateRules, Sweeper.updateRules, BatchEngine.updateRules). Bypassing it breaks rule propagation.

### Pattern 5: Startup Recovery Before Normal Loop
**What:** Process any pending items before starting the periodic timer.
**When:** ActionFolderProcessor.start() -- process existing messages in action folders, then begin polling.
**Example:** Similar to Monitor.start() which runs processNewMessages on connect before relying on IDLE.

## Anti-Patterns to Avoid

### Anti-Pattern 1: IDLE for Action Folders
**What:** Trying to use IMAP IDLE to watch action folders for instant response.
**Why bad:** ImapFlow's IDLE watches one mailbox at a time (currently INBOX). Switching mailboxes for IDLE breaks the Monitor's INBOX watching. Would require multiple IMAP connections.
**Instead:** Poll action folders on a short interval (15s default). The user won't notice the difference between instant and 15-second response.

### Anti-Pattern 2: Piggybacking on MoveTracker
**What:** Adding action folders to MoveTracker's scan list and detecting "moves to action folders" as signals.
**Why bad:** MoveTracker is designed for detecting user move patterns for rule proposals. Action folder processing is a fundamentally different pipeline -- it needs to read message content, create/remove rules, and move messages. MoveTracker would need massive refactoring to handle this.
**Instead:** Dedicated ActionFolderProcessor with its own poll cycle.

### Anti-Pattern 3: Direct IMAP Folder Monitoring in Monitor Class
**What:** Extending Monitor.processNewMessages to also check action folders.
**Why bad:** Monitor is tightly coupled to INBOX UID tracking (lastUid, cursor persistence). Action folders have different semantics -- process ALL messages, not just "new since last UID". Monitor would need significant refactoring.
**Instead:** Separate ActionFolderProcessor class with its own simpler logic: fetch all messages in folder, process, move out.

### Anti-Pattern 4: Storing Action Folder State in SQLite
**What:** Tracking which action folder messages have been processed via a database table.
**Why bad:** Unnecessary complexity. The "state" of action folder processing is the folder itself -- if the folder is empty, processing is complete. No cursor or UID tracking needed.
**Instead:** Every poll: fetch all messages in each action folder, process them, move them out. If folder is empty, the poll is a no-op.

### Anti-Pattern 5: Creating a New IMAP Connection for Action Folders
**What:** Separate ImapClient instance for action folder polling.
**Why bad:** Doubles connection count to IMAP server, which may have connection limits. Adds complexity for connection lifecycle management.
**Instead:** Share the existing ImapClient. Use `withMailboxLock` to temporarily access action folders (already proven with Sweep and BatchEngine).

## Integration Points with Existing Code

### Modifications Required

| File | Change | Reason |
|------|--------|--------|
| `src/config/schema.ts` | Add `actionFolderConfigSchema`, add to `configSchema` | Config for action folder feature |
| `src/config/repository.ts` | Add `findSenderRule()` method | Idempotent rule lookup for action processing |
| `src/log/index.ts` | Extend `source` union type to include `'action-folder'`, update `isSystemMove` | Activity logging and MoveTracker exclusion |
| `src/web/routes/dispositions.ts` | Extract `isSenderOnly` to shared location | Reuse in ConfigRepository without circular dep |
| `src/index.ts` | Wire up ActionFolderProcessor, add startup recovery, add to config change handlers | Lifecycle management |

### New Files Required

| File | Purpose |
|------|---------|
| `src/action-folders/registry.ts` | ActionDefinition type and default action registry |
| `src/action-folders/processor.ts` | ActionFolderProcessor class (poll, process, move) |
| `src/action-folders/index.ts` | Re-exports |
| `src/rules/predicates.ts` | Extracted `isSenderOnly` and new `findSenderRule` |

### Files That Need No Changes

| File | Why |
|------|-----|
| `src/imap/client.ts` | `createMailbox`, `withMailboxLock`, `moveMessage` already exist |
| `src/monitor/index.ts` | Action folders are a separate pipeline |
| `src/tracking/index.ts` | MoveTracker doesn't watch action folders |
| `src/sweep/index.ts` | Sweep is independent |
| `src/batch/index.ts` | Batch is independent |
| `src/web/routes/rules.ts` | Rules created via action folders appear automatically |
| `src/web/routes/dispositions.ts` | Disposition views query rules -- action folder rules appear automatically |

## Suggested Build Order

Build order respects dependencies -- each phase can be tested before moving to the next.

| Phase | What | Dependencies | Testable? |
|-------|------|-------------|-----------|
| 1 | Config schema (`actionFolderConfigSchema`) | None | Yes -- Zod validation tests |
| 2 | Extract `isSenderOnly` to `src/rules/predicates.ts`, add `findSenderRule` | Existing rules | Yes -- unit tests against rule arrays |
| 3 | ActionRegistry (types + default actions map) | Config schema (for folder names) | Yes -- pure data, unit testable |
| 4 | Extend ActivityLog source type + `isSystemMove` | None | Yes -- existing test patterns |
| 5 | Folder creation on startup (create Actions/* folders via ImapClient.createMailbox) | Config schema, ImapClient | Yes -- integration test with mock ImapClient |
| 6 | ActionFolderProcessor core (poll, fetch, process single message, move) | Registry, predicates, ActivityLog, ConfigRepo, ImapClient | Yes -- integration tests with mock deps |
| 7 | Startup recovery (process pending messages before starting poll) | Processor | Yes -- test with pre-populated action folders |
| 8 | Wire into src/index.ts (lifecycle, config change handlers, getter for web server) | All above | Manual/integration testing |
| 9 | Idempotency hardening + edge cases (no From header, duplicate rules, crash recovery) | Processor | Yes -- targeted unit tests |

**Phase ordering rationale:** Config schema first because everything depends on it. Predicates next because the processor needs them. Registry is pure data. ActivityLog extension is a one-line change but needed before processor can log. Folder creation is a prerequisite for the processor (folders must exist). Processor is the core feature. Startup recovery is an extension of the processor. Wiring is last because it depends on everything. Idempotency is last because it hardens what already works.

## Scalability Considerations

| Concern | Expected Load | Approach |
|---------|--------------|----------|
| Poll frequency | 4 folders every 15s | Each poll is 4 folder fetches. With 0 messages (typical), this is 4 lightweight IMAP STATUS or FETCH commands. Negligible. |
| Messages in action folders | Usually 1-2 at a time | No batching needed. Sequential per-message processing is fine. |
| Rule count growth | Rules accumulate over months | `findSenderRule` is O(n) over all rules. With hundreds of rules this is negligible. If it ever matters, add an index. |
| IMAP connection sharing | Single connection, multiple consumers | `withMailboxLock` serializes access. Action folder polls are brief (fetch + move). Monitor IDLE is temporarily suspended during the lock but resumes immediately. 15s poll interval means at most a few seconds of lock time per cycle. |

## Sources

- Existing codebase: `src/monitor/index.ts`, `src/tracking/index.ts`, `src/sweep/index.ts`, `src/actions/index.ts`, `src/config/schema.ts`, `src/config/repository.ts`, `src/imap/client.ts`, `src/log/index.ts`, `src/web/routes/dispositions.ts`
- PRD: `docs/prd-v0.6.md`
- Project context: `.planning/PROJECT.md`
- ImapFlow documentation: IDLE watches single mailbox, `mailboxCreate` for folder creation (HIGH confidence from codebase -- already used in `executeMove`)
