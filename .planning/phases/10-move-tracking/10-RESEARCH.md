# Phase 10: Move Tracking - Research

**Researched:** 2026-04-12
**Domain:** IMAP UID snapshot diffing, SQLite signal storage, background scanning
**Confidence:** HIGH

## Summary

This phase adds a MoveTracker component that detects when the user manually moves messages out of Inbox or Review folders, then logs structured signal data to a new `move_signals` table. The detection mechanism is UID snapshot diffing: periodically fetch the UID set for each monitored folder, compare against the previous snapshot, and investigate any UIDs that disappeared.

The architecture is well-constrained by existing patterns. MoveTracker follows the exact ReviewSweeper lifecycle pattern (standalone class, start/stop, own timer, injected deps). It shares the same ImapClient via `withMailboxLock()` for serialized IMAP access. The activity log cross-reference for excluding system moves is a straightforward SQL query on `message_id`. The two-tier destination detection (fast pass + deep scan) is the main novel complexity.

**Primary recommendation:** Build MoveTracker as a standalone class at `src/tracking/index.ts` following the ReviewSweeper pattern exactly. Use `ActivityLog.getState()`/`setState()` for UID snapshot persistence and add a new migration for the `move_signals` table.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: MoveTracker runs its own independent setInterval loop, decoupled from Monitor's IDLE/poll cycle
- D-02: Default scan interval is 30 seconds
- D-03: Scan interval configurable via review config YAML (`moveTracking.scanInterval`)
- D-04: Two-tier destination resolution -- fast pass scans recent folders from activity log (top 10) plus hardcoded common names (Archive, All Mail, Trash, Deleted Items, Junk, Spam)
- D-05: Deep background scan every 15 minutes searches all IMAP folders by Message-ID for messages not found in fast pass
- D-06: If deep scan also fails, signal is dropped entirely -- no incomplete data
- D-07: move_signals table stores: sender, envelope recipient, List-Id, subject, read status, visibility, source folder, destination folder, timestamp, message_id
- D-08: 90-day retention with auto-pruning
- D-09: Standalone class at `src/tracking/index.ts`, follows ReviewSweeper pattern, exposed via ServerDeps (`getMoveTracker()`)
- D-10: Move tracking on by default, can be disabled via config
- D-11: Shares ImapClient instance, uses `withMailboxLock()` for serialized folder access

### Claude's Discretion
- UID snapshot storage mechanism (state table keys, data structure)
- Message-ID cross-referencing query against activity log (SQL approach)
- Deep scan queue implementation (in-memory array vs SQLite pending table)
- How to detect "common" folder names across different IMAP providers (case-insensitive matching, aliases)
- Error handling for IMAP failures during scan (skip cycle, retry, backoff)
- Whether to expose move tracker status via a web API endpoint (for future UI)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEARN-01 | System periodically scans Inbox and Review using UID snapshot diffing to detect user moves, cross-referencing activity log by Message-ID to exclude system moves | UID snapshot via state table, cross-reference via SQL query on activity.message_id, scan loop via setInterval |
| LEARN-02 | For each detected user move, log sender, envelope recipient, list headers, subject, read status, visibility, source folder, destination folder to move_signals table | New migration creates move_signals table with all specified columns, 90-day auto-prune |
</phase_requirements>

## Standard Stack

No new dependencies required. This phase uses only existing project libraries.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2 | move_signals table storage | Already used for activity log and state [VERIFIED: codebase] |
| imapflow | 1.2.8 | UID fetch, folder scanning, Message-ID search | Already used by ImapClient [VERIFIED: codebase] |
| pino | 10.3.0 | Structured logging for scan cycles | Already used everywhere [VERIFIED: codebase] |
| zod | 4.3.6 | Config schema extension for moveTracking settings | Already used for all config validation [VERIFIED: codebase] |

**Installation:** None needed -- all dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  tracking/
    index.ts          # MoveTracker class (lifecycle, scan loop, snapshot diffing)
    signals.ts         # SignalStore class (move_signals table CRUD, pruning)
    destinations.ts    # Two-tier destination resolver (fast pass + deep scan)
