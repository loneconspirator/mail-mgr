# Technology Stack

**Project:** Mail Manager - Folder Taxonomy, Tree Picker, Batch Filing
**Researched:** 2026-04-06

## Recommended Stack

This milestone adds three capabilities to an existing system: IMAP folder discovery, a tree picker UI, and batch message filing. The existing stack (imapflow, Fastify, vanilla JS SPA, SQLite, esbuild) is well-suited for all three. No new frameworks are needed. The additions below are surgical.

### IMAP Folder Discovery

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| imapflow (existing) | 1.2.8 | Folder listing via `listTree()` | Already in the stack. `listTree()` returns a pre-built hierarchical tree with `path`, `name`, `delimiter`, `specialUse`, `flags`, and nested `folders[]`. No additional library needed. |

**Key API details (verified from source):**

- `client.listTree(options?)` returns `ListTreeResponse` -- a root node with `{ root: true, folders: ListTreeResponse[] }`.
- Each node: `{ path, name, delimiter, flags, specialUse, listed, subscribed, disabled, folders[] }`.
- `client.list(options?)` returns flat `ListResponse[]` with same fields plus `parent[]`, `parentPath`.
- Both accept `statusQuery` option to request message counts (`{ statusQuery: { messages: true, unseen: true } }`).
- Special-use folders (`\Inbox`, `\Trash`, `\Sent`, `\Drafts`, `\Archive`, `\Junk`, `\All`, `\Flagged`) are auto-detected.
- The code already calls `client.list()` in `getSpecialUseFolder()` -- `listTree()` uses the same underlying LIST command.

**Recommendation:** Use `listTree()` for the tree picker API endpoint. Use `list()` with `statusQuery` when you need message counts (for batch filing target selection). Cache the folder list in memory with a short TTL (30-60 seconds) since folder structure rarely changes mid-session.

**Confidence:** HIGH -- verified directly from imapflow source code in node_modules.

### Tree Picker UI

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Hand-rolled tree component | N/A | Folder tree picker in rule editor | The existing frontend is vanilla JS with a custom `h()` element builder. Adding a third-party tree library would be architecturally inconsistent and overkill for a single-use folder picker. |

**Why NOT use a library:**

| Library | Why Not |
|---------|---------|
| js-treeview | Unmaintained (last commit 2019), brings its own CSS that conflicts with existing styles, designed for general-purpose trees not folder pickers. |
| VanillaTree | Context menu focused, jQuery-era API patterns, overkill for a read-only folder picker. |
| Plain Tree | Closest fit but still adds an unnecessary dependency for ~80 lines of recursive DOM building. |

**What to build instead:**

A `renderFolderTree(container, folders, onSelect)` function that:
1. Takes the `ListTreeResponse.folders` array from the API
2. Recursively renders `<ul>/<li>` with expand/collapse toggles
3. Calls `onSelect(path)` when a folder is clicked
4. Highlights the currently-selected folder
5. Shows special-use icons (Inbox, Trash, Sent, etc.) via CSS classes
6. Supports keyboard navigation (arrow keys, Enter to select)

This is ~80-120 lines of TypeScript. It lives in the existing esbuild-bundled frontend. No new build tooling.

**CSS approach:** Add a `.folder-tree` section to the existing `styles.css`. Use CSS `details/summary` or manual toggle state -- both work fine. Manual toggle gives more control over keyboard behavior.

**Confidence:** HIGH -- the existing codebase already builds all UI this way.

### Batch Message Operations

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| imapflow (existing) | 1.2.8 | `messageMove()` for batch filing | Already in the stack. Accepts UID ranges like `"1:100"` or UID arrays. Single IMAP MOVE command per batch. |
| imapflow `search()` | 1.2.8 | Find UIDs matching criteria before move | Returns `Number[]` of matching UIDs. Use to identify which messages in a folder match a rule before batch moving. |

**Batch strategy (verified from imapflow source and IMAP RFC 6851):**

- `messageMove(range, destination, { uid: true })` sends a single IMAP UID MOVE command.
- IMAP command line length limit is ~8KB on most servers. A UID range string of 950 bytes handles ~100 individual UIDs safely.
- For bulk operations: use UID range notation (`"1:*"` or `"100:500"`) when possible -- this is a compact 3-7 byte string regardless of message count.
- When UIDs are non-contiguous (result of search), chunk the UID array into batches of ~200 UIDs and join as comma-separated range string.
- `withMailboxLock()` is already in the codebase and should wrap each batch operation.
- Fastmail (the target server) supports the MOVE extension natively.

**Chunking approach:**

```
UIDs: [1, 2, 3, 50, 51, 100, 200, 201, 202, ...]
Compress to ranges: "1:3,50:51,100,200:202,..."
Chunk if range string exceeds ~900 bytes
Execute each chunk as one messageMove() call
```

**Confidence:** HIGH -- verified from imapflow source and existing codebase patterns.

### Progress Reporting

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Server-Sent Events (native) | N/A | Stream progress updates to UI | SSE is built into every browser and trivial to implement in Fastify without a plugin. No dependency needed. |

