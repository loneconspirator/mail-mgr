# Phase 20: Monitoring & Startup Recovery - Research

**Researched:** 2026-04-20
**Domain:** IMAP polling, timer lifecycle, startup sequencing
**Confidence:** HIGH

## Summary

This phase wires the existing `ActionFolderProcessor` (Phase 19) into the application lifecycle via poll-based STATUS checks and a startup pre-scan. The implementation is straightforward integration work — no new libraries needed, no complex algorithms. The patterns already exist in the codebase (MoveTracker's timer lifecycle, Monitor's processing guard, `ensureActionFolders` flow).

The key architectural decision is a standalone `ActionFolderPoller` class with `start()`/`stop()` lifecycle matching MoveTracker/Sweeper, injected into `index.ts`. The poll function STATUS-checks each action folder, fetches all messages from non-empty ones via `fetchAllMessages()` (already exists on ImapClient), parses them, and calls `processMessage()` for each.

**Primary recommendation:** Create `src/action-folders/poller.ts` with a class following MoveTracker's timer pattern, wire into index.ts startup between `ensureActionFolders()` and `monitor.start()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Separate poll timer (setInterval) in index.ts, NOT integrated into Monitor class
- D-02: Poll interval from `actionFolders.pollInterval` config (15s default), timer with `.unref()`
- D-03: Each tick: STATUS-check all enabled folders, fetch from non-empty, process via ActionFolderProcessor
- D-04: Structural priority — separate timer processes independently from Monitor
- D-05: Startup pre-scan runs BEFORE `monitor.start()`
- D-06: No conflict between poll and Monitor (different mailboxes)
- D-07: One-shot scan after ensureActionFolders(), before monitor.start()
- D-08: Shared function for startup scan and regular poll
- D-09: Pre-scan failure: log and continue (graceful degradation)
- D-10: STATUS re-check after processing to confirm count=0
- D-11: Single retry if count>0 after processing, then warn and move on
- D-12: Always-empty invariant is natural consequence of processMessage moving messages
- D-13: clearInterval on shutdown
- D-14: Config change: stop timer, re-read config, ensure folders, restart timer
- D-15: IMAP config change: rebuild alongside Monitor/Sweeper/MoveTracker

### Claude's Discretion
- Internal function naming for shared poll/scan logic
- Whether poll function is standalone module or inline in index.ts
- Exact STATUS check API usage
- Log messages and log levels
- Whether poll timer callback is async-safe (guard against overlapping polls)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MON-01 | Action folders are monitored via poll-based STATUS checks alongside INBOX/Review | ImapClient.status(path) returns {messages, unseen} — poll each folder path, process if messages > 0 |
| MON-02 | Action folder processing takes priority over regular arrival routing | Structural: pre-scan before monitor.start(), independent timer operates on different mailboxes |
| FOLD-02 | Action folders are always empty after processing completes | processMessage() moves messages out; STATUS re-check confirms count=0, single retry if not |
| FOLD-03 | System processes pending messages in action folders on startup before entering normal monitoring loop | One-shot scan call after ensureActionFolders() succeeds, before monitor.start() in index.ts |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | (existing) | IMAP STATUS checks, message fetch | Already in project, provides `status()` and `fetch()` |
| pino | (existing) | Logging | Already in project |

### Supporting
No new libraries needed. This phase uses only existing project infrastructure.

**Installation:** None required — all dependencies already present. [VERIFIED: codebase inspection]

## Architecture Patterns

### Recommended Project Structure
```
src/action-folders/
  poller.ts          # NEW: ActionFolderPoller class
  processor.ts       # EXISTING: processMessage() logic
  folders.ts         # EXISTING: ensureActionFolders()
  registry.ts        # EXISTING: ACTION_REGISTRY
  index.ts           # EXISTING: re-exports (add poller export)
```

