# Architecture Patterns

**Domain:** IMAP folder taxonomy discovery, tree picker UI, and retroactive batch filing
**Researched:** 2026-04-06

## Recommended Architecture

Three new components bolt onto the existing layered architecture without restructuring it. The folder taxonomy is a read-through cache that serves both the tree picker and batch filing. Batch filing is a standalone worker that reuses the existing rule evaluator and action executor.

```
                         Frontend SPA
                    /        |         \
              Tree Picker  Rule Editor  Batch Panel
                    \        |         /
                     REST API (Fastify)
                   /    |    |    \
           Folders  Rules  Batch   SSE stream
           Route   Route  Route   (progress)
              |      |      |
        FolderCache  |   BatchFiler -------> ActivityLog
              |      |      |     \
         ImapClient  |  evaluateRules()
          .list()    |  .moveMessage()
                     |
               ConfigRepository
```

### Component Boundaries

| Component | Responsibility | Communicates With | New/Existing |
|-----------|---------------|-------------------|--------------|
| **FolderCache** | Fetch and cache IMAP folder tree; invalidate on TTL or demand | ImapClient (reads), Folders Route (serves) | NEW |
| **Folders Route** | Expose `GET /api/folders` returning tree structure | FolderCache, ServerDeps | NEW |
| **Tree Picker** | Frontend component rendering folder hierarchy for selection | Folders Route (fetches), Rule Editor (emits selection) | NEW |
| **BatchFiler** | Apply a rule or move operation to existing messages in a folder | ImapClient (fetch+move), evaluateRules, ActivityLog | NEW |
| **Batch Route** | Start/cancel batch jobs, stream progress via SSE | BatchFiler, ServerDeps | NEW |
| **Batch Panel** | Frontend UI showing batch progress, cancel button | Batch Route (REST + SSE) | NEW |
| ImapClient | IMAP operations (already has `list()`, `moveMessage()`, `fetchAllMessages()`) | IMAP server | EXISTING - minor additions |
| ActivityLog | Persist actions for audit | SQLite | EXISTING - no changes |
| evaluateRules | First-match-wins rule evaluation | Rules config | EXISTING - no changes |

## Data Flow

### Folder Taxonomy Discovery

1. Frontend tree picker mounts, calls `GET /api/folders`
2. Folders route checks FolderCache for fresh data (TTL: 5 minutes)
3. On cache miss: FolderCache calls `ImapClient.listTree()` (ImapFlow native method)
4. ImapFlow returns hierarchical mailbox objects with `path`, `delimiter`, `specialUse`, `flags`, `folders` (children)
5. FolderCache normalizes into a flat-friendly tree: `{ path, name, delimiter, specialUse, children[] }`
6. Route returns JSON tree to frontend
7. Frontend renders collapsible tree; user clicks a folder to select it
8. Selected folder path is inserted into rule's `action.folder` field

**Key design decision:** Use `listTree()` not `list()`. ImapFlow's `listTree()` returns pre-built hierarchy -- no need to reconstruct parent/child from delimiter parsing. The existing `getSpecialUseFolder()` already calls `list()` so the client interface supports both.

**Cache strategy:** In-memory with TTL. No SQLite persistence needed for folder taxonomy -- it changes rarely (user manages folders in Mac Mail), the IMAP call is fast (Fastmail responds in <100ms for LIST), and stale data just means a folder added in Mac Mail takes 5 minutes to appear. A manual "refresh" button on the tree picker provides escape hatch.

```typescript
// FolderCache shape
interface FolderNode {
  path: string;          // Full IMAP path e.g. "Projects/Active/2024"
  name: string;          // Display name e.g. "2024"
  delimiter: string;     // Hierarchy separator e.g. "/"
  specialUse?: string;   // e.g. "\\Trash", "\\Sent"
  flags: string[];       // IMAP flags e.g. ["\\HasChildren"]
  children: FolderNode[];
}

interface FolderCache {
  getTree(): Promise<FolderNode[]>;  // Returns cached or fetches fresh
  invalidate(): void;                // Force refresh on next call
}
```

