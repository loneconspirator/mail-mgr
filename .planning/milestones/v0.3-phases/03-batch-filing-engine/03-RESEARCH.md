# Phase 3: Batch Filing Engine - Research

**Researched:** 2026-04-07
**Domain:** Server-side batch processing engine with IMAP message moves, dry-run preview, chunked execution, and cancellation
**Confidence:** HIGH

## Summary

Phase 3 builds a batch filing engine that applies the full ruleset to all messages in a user-selected source folder, with dry-run preview and mid-run cancellation. The architecture is straightforward because the codebase already has every primitive needed: `evaluateRules()` for first-match-wins evaluation, `executeAction()` for moves with auto-folder-creation retry, `ActivityLog.logActivity()` with source tagging, and `ReviewSweeper` as a structural template for per-message iteration with error isolation.

The batch engine is a new class (`BatchEngine` or similar) in `src/batch/index.ts` that follows the `ReviewSweeper` pattern: dependency-injected, exposes `getState()` for API consumption, and uses the shared IMAP client. The key engineering challenges are (1) chunked execution with yields between chunks so the monitor can process new mail on the shared IMAP connection, (2) a cancellation flag checked between chunks, and (3) a dry-run mode that evaluates rules but skips IMAP operations. None of these require external libraries -- they are pure control flow with `setTimeout`/`setImmediate` for yielding.

**Primary recommendation:** Mirror `ReviewSweeper` structure exactly. Fetch all messages from the source folder via `client.fetchAllMessages()`, convert to `EmailMessage` via `reviewMessageToEmailMessage()`, evaluate with `evaluateRules()`, and execute with `executeAction()` -- chunked with yields. State machine: `idle -> dry-running -> previewing -> executing -> completed/cancelled/error`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Apply entire ruleset to the source folder -- no per-rule selection. Matches how Monitor already works (first-match-wins across all rules).
- **D-02:** Unmatched messages stay in the source folder. No catchall destination.
- **D-03:** Process all messages in the folder -- no date range or read/unread filtering. Dry-run is the safety valve.
- **D-04:** Source folder selected via the Phase 2 tree picker component -- consistent UX.
- **D-05:** Dry-run results grouped by destination folder with message counts (e.g., "Receipts (47)", "Newsletters (23)", "No match (12)").
- **D-06:** Groups are expandable to show individual messages for sanity-checking before committing.
- **D-07:** Dry-run flows directly into execution -- a "Run batch" button on the preview lets the user confirm and execute without restarting the workflow.
- **D-08:** Visible "Cancel" button while batch is running. Stops after the current chunk completes.
- **D-09:** After cancellation, show partial results summary with moved/skipped/remaining counts.
- **D-10:** Already-moved messages stay moved after cancellation. No undo in v1 (BATC-08 is v2).
- **D-11:** Batch and monitor share the single IMAP connection. Batch yields between chunks so monitor can process new mail.
- **D-12:** One batch at a time -- UI disables start while a batch is active.
- **D-13:** Batch runs server-side regardless of browser state. User can navigate away and return to see progress or final results.
- **D-14:** Batch moves logged to the activity log with source='batch' -- consistent with monitor (source='monitor') and sweep (source='sweep'). No separate batch history table.

### Claude's Discretion
- Chunk size (25-50 messages per chunk -- already flagged in STATE.md research)
- Yield mechanism between chunks (setTimeout, setImmediate, or similar)
- Internal batch state machine design
- API endpoint structure for batch operations

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BATC-01 | User can batch-file messages in a selected source folder against all rules | `evaluateRules()` already does first-match-wins; `fetchAllMessages()` fetches from any folder; `executeAction()` handles move/delete/skip/review |
| BATC-02 | Batch evaluation uses sweep-style rule matching (first-match-wins) without age constraints | Direct reuse of `evaluateRules()` -- no age filtering needed (unlike `ReviewSweeper.isEligibleForSweep`) |
| BATC-03 | Batch processing uses chunked IMAP moves with per-message error isolation | Chunk the message array, process each chunk sequentially, yield between chunks; per-message try/catch matches `ReviewSweeper.runSweep()` pattern |
| BATC-05 | User can cancel a running batch (stops after current chunk completes) | Cancellation flag checked between chunks; already-processed messages stay moved (D-10) |
| BATC-06 | Dry-run mode previews what a batch would do without executing moves | Same fetch + evaluate pipeline, skip `executeAction()`, collect results grouped by destination |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.8 | IMAP operations (fetch, move) | Already in use; `ImapClient` wraps it |
| better-sqlite3 | 12.6.2 | Activity logging | Already in use; `ActivityLog` class |
| zod | 4.3.6 | Request validation for batch API endpoints | Already in use for all config/route validation |
| fastify | 5.7.4 | HTTP API routes for batch operations | Already in use for all routes |
| pino | 10.3.0 | Structured logging | Already in use throughout |