### Pattern 1: Timer-Based Poller with Processing Guard
**What:** A class with start/stop lifecycle, setInterval timer, and a `processing` boolean to prevent overlapping async work.
**When to use:** Periodic background tasks that must not overlap.
**Example:**
```typescript
// Source: Modeled on src/tracking/index.ts MoveTracker pattern
export class ActionFolderPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(private deps: ActionFolderPollerDeps) {}

  async scanAll(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      // STATUS check each folder, fetch & process non-empty ones
    } finally {
      this.processing = false;
    }
  }

  start(): void {
    // Run initial scan (fire-and-forget for timer start; blocking for startup pre-scan)
    this.timer = setInterval(() => {
      this.scanAll().catch(err => this.deps.logger?.error({ err }, 'Action folder poll failed'));
    }, this.deps.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

### Pattern 2: Startup Pre-scan (Blocking Before Monitor)
**What:** Call `poller.scanAll()` with `await` before `monitor.start()` to process pending messages.
**When to use:** On application startup to drain action folders.
**Example:**
```typescript
// In index.ts, after ensureActionFolders() succeeds:
const poller = new ActionFolderPoller({ ... });
await poller.scanAll(); // D-07: blocking pre-scan
poller.start();         // D-02: start periodic polling
// THEN:
await monitor.start();  // D-05: Monitor starts after action folders are drained
```

### Pattern 3: Folder Path Resolution
**What:** Resolve action folder IMAP paths from config + registry.
**When to use:** Every poll tick to get current folder paths.
**Example:**
```typescript
// Source: src/action-folders/processor.ts:getSourceFolder pattern
function getActionFolderPaths(config: ActionFolderConfig): Array<{ path: string; actionType: ActionType }> {
  return (Object.entries(ACTION_REGISTRY) as [ActionType, ActionDefinition][]).map(
    ([actionType, def]) => ({
      path: `${config.prefix}/${config.folders[def.folderConfigKey]}`,
      actionType,
    })
  );
}
```

### Pattern 4: STATUS Check + Fetch-If-NonEmpty
**What:** Use ImapClient.status() to check message count, only fetch if > 0.
**When to use:** Each poll tick per folder — avoids expensive FETCH on empty folders.
**Example:**
```typescript
const { messages } = await client.status(folderPath);
if (messages > 0) {
  const rawMessages = await client.fetchAllMessages(folderPath);
  // Note: fetchAllMessages returns ReviewMessage[] — need to convert or add
  // a new method that returns EmailMessage[] for action folder use
}
```

### Anti-Patterns to Avoid
- **Opening mailbox locks on empty folders:** STATUS is cheap, FETCH is expensive — always check first
- **Sharing code paths with Monitor:** Monitor uses IDLE + UID tracking on INBOX; action folders poll STATUS on multiple folders — completely different patterns
- **Blocking startup on poll failures:** D-09 says graceful degradation — log and continue

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timer lifecycle | Custom event loop | setInterval + .unref() + clearInterval | Standard Node pattern, matches MoveTracker |
| Message fetching | Custom IMAP commands | ImapClient.fetchAllMessages() or withMailboxLock + fetch | Already exists, handles lock management |
| Folder path resolution | String concatenation everywhere | Shared helper using ACTION_REGISTRY | DRY, already done in processor.ts |
| Overlap prevention | Queuing system | Boolean `processing` guard | Simple, proven in Monitor and MoveTracker |

## Common Pitfalls

### Pitfall 1: fetchAllMessages Returns ReviewMessage, Not EmailMessage
**What goes wrong:** `fetchAllMessages(folder)` returns `ReviewMessage[]` which has different fields than `EmailMessage` needed by `processMessage()`.
**Why it happens:** fetchAllMessages was built for the sweep/review use case.
**How to avoid:** Either (a) use `reviewMessageToEmailMessage()` converter (already exported from imap/messages.ts), or (b) add a new fetch method that returns `EmailMessage[]` directly using `parseMessage()`. Option (a) is simpler.
**Warning signs:** Type errors when passing fetch results to processMessage.

### Pitfall 2: Overlapping Poll Ticks
**What goes wrong:** If processing takes longer than pollInterval (15s), multiple poll ticks fire concurrently.
**Why it happens:** setInterval doesn't wait for async callbacks.
**How to avoid:** Boolean `processing` guard — if already processing, skip the tick. Log at debug level when skipping.
**Warning signs:** Duplicate processing of same messages, IMAP lock contention.

### Pitfall 3: Config Change Race Condition
**What goes wrong:** Config changes while a poll is in progress could use stale folder paths.
**Why it happens:** Config is read at poll start, folders may change mid-poll.
**How to avoid:** The `processing` guard naturally prevents this — config change handler stops the timer and waits (stop + start pattern). Any in-flight poll completes with old config, new poll uses new config.
**Warning signs:** Errors about missing folders after config change.

### Pitfall 4: UID Validity Changes
**What goes wrong:** IMAP server resets UID validity on a folder, making old UIDs meaningless.
**Why it happens:** Server-side folder recreation or compaction.
**How to avoid:** Not a concern here — we fetch ALL messages (`1:*`) every tick, not tracking UIDs across polls. Each poll is stateless.
**Warning signs:** N/A for this pattern.

### Pitfall 5: Startup Order Matters
**What goes wrong:** Starting poll timer before ensureActionFolders creates races where STATUS checks hit non-existent folders.
**Why it happens:** Folders haven't been created yet.
**How to avoid:** Strict order: ensureActionFolders() -> scanAll() -> start(). This is already specified by D-07.
**Warning signs:** IMAP errors on STATUS for non-existent mailboxes.

## Code Examples

### Complete Poll Cycle
```typescript
// Source: synthesized from existing patterns in codebase
async scanAll(): Promise<void> {
  if (this.processing) {
    this.deps.logger?.debug('Action folder poll skipped (already processing)');
    return;
  }
  this.processing = true;
  try {
    const config = this.deps.configRepo.getActionFolderConfig();
    if (!config.enabled) return;

    const folders = getActionFolderPaths(config);

    for (const { path, actionType } of folders) {
      try {
        const { messages } = await this.deps.client.status(path);
        if (messages === 0) continue;

        this.deps.logger?.info({ folder: path, count: messages }, 'Processing action folder');
        const rawMessages = await this.deps.client.fetchAllMessages(path);
        
        for (const raw of rawMessages) {
          const msg = reviewMessageToEmailMessage(raw);
          await this.deps.processor.processMessage(msg, actionType);
        }

        // FOLD-02: Verify always-empty invariant
        const recheck = await this.deps.client.status(path);
        if (recheck.messages > 0) {
          this.deps.logger?.warn({ folder: path, remaining: recheck.messages }, 'Messages remain after processing, retrying');
          const retry = await this.deps.client.fetchAllMessages(path);
          for (const raw of retry) {
            const msg = reviewMessageToEmailMessage(raw);
            await this.deps.processor.processMessage(msg, actionType);
          }
          const final = await this.deps.client.status(path);
          if (final.messages > 0) {
            this.deps.logger?.warn({ folder: path, remaining: final.messages }, 'Messages still remain after retry');
          }
        }
      } catch (err) {
        this.deps.logger?.error({ err, folder: path }, 'Error processing action folder');
      }
    }
  } finally {
    this.processing = false;
  }
}
```

### Integration in index.ts
```typescript
// After ensureActionFolders succeeds (line ~256 in current index.ts):
import { ActionFolderPoller } from './action-folders/poller.js';