### Batch Filing Flow

1. User selects a source folder and a target rule (or explicit destination folder) in Batch Panel
2. Frontend calls `POST /api/batch` with `{ sourceFolder, ruleId?, destinationFolder?, dryRun? }`
3. Batch route validates, creates a BatchFiler instance, starts it
4. Frontend opens `GET /api/batch/:jobId/progress` SSE stream
5. BatchFiler fetches all messages from source folder via `ImapClient.fetchAllMessages()`
6. For each message:
   - If `ruleId` provided: evaluate that single rule against message
   - If `destinationFolder` provided: move unconditionally
   - If no match (rule mode): skip message
   - Move matched messages via `ImapClient.moveMessage(uid, destination, sourceFolder)`
   - Log to ActivityLog with `source: 'batch'`
   - Emit progress event: `{ processed, total, moved, skipped, errors, currentMessage }`
7. On completion or cancellation: emit final event, clean up job state

**Cancellation:** BatchFiler checks an `AbortSignal` between message iterations. Frontend calls `POST /api/batch/:jobId/cancel` which triggers the signal. The filer finishes its current message move (atomic IMAP operation) then stops.

**Dry run:** Same flow but skips the `moveMessage()` call. Returns what would happen without touching mail. Essential for a 20-year mailbox -- users need to preview before committing.

```
POST /api/batch
  { sourceFolder: "INBOX", ruleId: "rule-123", dryRun: false }
  -> { jobId: "batch-abc", status: "started", total: 1547 }

GET /api/batch/batch-abc/progress  (SSE)
  -> event: progress
     data: { processed: 100, total: 1547, moved: 43, skipped: 57, errors: 0 }
  -> event: progress
     data: { processed: 200, total: 1547, moved: 89, skipped: 111, errors: 0 }
  ...
  -> event: complete
     data: { processed: 1547, moved: 612, skipped: 930, errors: 5 }

POST /api/batch/batch-abc/cancel
  -> { status: "cancelling" }
```

### Tree Picker Communication

The tree picker is a pure frontend component -- no state management changes needed. It communicates via DOM events within the existing vanilla JS SPA pattern.

```
Rule Editor Form
  |
  +-- Folder Input (text field, currently)
  |     |
  |     +-- "Browse" button click
  |           |
  |           +-- Tree Picker overlay opens
  |                 |
  |                 +-- Fetches GET /api/folders (or uses cached)
  |                 +-- Renders collapsible tree
  |                 +-- User clicks folder node
  |                 +-- Emits custom event with selected path
  |                 +-- Rule Editor sets folder input value
  |                 +-- Overlay closes
```

This follows the existing frontend pattern: direct DOM manipulation, `fetch()` to API, no framework.

## Patterns to Follow

### Pattern 1: Service + Route Registration (existing pattern)

New features follow the established pattern: a service class with clear interfaces, a route registrar that takes `ServerDeps`, and registration in `buildServer()`.

**When:** Adding FolderCache and BatchFiler.

**Example:**
```typescript
// src/folders/cache.ts
export class FolderCache {
  constructor(private client: ImapClient, private ttlMs = 300_000) {}
  async getTree(): Promise<FolderNode[]> { /* ... */ }
  invalidate(): void { /* ... */ }
}

// src/web/routes/folders.ts
export function registerFolderRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/folders', async () => {
    return deps.getFolderCache().getTree();
  });
  app.post('/api/folders/refresh', async () => {
    deps.getFolderCache().invalidate();
    return deps.getFolderCache().getTree();
  });
}

// server.ts - add to buildServer
registerFolderRoutes(app, deps);
```

### Pattern 2: SSE for Long-Running Operations