### Supporting
No new dependencies needed. This phase is entirely built from existing primitives.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual chunking | bull/bullmq job queue | Overkill for single-user, single-batch-at-a-time; adds Redis dependency |
| setTimeout yields | Worker threads | Unnecessary complexity; single IMAP connection means true parallelism has no benefit |
| In-memory batch state | Persist batch state to SQLite | Not needed -- batch is ephemeral, server restart cancels batch, activity log has durable record |

## Architecture Patterns

### Recommended Project Structure
```
src/
  batch/
    index.ts           # BatchEngine class, BatchDeps, BatchState, BatchResult types
  web/
    routes/
      batch.ts         # POST /api/batch/dry-run, POST /api/batch/execute, POST /api/batch/cancel, GET /api/batch/status
  shared/
    types.ts           # Add BatchStatusResponse, DryRunResponse types
```

### Pattern 1: BatchEngine Class (mirrors ReviewSweeper)
**What:** A class that encapsulates batch state, receives dependencies via injection, exposes `getState()` for API consumption
**When to use:** This is THE pattern for this phase -- it matches Monitor, ReviewSweeper, and FolderCache

```typescript
// Follows existing DI pattern from SweepDeps, MonitorDeps
export interface BatchDeps {
  client: ImapClient
  activityLog: ActivityLog
  rules: Rule[]
  reviewFolder: string
  trashFolder: string
  logger?: pino.Logger
}

export type BatchStatus = 'idle' | 'dry-running' | 'previewing' | 'executing' | 'completed' | 'cancelled' | 'error'

export interface BatchState {
  status: BatchStatus
  sourceFolder: string | null
  totalMessages: number
  processed: number
  moved: number
  skipped: number
  errors: number
  cancelled: boolean
  // Dry-run results (available when status is 'previewing')
  dryRunResults: DryRunGroup[] | null
  // Final results (available when status is 'completed' or 'cancelled')
  completedAt: string | null
}

export interface DryRunGroup {
  destination: string  // folder path or 'no-match' or 'skip'
  action: string       // 'move' | 'delete' | 'skip' | 'no-match'
  count: number
  messages: DryRunMessage[]
}

export interface DryRunMessage {
  uid: number
  from: string
  subject: string
  date: string
  ruleName: string
}
```

### Pattern 2: Chunked Execution with Yield
**What:** Process messages in chunks of N, yielding between chunks via `setTimeout(fn, 0)` or `setImmediate()`
**When to use:** Required by D-11 (shared IMAP connection) and BATC-03 (chunked moves)

```typescript
// Recommendation: setImmediate for yielding
// - Lets pending I/O callbacks (including IMAP events for monitor) execute
// - Zero overhead vs setTimeout which has minimum 1ms delay
// - Available in Node.js (not browsers, but this is server-side)

const CHUNK_SIZE = 25  // Start conservative; can tune up to 50

async function processChunks(messages: EmailMessage[], ctx: ActionContext): Promise<void> {
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    if (this.cancelRequested) break

    const chunk = messages.slice(i, i + CHUNK_SIZE)
    for (const msg of chunk) {
      try {
        // per-message error isolation
        await this.processOneMessage(msg, ctx)
      } catch (err) {
        this.state.errors++
        // log and continue -- don't abort
      }
    }

    // Yield to event loop between chunks
    if (i + CHUNK_SIZE < messages.length) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
}
```