let actionFolderPoller: ActionFolderPoller | undefined;

// ... after ensureActionFolders succeeds:
if (foldersOk) {
  const processor = new ActionFolderProcessor(configRepo, imapClient, activityLog, logger, 'INBOX', resolvedTrash);
  actionFolderPoller = new ActionFolderPoller({
    client: imapClient,
    configRepo,
    processor,
    logger,
    pollIntervalMs: afConfig.pollInterval * 1000,
  });
  
  // D-07: Blocking pre-scan before monitor.start()
  await actionFolderPoller.scanAll();
  actionFolderPoller.start();
}

// THEN monitor.start() — but wait, current code calls monitor.start() BEFORE ensureActionFolders.
// This needs reordering per D-05!
```

### Config Change Handler Update
```typescript
// Update existing onActionFolderConfigChange handler:
configRepo.onActionFolderConfigChange(async (afConfig) => {
  if (actionFolderPoller) actionFolderPoller.stop();
  actionFolderPoller = undefined;
  
  if (!afConfig.enabled) {
    logger.info('Action folders disabled via config change');
    return;
  }
  const ok = await ensureActionFolders(imapClient, afConfig, logger);
  if (!ok) {
    logger.warn('Action folder creation failed after config change');
    return;
  }
  // Rebuild poller with new config
  const processor = new ActionFolderProcessor(configRepo, imapClient, activityLog, logger, 'INBOX', resolvedTrash);
  actionFolderPoller = new ActionFolderPoller({
    client: imapClient,
    configRepo,
    processor,
    logger,
    pollIntervalMs: afConfig.pollInterval * 1000,
  });
  actionFolderPoller.start();
});
```

## Key Implementation Detail: Startup Reordering

**CRITICAL:** The current `index.ts` calls `monitor.start()` at line 247 BEFORE `ensureActionFolders()` at line 250. Per D-05/D-07, this must be reordered:

1. `ensureActionFolders()` (already exists at line 250)
2. Create `ActionFolderPoller` + blocking `scanAll()` (NEW)
3. `poller.start()` (NEW)
4. `monitor.start()` (MOVE from line 247 to after poller setup)

This is the most impactful change to `index.ts` — reordering the startup sequence.

## fetchAllMessages Compatibility

`ImapClient.fetchAllMessages(folder)` returns `ReviewMessage[]`. The `ActionFolderProcessor.processMessage()` expects `EmailMessage`. These types overlap but aren't identical:

```typescript
// ReviewMessage has: uid, messageId, from, to, cc, subject, date, flags, visibility, readStatus
// EmailMessage has: uid, messageId, from, to, cc, subject, date, flags, listId
```

There's already a `reviewMessageToEmailMessage()` export from `src/imap/messages.ts`. This converter bridges the gap. [VERIFIED: grep of imap/index.ts exports]

Alternatively, a simpler approach: add a `fetchActionFolderMessages(folder)` method to ImapClient that uses the same fetch query as `fetchNewMessages` (envelope + flags) and returns `EmailMessage[]` via `parseMessage()`. This is cleaner but adds a method to the client.

**Recommendation:** Use the converter approach — less code change, `reviewMessageToEmailMessage` already exists and is tested.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/action-folders/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MON-01 | Poll STATUS checks each action folder | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "status check"` | Wave 0 |
| MON-02 | Pre-scan before monitor.start() | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "priority"` | Wave 0 |
| FOLD-02 | Always-empty invariant with STATUS re-check | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "always-empty"` | Wave 0 |
| FOLD-03 | Startup processes pending messages | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "startup"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/action-folders/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `test/unit/action-folders/poller.test.ts` — covers MON-01, MON-02, FOLD-02, FOLD-03
- [ ] Mock setup for ImapClient.status(), fetchAllMessages(), ActionFolderProcessor — shared fixtures

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `reviewMessageToEmailMessage()` provides all fields needed by `processMessage()` (specifically `from.address`) | fetchAllMessages Compatibility | Would need a custom fetch method instead — minor rework |
| A2 | ImapClient can handle concurrent `status()` calls on different folders without lock contention | Architecture Patterns | Would need sequential status checks — slight latency increase |