Use raw Fastify response streaming for SSE rather than a plugin. The project avoids unnecessary dependencies (vanilla JS frontend, no build tooling). SSE is simple enough to implement directly -- it is just `text/event-stream` content type with `data: ...\n\n` framing.

**When:** Batch filing progress reporting.

**Example:**
```typescript
app.get('/api/batch/:jobId/progress', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = batchManager.getJob(jobId);
  if (!job) return reply.status(404).send({ error: 'Job not found' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const onProgress = (data: BatchProgress) => {
    reply.raw.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onComplete = (data: BatchResult) => {
    reply.raw.write(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
    reply.raw.end();
  };

  job.on('progress', onProgress);
  job.on('complete', onComplete);
  request.raw.on('close', () => {
    job.off('progress', onProgress);
    job.off('complete', onComplete);
  });
});
```

### Pattern 3: AbortController for Cancellation

Use Node.js native `AbortController` for batch job cancellation. Check `signal.aborted` in the message iteration loop. This is clean, standard, and requires no external dependencies.

**When:** Batch filing cancellation.

```typescript
class BatchFiler extends EventEmitter {
  private controller = new AbortController();

  async run(sourceFolder: string, opts: BatchOptions): Promise<void> {
    const messages = await this.client.fetchAllMessages(sourceFolder);
    this.emit('progress', { total: messages.length, processed: 0 });

    for (const msg of messages) {
      if (this.controller.signal.aborted) {
        this.emit('cancelled', { processed: this.processed });
        return;
      }
      // ... evaluate and move
    }
  }

  cancel(): void {
    this.controller.abort();
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing Folder Taxonomy in SQLite

**What:** Persisting the IMAP folder tree to the database and syncing it periodically.
**Why bad:** The IMAP server IS the source of truth. Adding a SQLite mirror creates sync bugs, stale data, and migration headaches. The folder list changes infrequently (user manages it in Mac Mail) and the IMAP LIST command is cheap.
**Instead:** In-memory cache with short TTL. Treat IMAP as the database for folder structure.

### Anti-Pattern 2: WebSocket for Batch Progress

**What:** Using WebSocket instead of SSE for progress reporting.
**Why bad:** WebSocket is bidirectional -- batch progress is strictly server-to-client. WebSocket adds connection upgrade complexity, requires a separate protocol, and complicates the vanilla JS frontend. SSE works with native `EventSource` API, auto-reconnects, and is simpler to implement on both sides.
**Instead:** SSE via `text/event-stream`. One-directional push is exactly what batch progress needs.

### Anti-Pattern 3: Parallel Message Moves in Batch Filing

**What:** Moving multiple messages concurrently to speed up batch filing.
**Why bad:** IMAP sessions are single-command-at-a-time. ImapFlow serializes operations internally. Attempting concurrent moves on the same connection either deadlocks (waiting for mailbox locks) or creates race conditions. The existing `withMailboxLock` pattern enforces serialization already.
**Instead:** Sequential iteration with progress reporting. The bottleneck is IMAP round-trip latency (~50ms per move on Fastmail), so 1000 messages takes ~50 seconds. Report progress so the user knows it is working.

### Anti-Pattern 4: Polling for Batch Progress

**What:** Frontend polling `GET /api/batch/:id/status` every N seconds.
**Why bad:** Creates unnecessary HTTP overhead, introduces latency between updates (user sees stale counts), and the UI feels janky compared to real-time updates.
**Instead:** SSE stream opened once, updates pushed as they happen.

## Integration with Existing Architecture

### ServerDeps Extension

```typescript
export interface ServerDeps {
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  getMonitor: () => Monitor;
  getSweeper: () => ReviewSweeper | undefined;
  getFolderCache: () => FolderCache;       // NEW
  getBatchManager: () => BatchManager;      // NEW
  staticRoot?: string;
}
```

### Initialization in main()

FolderCache and BatchManager are created after the ImapClient, following the existing pattern. They use the same client instance.

```typescript
// After ImapClient creation:
let folderCache = new FolderCache(imapClient);
const batchManager = new BatchManager(imapClient, activityLog);