```

### Pattern 1: ReviewSweeper Lifecycle Clone
**What:** MoveTracker follows the identical lifecycle pattern as ReviewSweeper [VERIFIED: src/sweep/index.ts]
**When to use:** Always -- this is a locked decision (D-09)
**Example:**
```typescript
// Source: existing ReviewSweeper pattern in src/sweep/index.ts
export interface MoveTrackerDeps {
  client: ImapClient
  activityLog: ActivityLog
  reviewFolder: string
  logger?: pino.Logger
}

export class MoveTracker {
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private deepScanTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(deps: MoveTrackerDeps) { /* store deps */ }

  start(): void {
    this.stop()
    // Immediate first scan, then interval
    this.runScan()
    this.scanTimer = setInterval(() => this.runScan(), this.scanIntervalMs)
    this.deepScanTimer = setInterval(() => this.runDeepScan(), 15 * 60 * 1000)
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null }
    if (this.deepScanTimer) { clearInterval(this.deepScanTimer); this.deepScanTimer = null }
  }

  getState(): MoveTrackerState { /* expose status for API */ }
}
```

### Pattern 2: UID Snapshot Diffing
**What:** Store the set of UIDs in each monitored folder. On each scan, fetch current UIDs and diff against snapshot. Missing UIDs are candidate user moves. [ASSUMED]
**When to use:** Every 30-second scan cycle
**Key details:**
- Store snapshots in the state table as JSON: `tracking:inbox:uids` and `tracking:review:uids`
- UID sets can be large (thousands of messages in INBOX). JSON serialization of number arrays is efficient enough for this scale.
- Fetch UIDs with a lightweight IMAP FETCH (uid-only, no envelope/body) to minimize bandwidth
- On first run (no snapshot), populate snapshot without generating signals -- treat as baseline

```typescript
// UID-only fetch is the lightest possible IMAP operation
async function fetchUidSet(client: ImapClient, folder: string): Promise<Set<number>> {
  return client.withMailboxLock(folder, async (flow) => {
    const uids = new Set<number>()
    for await (const msg of flow.fetch('1:*', { uid: true }, { uid: true })) {
      const m = msg as { uid: number }
      uids.add(m.uid)
    }
    return uids
  })
}
```

### Pattern 3: Activity Log Cross-Reference
**What:** After detecting missing UIDs, look up their Message-IDs in the activity log to exclude system-initiated moves (arrival, sweep, batch). [VERIFIED: activity table has message_id and source columns]
**When to use:** For every missing UID before logging a signal

```typescript
// Query: was this message_id moved by the system recently?
// Source: activity table schema in src/log/index.ts
const isSystemMove = db.prepare(`
  SELECT 1 FROM activity
  WHERE message_id = ? AND success = 1
    AND source IN ('arrival', 'sweep', 'batch')
    AND timestamp > datetime('now', '-1 day')
  LIMIT 1
`).get(messageId)
```

The 1-day lookback window is sufficient because the scan interval is 30 seconds -- any system move will be logged within seconds of occurring. A wider window just adds safety margin. [ASSUMED]

### Pattern 4: Two-Tier Destination Detection
**What:** Fast pass checks common folders by Message-ID search. Deep scan checks all folders on a 15-minute cycle. [VERIFIED: locked decisions D-04, D-05]
**When to use:** After confirming a UID disappearance is a user move

**Fast pass candidates (D-04):**
1. Recent folders from `activityLog.getRecentFolders(10)` -- already implemented [VERIFIED: src/log/index.ts line 148]
2. Hardcoded common names: `['Archive', 'All Mail', 'Trash', 'Deleted Items', 'Junk', 'Spam', '[Gmail]/All Mail', '[Gmail]/Trash', '[Gmail]/Spam']`

**Message-ID search in a folder:**
```typescript
// ImapFlow SEARCH command can find by Message-ID header
// Source: ImapFlow docs for SEARCH criteria
async function findByMessageId(
  client: ImapClient,
  folder: string,
  messageId: string,
): Promise<boolean> {
  return client.withMailboxLock(folder, async (flow) => {
    // IMAP SEARCH HEADER Message-ID "<id>"
    const results: unknown[] = []
    for await (const msg of flow.fetch('1:*', { uid: true, envelope: true }, { uid: true })) {
      const m = msg as { uid: number; envelope?: { messageId?: string } }
      if (m.envelope?.messageId === messageId) {
        results.push(m)
      }
    }
    return results.length > 0
  })
}
```

**Important IMAP consideration:** ImapFlow does not expose a direct SEARCH HEADER command through its high-level API. The approach above fetches all envelopes per folder which is expensive for large folders. A better approach uses the `status()` method first to check if a folder has new messages, or uses raw SEARCH via the lower-level API. This needs verification during implementation. [ASSUMED]

**Recommended alternative:** Use `flow.search()` if available in ImapFlow, or iterate only folders with message counts that changed. For the fast pass, the candidate list is small (10-15 folders), so even envelope scanning is acceptable. For the deep scan, folder count filtering is essential.

### Pattern 5: Config Schema Extension
**What:** Add `moveTracking` section to review config [VERIFIED: D-03, D-10]
```typescript
// Extend reviewConfigSchema in src/config/schema.ts
export const moveTrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  scanInterval: z.number().int().positive().default(30),  // seconds
})