## Open Questions (RESOLVED)

1. **reviewMessageToEmailMessage field completeness** (RESOLVED)
   - What we know: The converter exists and is exported
   - Resolution: Verified — `reviewMessageToEmailMessage()` at `src/imap/messages.ts:69-82` sets `from: rm.envelope.from` which includes `.address`. The `extractSender()` function receives a valid `from.address` field. No fallback needed.

## Sources

### Primary (HIGH confidence)
- `src/index.ts` — current startup sequence, timer patterns, config change handlers
- `src/tracking/index.ts` — MoveTracker timer lifecycle pattern (setInterval, .unref(), stop())
- `src/imap/client.ts` — status(), fetchAllMessages(), withMailboxLock()
- `src/action-folders/processor.ts` — processMessage() API signature
- `src/action-folders/folders.ts` — ensureActionFolders() pattern
- `src/action-folders/registry.ts` — ACTION_REGISTRY structure
- `src/config/schema.ts` — actionFolderConfigSchema (pollInterval: 15s default)

### Secondary (MEDIUM confidence)
- `src/imap/messages.ts` — reviewMessageToEmailMessage converter (verified export exists)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all code exists
- Architecture: HIGH — follows established project patterns exactly
- Pitfalls: HIGH — identified from direct codebase inspection

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable — no external dependency changes expected)