// On IMAP config change (existing pattern, extended):
configRepo.onImapConfigChange(async (newConfig) => {
  // ... existing monitor/sweeper rebuild ...
  folderCache = new FolderCache(newClient);
  batchManager.updateClient(newClient);
});
```

### Batch Filing and Monitor Interaction

Batch filing and the monitor run on the same ImapClient. The `withMailboxLock` pattern already serializes folder access -- if the monitor is processing INBOX and a batch job wants to move from a different folder, they acquire different locks and proceed independently. If both touch the same folder, one waits.

The only concern: batch filing should NOT trigger the monitor's newMail handler when moving messages INTO INBOX (unlikely use case, but possible). The monitor already deduplicates by UID tracking, so this is safe -- messages moved to INBOX would have UIDs below `lastUid` and be ignored.

### Activity Log Integration

Batch actions use the existing `ActivityLog.logActivity()` with `source: 'batch'`. The activity table already has a `source` column (values: `'arrival'`, `'sweep'`). Adding `'batch'` requires no schema changes.

## Scalability Considerations

| Concern | At 100 messages | At 10K messages | At 100K messages |
|---------|----------------|-----------------|------------------|
| Folder tree fetch | <100ms, no concern | N/A (folder count, not msg count) | N/A |
| Batch filing time | ~5 seconds | ~8 minutes | ~80 minutes |
| Batch memory | Negligible | ~50MB (all envelopes in memory) | Needs pagination |
| SSE connection | Trivial | Trivial | Same -- just more events |
| IMAP connection | Shared, no issue | Shared, batch holds lock longer | May starve monitor |

**At scale (100K+ messages):** The `fetchAllMessages()` call loads all envelopes into memory at once. For very large folders, a paginated fetch approach would be needed -- fetch in batches of 500 UIDs. This is a known limitation of the existing sweep code too, so it is not unique to batch filing. Flag it for later if the user's folders get that large.

**Monitor starvation mitigation:** BatchFiler should yield periodically (e.g., after every 50 moves, release the mailbox lock briefly) to allow the monitor to process incoming mail. A simple `await new Promise(r => setTimeout(r, 0))` between batches of moves gives the event loop a chance to process monitor events.

## Suggested Build Order

Based on dependency analysis, the components should be built in this order:

1. **FolderCache + Folders Route** -- No dependencies on other new components. Enables tree picker development and is independently useful for debugging folder paths.

2. **Tree Picker UI** -- Depends on Folders Route. Pure frontend work. Immediately improves rule editing UX.

3. **BatchFiler core** -- Depends on existing ImapClient, evaluateRules, ActivityLog. No UI needed yet -- can be tested via API.

4. **Batch Routes (REST + SSE)** -- Depends on BatchFiler. Exposes the batch operations to the frontend.

5. **Batch Panel UI** -- Depends on Batch Routes + SSE. Final integration piece.

**Rationale:** FolderCache is foundational (batch filing also uses it to validate folder paths). Tree picker and batch filing are independent branches that can proceed in parallel after FolderCache exists. SSE is only needed for the batch panel, so it comes last.

## Sources

- [ImapFlow documentation](https://imapflow.com/module-imapflow-ImapFlow.html) -- `list()` and `listTree()` methods for mailbox discovery (HIGH confidence)
- [ImapFlow mailbox listing deep wiki](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing) -- Tree structure and hierarchy handling (HIGH confidence)
- [@fastify/sse on GitHub](https://github.com/fastify/sse) -- SSE plugin for Fastify (MEDIUM confidence -- raw SSE is simpler for this use case)
- Existing codebase analysis: `src/imap/client.ts`, `src/actions/index.ts`, `src/sweep/index.ts`, `src/web/server.ts` (HIGH confidence)

---

*Architecture analysis: 2026-04-06*