**Why NOT use `@fastify/sse` or `fastify-sse-v2`:**

Both plugins add abstraction over something that takes 10 lines of code in raw Fastify:

```typescript
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
});
reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`);
```

The existing codebase uses direct Fastify reply patterns. Adding an SSE plugin for one endpoint is unnecessary overhead. Roll it by hand.

**Client side:** `new EventSource('/api/batch/progress/:jobId')` -- native browser API, zero dependencies.

**Alternative considered:** Polling via `GET /api/batch/status/:jobId`. Simpler but less responsive. For operations that move thousands of messages over 30-60 seconds, SSE provides a meaningfully better user experience. Use SSE.

**Confidence:** HIGH -- SSE is a web standard, Fastify raw reply is well-documented.

### Job Management for Batch Operations

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| In-memory job map | N/A | Track running batch jobs | Single-user system. A `Map<string, BatchJob>` in the server process is sufficient. No Redis, no Bull, no job queue library. |
| better-sqlite3 (existing) | 12.6.2 | Persist batch job results | Log completed jobs to the existing activity log. Resume-after-interrupt uses the last processed UID. |
| crypto.randomUUID() | Node.js built-in | Job IDs | No dependency needed. |

**Job lifecycle:**

1. `POST /api/batch/start` -- creates job, returns `jobId`
2. `GET /api/batch/progress/:jobId` -- SSE stream of `{ processed, total, currentFolder, errors }`
3. `POST /api/batch/cancel/:jobId` -- sets cancellation flag, next chunk checks and stops
4. Job runs in background via `setImmediate()` / chunked async iteration -- does not block the event loop

**Cancellation:** Each chunk checks a `cancelled` boolean before executing the next `messageMove()`. Graceful -- completes the current chunk, then stops. Already-moved messages stay moved (IMAP MOVE is atomic per command).

**Confidence:** HIGH -- standard Node.js patterns for a single-user system.

## Stack Summary: What to Add

**New npm dependencies: ZERO.**

Everything needed is already in the stack or is a native platform capability:

| Capability | Implementation | New Dep? |
|------------|---------------|----------|
| Folder discovery | `imapflow.listTree()` | No |
| Tree picker UI | Custom vanilla JS component | No |
| Batch move | `imapflow.messageMove()` with chunking | No |
| Progress reporting | Native SSE via `reply.raw` | No |
| Job management | In-memory `Map` + existing SQLite | No |
| Job IDs | `crypto.randomUUID()` | No |

This is the correct answer for a single-user system that already has the right tools. Adding libraries to avoid writing 200 lines of straightforward code would be architectural malpractice.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Tree UI | Hand-rolled | js-treeview, VanillaTree | Unmaintained, stylistic mismatch, more code to integrate than to write |
| Progress | Native SSE | @fastify/sse, WebSockets, polling | SSE plugin is overkill for one endpoint; WebSockets is bidirectional overhead we don't need; polling is laggy |
| Job queue | In-memory Map | Bull, BullMQ, Agenda | Job queue libraries are for multi-worker distributed systems. This is one user, one process. |
| Folder cache | TTL Map in memory | Redis, node-cache | Single process, single user. A plain object with a timestamp is sufficient. |
| Batch chunking | Custom UID range compression | No alternative exists as a library | UID range compression is ~30 lines of code specific to IMAP semantics |

## Key imapflow API Reference

For the roadmap implementer, the relevant imapflow methods are:

```typescript
// Folder discovery
interface ListTreeResponse {
  root?: boolean;
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;  // "\Inbox", "\Trash", "\Sent", "\Drafts", etc.
  listed: boolean;
  subscribed: boolean;
  disabled?: boolean;   // true = cannot be selected
  folders: ListTreeResponse[];
}

// client.listTree(options?) → Promise<ListTreeResponse>  (root node)
// client.list(options?) → Promise<ListResponse[]>  (flat array)
// Options: { statusQuery: { messages: true, unseen: true, uidNext: true } }

// Batch operations
// client.messageMove(range, destination, { uid: true }) → Promise<{ uidMap: Map }>
// client.search(query, { uid: true }) → Promise<number[]>
// range can be: "1:*", "1:100", [1, 2, 3], "1:3,50:51,100"
```

## Sources

- imapflow source code: `node_modules/imapflow/lib/imap-flow.js` (ListResponse typedef, listTree, messageMove implementations)
- imapflow source code: `node_modules/imapflow/lib/tools.js` (getFolderTree implementation)
- [ImapFlow Documentation](https://imapflow.com/docs/api/imapflow-client/)
- [ImapFlow Mailbox Listing - DeepWiki](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing)
- [ImapFlow Message Operations - DeepWiki](https://deepwiki.com/postalsys/imapflow/5-message-operations)
- [RFC 6851 - IMAP MOVE Extension](https://datatracker.ietf.org/doc/html/rfc6851)
- [Fastify SSE patterns](https://edisondevadoss.medium.com/fastify-server-sent-events-sse-93de994e013b)
- Existing codebase: `src/imap/client.ts`, `src/web/frontend/app.ts`