### Pattern 3: Dry-Run as Evaluate-Only Pass
**What:** Fetch all messages, run `evaluateRules()` on each, collect results grouped by destination -- no IMAP moves
**When to use:** BATC-06 dry-run mode

```typescript
// Dry-run collects evaluation results without executing
async function dryRun(sourceFolder: string): Promise<DryRunGroup[]> {
  const rawMessages = await this.client.fetchAllMessages(sourceFolder)
  const groups = new Map<string, DryRunGroup>()

  for (const raw of rawMessages) {
    const msg = reviewMessageToEmailMessage(raw)
    const matched = evaluateRules(this.rules, msg)

    const key = matched
      ? `${matched.action.type}:${resolveDestination(matched, ctx)}`
      : 'no-match'

    // Group by destination
    if (!groups.has(key)) {
      groups.set(key, { destination: ..., action: ..., count: 0, messages: [] })
    }
    const group = groups.get(key)!
    group.count++
    group.messages.push({ uid: msg.uid, from: msg.from.address, subject: msg.subject, ... })
  }

  return Array.from(groups.values())
}
```

### Pattern 4: Integration into ServerDeps and index.ts
**What:** BatchEngine wired into the app the same way Monitor and ReviewSweeper are
**When to use:** Required for API access

```typescript
// server.ts -- add to ServerDeps
export interface ServerDeps {
  // ... existing
  getBatchEngine: () => BatchEngine
}

// index.ts -- instantiate alongside other engines
let batchEngine = new BatchEngine({ client: imapClient, activityLog, rules: config.rules, ... })

// Wire into config change handlers (rules update, IMAP config change)
configRepo.onRulesChange((rules) => {
  batchEngine.updateRules(rules)
})
```

### Anti-Patterns to Avoid
- **Separate IMAP connection for batch:** D-11 says share the single connection. Opening a second connection risks Fastmail rate limits and adds connection lifecycle complexity.
- **Persisting batch state to SQLite:** Batch state is ephemeral. The activity log is the durable record. Don't create a batch_jobs table.
- **Using `withMailboxSwitch` for every message:** This stops/starts IDLE for each message. Instead, use `withMailboxSwitch` once per chunk or use `withMailboxLock` on the source folder for the fetch, then individual `moveMessage` calls (which already lock per-move).
- **Blocking the event loop during execution:** Must yield between chunks. A tight loop over thousands of messages would starve the monitor.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rule evaluation | Custom matching logic | `evaluateRules()` from `src/rules/index.ts` | Already handles first-match-wins, enabled filtering, order sorting |
| Message moves | Direct imapflow calls | `executeAction()` from `src/actions/index.ts` | Handles move, delete, skip, review + auto-folder-creation retry |
| Message parsing | Custom envelope parsing | `reviewMessageToEmailMessage()` from `src/imap/messages.ts` | Consistent with sweep pipeline |
| Activity logging | Custom INSERT statements | `ActivityLog.logActivity()` | Already supports source tagging, consistent schema |
| Request validation | Manual param checking | Zod schemas | Consistent with all other route handlers |
| Folder fetching | Custom IMAP LIST calls | `client.fetchAllMessages(folder)` | Already handles mailbox lock, returns `ReviewMessage[]` |

**Key insight:** This phase requires zero new algorithmic primitives. Every operation -- fetch, evaluate, move, log -- already exists. The engineering challenge is orchestrating them with chunking, yielding, cancellation, and state management.

## Common Pitfalls

### Pitfall 1: IMAP Mailbox Lock Contention
**What goes wrong:** Batch holds a mailbox lock on the source folder while the monitor needs to check INBOX for new mail.
**Why it happens:** `fetchAllMessages()` uses `withMailboxLock`, and `moveMessage()` also acquires locks. If batch holds the lock too long, monitor IDLE/poll can't process.
**How to avoid:** The existing `moveMessage()` already locks per-operation (acquires lock, moves, releases). The `fetchAllMessages()` call fetches all at once then releases. The yield between chunks (`setImmediate`) lets monitor callbacks fire. This should work naturally as long as batch doesn't hold a persistent lock across the entire execution.
**Warning signs:** Monitor stops processing new mail while batch is running.