// Add to reviewConfigSchema
export const reviewConfigSchema = z.object({
  folder: z.string().min(1).default('Review'),
  defaultArchiveFolder: z.string().min(1).default('MailingLists'),
  trashFolder: z.string().min(1).default('Trash'),
  sweep: sweepConfigSchema.default(sweepDefaults),
  moveTracking: moveTrackingConfigSchema.default({ enabled: true, scanInterval: 30 }),
})
```

### Anti-Patterns to Avoid
- **Polling all folders every 30 seconds:** Only scan INBOX and Review for UID changes. Destination detection is separate and less frequent.
- **Storing incomplete signals:** D-06 is explicit -- if destination can't be resolved, drop the signal entirely. No nulls in destination_folder.
- **Fetching full message data on every scan:** The 30-second scan should only fetch UIDs (lightest IMAP operation). Full message data is fetched only for UIDs that actually disappeared.
- **Blocking Monitor with folder locks:** MoveTracker uses `withMailboxLock()` which serializes access. Keep lock durations short -- fetch UIDs, release, then process.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UID persistence | File-based snapshot storage | `ActivityLog.getState()`/`setState()` | Already battle-tested, atomic via SQLite [VERIFIED: src/log/index.ts] |
| Migration management | Ad-hoc ALTER TABLE | `runMigrations()` system | Versioned, transactional, idempotent [VERIFIED: src/log/migrations.ts] |
| IMAP folder access serialization | Custom locking | `withMailboxLock()` | Proven pattern, handles release on error [VERIFIED: src/imap/client.ts] |
| Folder list caching | Own cache | `FolderCache` | Already built, TTL-based, used by batch [VERIFIED: src/folders/index.ts] |
| Recent folder detection | Custom frequency query | `activityLog.getRecentFolders()` | Already returns distinct successful destinations [VERIFIED: src/log/index.ts] |

## Common Pitfalls

### Pitfall 1: UID Validity Changes
**What goes wrong:** IMAP UIDs are only valid within a UIDVALIDITY epoch. If the server resets UIDVALIDITY (after mailbox rebuild, migration, etc.), all stored UIDs become meaningless. The diff would show ALL messages as "disappeared."
**Why it happens:** Server-side mailbox maintenance, account migration, or provider changes.
**How to avoid:** Store UIDVALIDITY alongside the UID snapshot. Before diffing, compare current UIDVALIDITY with stored value. If different, discard old snapshot and re-baseline without generating signals.
**Warning signs:** Sudden massive disappearance count in a single scan cycle.
[ASSUMED -- standard IMAP knowledge, well-documented in RFC 3501]

### Pitfall 2: Race Condition Between Monitor Move and Scan
**What goes wrong:** Monitor moves a message at T=0. MoveTracker scans at T=0.5 (before activity log write completes). UID is missing but cross-reference finds nothing in activity log. False positive user move detected.
**Why it happens:** Monitor's `processNewMessages()` and MoveTracker's scan can interleave. Activity logging happens after the IMAP move but within the same processing chain.
**How to avoid:** Add a short grace period. When a UID disappears, don't immediately flag it -- wait until the next scan cycle (30 seconds later) to confirm it's still missing and check the activity log again. This "two-scan confirmation" eliminates races.
**Warning signs:** Signals appearing for messages that were clearly auto-routed by rules.
[ASSUMED -- race condition analysis based on code review of Monitor.processMessage()]

### Pitfall 3: Large INBOX UID Fetches
**What goes wrong:** INBOX with 10,000+ messages means fetching 10,000 UIDs every 30 seconds. This creates unnecessary IMAP traffic and holds the mailbox lock.
**Why it happens:** Users who don't aggressively manage their inbox can accumulate thousands of messages.
**How to avoid:** The UID-only fetch (`fetch('1:*', { uid: true })`) is the lightest possible IMAP command. Even for 10K messages, the response is just a list of integers. The real optimization is keeping lock time short -- fetch UIDs into a Set, release lock, then diff in memory.
**Warning signs:** Scan cycles taking more than a few seconds, log messages about slow fetches.
[ASSUMED -- based on IMAP protocol behavior]

### Pitfall 4: Deep Scan Checking Too Many Folders
**What goes wrong:** IMAP account with 200+ folders (common with Gmail label mapping). Deep scan iterating all folders takes minutes, holding locks repeatedly.
**Why it happens:** Gmail exposes labels as IMAP folders, including system labels, user labels, and nested hierarchies.
**How to avoid:** Use FolderCache to get the folder list (already cached, 5-minute TTL). Skip non-selectable folders (flagged with `\Noselect`). Consider skipping known system folders that messages can't be moved to (e.g., `[Gmail]/Drafts`, `[Gmail]/Sent Mail`). Process one folder at a time with small pauses between to avoid starving Monitor.
**Warning signs:** Deep scan cycles consistently exceeding 15 minutes (overlapping with next cycle).
[ASSUMED -- based on IMAP folder structure knowledge]

### Pitfall 5: Snapshot Bloat in State Table
**What goes wrong:** Serializing 10,000+ UIDs as JSON into the state table every 30 seconds creates large values and write amplification.
**Why it happens:** State table stores values as TEXT with INSERT OR REPLACE.
**How to avoid:** UIDs are monotonically increasing integers. Instead of storing the full set, store the UID range (min:max) plus a Set of known UIDs. Or just store the full set -- SQLite handles multi-KB TEXT values fine and WAL mode keeps writes fast. Monitor this if performance degrades.
**Warning signs:** Database file growing unusually fast, scan cycle duration increasing over time.
[ASSUMED]

## Code Examples

### Migration for move_signals Table
```typescript
// Source: pattern from src/log/migrations.ts
{
  version: '20260412_001',
  description: 'Create move_signals table for user move tracking',
  up: (db: Database.Database): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS move_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        message_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        envelope_recipient TEXT,
        list_id TEXT,
        subject TEXT NOT NULL,
        read_status TEXT NOT NULL,
        visibility TEXT,
        source_folder TEXT NOT NULL,
        destination_folder TEXT NOT NULL
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON move_signals(timestamp)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_sender ON move_signals(sender)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_destination ON move_signals(destination_folder)`)
  },
}
```

### UID Snapshot Persistence
```typescript
// Source: ActivityLog.getState/setState pattern from src/log/index.ts
interface UidSnapshot {
  uidValidity: number
  uids: number[]
}

function loadSnapshot(activityLog: ActivityLog, folder: string): UidSnapshot | null {
  const key = `tracking:${folder}:snapshot`
  const raw = activityLog.getState(key)
  if (!raw) return null
  return JSON.parse(raw) as UidSnapshot
}

function saveSnapshot(activityLog: ActivityLog, folder: string, snapshot: UidSnapshot): void {
  const key = `tracking:${folder}:snapshot`
  activityLog.setState(key, JSON.stringify(snapshot))
}
```

### Fetching Envelope Data for Disappeared Messages
```typescript
// When a UID disappears and we need signal data, we need the message envelope.
// Problem: the message is no longer in the source folder.
// Solution: cache minimal envelope data in the snapshot alongside UIDs.

interface TrackedMessage {
  uid: number
  messageId: string
  sender: string
  envelopeRecipient?: string
  listId?: string
  subject: string
  readStatus: 'read' | 'unread'
  visibility?: string
}

interface UidSnapshot {
  uidValidity: number
  messages: TrackedMessage[]  // Full message data cached for signal creation
}
```

**Critical insight:** When a message disappears from a folder, we can no longer fetch its envelope data from that folder. The snapshot must cache all signal-required fields (sender, recipient, subject, etc.) alongside UIDs. This is the fundamental reason the snapshot stores more than just UIDs. [ASSUMED -- but logically necessary given the detection-after-disappearance flow]

### Main Entry Wiring
```typescript
// Source: pattern from src/index.ts
// H6: Create MoveTracker (after IMAP connected, alongside sweeper)
let moveTracker: MoveTracker | undefined = new MoveTracker({
  client: imapClient,
  activityLog,
  reviewFolder: config.review.folder,
  scanIntervalMs: (config.review.moveTracking?.scanInterval ?? 30) * 1000,
  logger,
})

// In buildServer deps:
getMoveTracker: () => moveTracker,

// After IMAP connect:
moveTracker.start()

// In onReviewConfigChange:
if (moveTracker) moveTracker.stop()
moveTracker = new MoveTracker({ /* updated config */ })
moveTracker.start()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CONDSTORE/QRESYNC for change detection | UID snapshot diffing | Project decision | CONDSTORE tracks flag changes only, not cross-folder moves [VERIFIED: REQUIREMENTS.md Out of Scope] |
| Polling with full envelope fetch | UID-only lightweight fetch + cached envelope data | This phase | Reduces IMAP bandwidth by ~95% per scan cycle |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | UID-only IMAP fetch (`{ uid: true }`) is lightweight enough for 30-second polling on folders with 10K+ messages | Architecture Patterns / Pitfall 3 | Scan cycles may be too slow; would need to reduce frequency or use UIDNEXT optimization |
| A2 | 1-day lookback window on activity log cross-reference is sufficient to avoid false positives | Pattern 3 | Could miss system moves if activity logging is delayed; extend window or use different approach |
| A3 | ImapFlow does not expose a direct SEARCH HEADER command for Message-ID lookup | Pattern 4 | If it does, destination detection becomes much cheaper; verify during implementation |
| A4 | Snapshot must cache full message envelope data since disappeared messages can't be re-fetched from source folder | Code Examples | If there's another way to get envelope data post-move, snapshot could be lighter |
| A5 | Two-scan confirmation (detect in scan N, confirm in scan N+1) eliminates Monitor/Tracker race conditions | Pitfall 2 | Could still have edge cases; may need more sophisticated coordination |
| A6 | JSON serialization of thousands of TrackedMessage objects in the state table is performant enough at 30-second intervals | Pitfall 5 | May need to move to a dedicated SQLite table for snapshots instead of state key-value |

## Open Questions (RESOLVED)

1. **ImapFlow SEARCH capability**
   - What we know: ImapFlow has `fetch()` for iterating messages. It may also have `search()` for server-side filtering.
   - What's unclear: Whether ImapFlow exposes IMAP SEARCH HEADER command for Message-ID lookup without fetching all envelopes.
   - Recommendation: Check ImapFlow API during implementation. If SEARCH is available, use it for destination detection (much faster than envelope iteration). If not, the envelope scan approach works for the small fast-pass candidate list.
   - RESOLVED: Plan 02 DestinationResolver uses envelope iteration as the default approach with a comment to check for `flow.search()` at implementation time. The fast-pass candidate list is small enough (10-15 folders) that envelope scanning is acceptable. If search is available, executor will use it as an optimization. No blocker.

2. **UIDVALIDITY access in ImapFlow**
   - What we know: IMAP protocol provides UIDVALIDITY on mailbox SELECT/EXAMINE.
   - What's unclear: How ImapFlow exposes UIDVALIDITY after `getMailboxLock()` or `mailboxOpen()`.
   - Recommendation: Check ImapFlow's mailbox metadata after lock acquisition. The value is almost certainly available on the mailbox info object.
   - RESOLVED: Plan 02 MoveTracker accesses UIDVALIDITY via `flow.mailbox?.uidValidity` after lock acquisition. If the property path differs, executor will inspect the ImapFlow mailbox info object at implementation time. The value is standard IMAP metadata and will be available. No blocker.

3. **Snapshot data volume**
   - What we know: Each TrackedMessage is ~200-500 bytes. 5,000 messages = ~1-2.5 MB JSON per snapshot per folder.
   - What's unclear: Whether writing 2-5 MB to the state table every 30 seconds causes measurable SQLite performance impact.
   - Recommendation: Start with state table approach (simplest). If profiling shows issues, migrate to a dedicated `tracking_snapshots` table with one row per message instead of one JSON blob.
   - RESOLVED: Plan 02 uses the state table approach (ActivityLog.getState/setState) as the initial implementation per Claude's Discretion. SQLite with WAL mode handles multi-KB TEXT values well. If performance issues arise post-deployment, migration to a dedicated table is a future optimization. No blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/tracking` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEARN-01a | UID snapshot diffing detects disappeared messages | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "detects disappeared"` | Wave 0 |
| LEARN-01b | Activity log cross-reference excludes system moves | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "excludes system"` | Wave 0 |
| LEARN-01c | Scan loop runs on interval without blocking Monitor | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "scan interval"` | Wave 0 |
| LEARN-02a | move_signals table created by migration | unit | `npx vitest run test/unit/log/migrations.test.ts -t "move_signals"` | Wave 0 |
| LEARN-02b | Signal stored with all required fields | unit | `npx vitest run test/unit/tracking/signals.test.ts -t "stores signal"` | Wave 0 |
| LEARN-02c | 90-day auto-pruning works | unit | `npx vitest run test/unit/tracking/signals.test.ts -t "prune"` | Wave 0 |
| LEARN-02d | Fast-pass destination detection finds message in common folders | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "fast pass"` | Wave 0 |
| LEARN-02e | Deep scan finds message in uncommon folder | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "deep scan"` | Wave 0 |
| LEARN-02f | Unresolvable destination causes signal to be dropped | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "drops unresolvable"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/tracking`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/tracking/tracker.test.ts` -- covers LEARN-01 (snapshot diffing, cross-reference, lifecycle)
- [ ] `test/unit/tracking/signals.test.ts` -- covers LEARN-02 signal storage and pruning
- [ ] `test/unit/tracking/destinations.test.ts` -- covers destination resolution (fast pass, deep scan, drop)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- single instance, no auth |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A -- single instance |
| V5 Input Validation | yes | Zod schema for moveTracking config; SQLite parameterized queries for all signal writes |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via message fields | Tampering | Parameterized queries for all SQLite operations (prepared statements with `?` placeholders) [VERIFIED: existing pattern in src/log/index.ts] |
| IMAP credential exposure in logs | Information Disclosure | Pino logger with structured objects; never log raw IMAP flow objects [VERIFIED: existing pattern] |

## Sources

### Primary (HIGH confidence)
- `src/sweep/index.ts` -- ReviewSweeper lifecycle pattern (start/stop, timer management, state exposure)
- `src/log/index.ts` -- ActivityLog API (getState/setState, getRecentFolders, logActivity, schema)
- `src/log/migrations.ts` -- Migration system (version tracking, transactional execution)
- `src/imap/client.ts` -- ImapClient API (withMailboxLock, fetchAllMessages, listFolders)
- `src/imap/messages.ts` -- Message types (EmailMessage, ReviewMessage, Visibility, parseMessage)
- `src/index.ts` -- Main entry wiring pattern (component creation, config listeners, ServerDeps)
- `src/web/server.ts` -- ServerDeps interface (getter pattern for hot-reloadable components)
- `src/config/schema.ts` -- Config schema (reviewConfigSchema, sweepConfigSchema as extension pattern)
- `.planning/REQUIREMENTS.md` -- LEARN-01, LEARN-02 requirements; CONDSTORE out-of-scope confirmation

### Secondary (MEDIUM confidence)
- `.planning/phases/06-extended-message-data/06-CONTEXT.md` -- Migration system decisions (D-09, D-10)

### Tertiary (LOW confidence)
- ImapFlow SEARCH/UIDVALIDITY capabilities -- needs implementation-time verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- follows established ReviewSweeper pattern exactly, all integration points verified in codebase
- Pitfalls: MEDIUM -- race conditions and UID validity are well-known IMAP concerns but specific behavior with ImapFlow needs runtime verification
- Destination detection: MEDIUM -- two-tier approach is clear but ImapFlow's SEARCH capabilities need verification

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable domain, all internal codebase patterns)