### Pitfall 2: Activity Log Source Tag
**What goes wrong:** Batch entries indistinguishable from monitor entries in activity log.
**Why it happens:** `logActivity()` currently accepts `'arrival' | 'sweep'` as source. Need to add `'batch'` to the union.
**How to avoid:** Update `logActivity()` signature to accept `'arrival' | 'sweep' | 'batch'`. This is a one-line type change.
**Warning signs:** Activity log shows 500 entries with source='arrival' that are actually batch operations.

### Pitfall 3: Message UIDs Changing During Batch
**What goes wrong:** After moving messages from the source folder, remaining UIDs might change (IMAP UIDVALIDITY).
**Why it happens:** Some IMAP servers reassign UIDs after folder modifications. However, `fetchAllMessages()` fetches all messages upfront with their UIDs, and `moveMessage()` operates on individual UIDs.
**How to avoid:** Fetch all messages once at batch start. Process from the fetched list. If a move fails for a specific UID, log the error and continue (per-message error isolation). Don't re-fetch mid-batch.
**Warning signs:** "Message not found" errors mid-batch for UIDs that were valid at fetch time.

### Pitfall 4: Large Folder Memory Pressure
**What goes wrong:** Folder with 10,000+ messages causes high memory usage when `fetchAllMessages()` loads all envelopes.
**Why it happens:** Each `ReviewMessage` object contains envelope data. 10,000 messages is manageable (each is ~200 bytes parsed = ~2MB), but 100,000 could be notable.
**How to avoid:** For v1, accept this tradeoff -- `fetchAllMessages()` already does this for sweep. The envelopes are lightweight (no bodies). If needed later, paginated fetching can be added.
**Warning signs:** Process RSS spikes during batch start on very large folders.

### Pitfall 5: Activity Log Indexing for Batch-Scale Inserts
**What goes wrong:** Batch filing creates hundreds of activity log entries. The `getRecentActivity()` query (`ORDER BY id DESC LIMIT ? OFFSET ?`) is already indexed by primary key so it stays fast. But the `getRecentFolders()` query (GROUP BY folder, ORDER BY MAX(id)) could slow down.
**Why it happens:** No index on `source` column or `folder` column.
**How to avoid:** Add index on `(source)` and `(folder, success)` columns in a migration. This was flagged in STATE.md as a research gap.
**Warning signs:** Slow API responses after running batch on a large folder.

### Pitfall 6: Dry-Run to Execute Transition
**What goes wrong:** Messages change between dry-run and execute (new messages arrive, messages manually moved).
**Why it happens:** Dry-run and execute are separate operations with time gap between them (D-07 says user reviews preview then clicks "Run batch").
**How to avoid:** Re-fetch messages at execute time. The dry-run preview is informational. The execute pass is the source of truth. Document that counts may differ slightly between preview and execution.
**Warning signs:** Execute moves fewer/more messages than dry-run predicted.

## Code Examples

### BatchEngine Skeleton (verified from codebase patterns)
```typescript
// Source: mirrors src/sweep/index.ts structure
import type { ImapClient, ReviewMessage } from '../imap/index.js'
import { reviewMessageToEmailMessage } from '../imap/index.js'
import { evaluateRules } from '../rules/index.js'
import { executeAction } from '../actions/index.js'
import type { ActionContext, ActionResult } from '../actions/index.js'
import type { ActivityLog } from '../log/index.js'
import type { Rule } from '../config/index.js'
import type pino from 'pino'

const CHUNK_SIZE = 25

export interface BatchDeps {
  client: ImapClient
  activityLog: ActivityLog
  rules: Rule[]
  reviewFolder: string
  trashFolder: string
  logger?: pino.Logger
}

export class BatchEngine {
  private cancelRequested = false
  private running = false
  // ... state fields

  constructor(deps: BatchDeps) { /* store deps */ }

  updateRules(rules: Rule[]): void { this.rules = rules }

  getState(): BatchState { return { ...this.state } }

  async dryRun(sourceFolder: string): Promise<DryRunGroup[]> {
    if (this.running) throw new Error('Batch already running')
    this.running = true
    this.state.status = 'dry-running'
    try {
      const messages = await this.deps.client.fetchAllMessages(sourceFolder)
      // evaluate each, group by destination
      this.state.status = 'previewing'
      return groups
    } catch (err) {
      this.state.status = 'error'
      throw err
    } finally {
      this.running = false
    }
  }

  async execute(sourceFolder: string): Promise<BatchResult> {
    if (this.running) throw new Error('Batch already running')
    this.running = true
    this.cancelRequested = false
    this.state.status = 'executing'
    try {
      const messages = await this.deps.client.fetchAllMessages(sourceFolder)
      const ctx: ActionContext = {
        client: this.deps.client,
        reviewFolder: this.deps.reviewFolder,
        trashFolder: this.deps.trashFolder,
      }
      // chunked processing with yield
      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        if (this.cancelRequested) {
          this.state.status = 'cancelled'
          break
        }
        const chunk = messages.slice(i, i + CHUNK_SIZE)
        for (const raw of chunk) {
          const msg = reviewMessageToEmailMessage(raw)
          const matched = evaluateRules(this.deps.rules, msg)
          if (!matched) { this.state.skipped++; continue }
          try {
            const result = await executeAction(ctx, msg, matched)
            this.deps.activityLog.logActivity(result, msg, matched, 'batch')
            if (result.success) this.state.moved++
            else this.state.errors++
          } catch (err) {
            this.state.errors++
          }
          this.state.processed++
        }
        // Yield between chunks
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      if (this.state.status === 'executing') this.state.status = 'completed'
      return this.buildResult()
    } finally {
      this.running = false
      this.state.completedAt = new Date().toISOString()
    }
  }

  cancel(): void {
    if (this.running) this.cancelRequested = true
  }
}
```

### Batch API Routes (follows existing route pattern)
```typescript
// Source: mirrors src/web/routes/status.ts pattern
import type { FastifyInstance } from 'fastify'
import type { ServerDeps } from '../server.js'

export function registerBatchRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // POST /api/batch/dry-run — start dry-run evaluation
  app.post('/api/batch/dry-run', async (req, reply) => {
    const { sourceFolder } = req.body as { sourceFolder: string }
    const engine = deps.getBatchEngine()
    const results = await engine.dryRun(sourceFolder)
    return { results }
  })

  // POST /api/batch/execute — start batch execution
  app.post('/api/batch/execute', async (req, reply) => {
    const { sourceFolder } = req.body as { sourceFolder: string }
    const engine = deps.getBatchEngine()
    // Fire and forget -- execution runs server-side (D-13)
    engine.execute(sourceFolder).catch((err) => { /* logged internally */ })
    return { status: 'started' }
  })

  // POST /api/batch/cancel — cancel running batch
  app.post('/api/batch/cancel', async () => {
    deps.getBatchEngine().cancel()
    return { status: 'cancelling' }
  })

  // GET /api/batch/status — poll for batch state
  app.get('/api/batch/status', async () => {
    return deps.getBatchEngine().getState()
  })
}
```

### ActivityLog Source Type Update
```typescript
// Source: src/log/index.ts line 80 -- expand source union
logActivity(
  result: ActionResult,
  message: EmailMessage,
  rule: Rule | null,
  source: 'arrival' | 'sweep' | 'batch' = 'arrival'
): void { /* unchanged implementation */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Move all at once | Chunked with yields | N/A (new feature) | Required for shared IMAP connection |
| No cancellation | Cancel-between-chunks | N/A (new feature) | Cooperative cancellation via flag |
| No preview | Dry-run evaluate-only pass | N/A (new feature) | Safety valve before destructive moves |

**Nothing deprecated or outdated** -- this phase uses existing stable primitives.

## Open Questions

1. **Exact source folder handling for `moveMessage`**
   - What we know: `moveMessage(uid, destination, sourceFolder)` defaults sourceFolder to 'INBOX'. Batch operates on arbitrary source folders.
   - What's unclear: Confirmed by reading `client.ts` line 150 -- the third param `sourceFolder` defaults to `'INBOX'` but can be any folder. Batch must pass the actual source folder.
   - Recommendation: Always pass `sourceFolder` explicitly in batch operations. This is already supported.

2. **Activity log index migration strategy**
   - What we know: STATE.md flags this as a gap. Batch will create hundreds of entries per job.
   - What's unclear: Whether existing `migrate()` pattern (try ALTER, catch if exists) extends cleanly to CREATE INDEX.
   - Recommendation: Add index creation in the existing `migrate()` method using the same try/catch pattern: `CREATE INDEX IF NOT EXISTS idx_activity_source ON activity(source)` and `CREATE INDEX IF NOT EXISTS idx_activity_folder_success ON activity(folder, success)`.

3. **Dry-run memory for very large folders**
   - What we know: Dry-run stores all grouped results including per-message details (D-06 says expandable groups).
   - What's unclear: At 50,000 messages, the dry-run response could be large.
   - Recommendation: For v1, accept this. Dry-run results are held in memory on the server. The API returns them on demand. If needed later, paginate the messages within each group.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/batch` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BATC-01 | Batch evaluates all messages in source folder against full ruleset | unit | `npx vitest run test/unit/batch/engine.test.ts -t "evaluates all messages"` | Wave 0 |
| BATC-02 | First-match-wins evaluation without age constraints | unit | `npx vitest run test/unit/batch/engine.test.ts -t "first match wins"` | Wave 0 |
| BATC-03 | Chunked moves with per-message error isolation | unit | `npx vitest run test/unit/batch/engine.test.ts -t "chunked" -t "error isolation"` | Wave 0 |
| BATC-05 | Cancel stops after current chunk | unit | `npx vitest run test/unit/batch/engine.test.ts -t "cancel"` | Wave 0 |
| BATC-06 | Dry-run evaluates without executing moves | unit | `npx vitest run test/unit/batch/engine.test.ts -t "dry-run"` | Wave 0 |
| API | Batch routes return correct responses | unit | `npx vitest run test/unit/web/batch.test.ts` | Wave 0 |
| LOG | Activity log accepts 'batch' source | unit | `npx vitest run test/unit/log/activity.test.ts -t "batch"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/batch`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/batch/engine.test.ts` -- covers BATC-01, BATC-02, BATC-03, BATC-05, BATC-06
- [ ] `test/unit/web/batch.test.ts` -- covers batch API routes
- [ ] `test/unit/batch/` directory -- needs creation

## Sources

### Primary (HIGH confidence)
- `src/sweep/index.ts` -- ReviewSweeper pattern (structural template for BatchEngine)
- `src/actions/index.ts` -- executeAction, ActionContext, ActionResult types
- `src/rules/evaluator.ts` -- evaluateRules implementation
- `src/imap/client.ts` -- ImapClient.fetchAllMessages, moveMessage, withMailboxLock, withMailboxSwitch
- `src/imap/messages.ts` -- EmailMessage, ReviewMessage, reviewMessageToEmailMessage
- `src/log/index.ts` -- ActivityLog.logActivity source parameter
- `src/web/server.ts` -- ServerDeps pattern, route registration
- `src/index.ts` -- Engine instantiation, config change wiring
- `src/monitor/index.ts` -- Monitor pattern (processing guard, state exposure)
- `src/shared/types.ts` -- Shared API response types

### Secondary (MEDIUM confidence)
- Node.js `setImmediate` -- standard yielding mechanism for cooperative multitasking in event loop

### Tertiary (LOW confidence)
- None. All findings verified from codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all primitives exist in codebase
- Architecture: HIGH -- direct mirror of ReviewSweeper pattern verified in source
- Pitfalls: HIGH -- identified from reading actual code paths (lock contention, source tagging, UID stability)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable -- no external dependency changes expected)
