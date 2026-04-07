# Project Research Summary

**Project:** Mail Manager — Folder Taxonomy, Tree Picker, Batch Filing
**Domain:** IMAP email management tooling for a single-user Fastmail account
**Researched:** 2026-04-06
**Confidence:** HIGH

## Executive Summary

This milestone adds three tightly-coupled capabilities to an existing Node.js IMAP management system: folder taxonomy discovery, a tree picker UI for the rule editor, and a retroactive batch filing engine. The existing stack (imapflow, Fastify, vanilla JS SPA, SQLite, esbuild) already contains every tool needed — imapflow's `listTree()` provides the folder hierarchy, `messageMove()` handles batch moves, and native SSE via `reply.raw` serves progress updates. Zero new npm dependencies are required. The correct implementation strategy is surgical addition of four new components (FolderCache, FolderRoute, BatchFiler, BatchRoute) that bolt onto the existing layered architecture without restructuring it.

The recommended build order follows a strict dependency chain: FolderCache must exist before the tree picker can be built, and the BatchFiler core must exist before any progress UI. The folder taxonomy layer is the foundation that unlocks both the picker and batch validation. The tree picker is the immediate UX improvement; batch filing is the heavyweight capability. Both the dry-run preview and chunked chunk-release processing are non-negotiable from day one — retrofitting them afterward is a rewrite.

The dominant risks are not architectural but operational: IMAP UID invalidation during batch runs, single-connection contention blocking the live monitor, and Fastmail-specific folder encoding surprises. These pitfalls are well-understood and their mitigations are clear. The project also carries three pre-existing concerns (activity log unindexed, XSS via dynamic IMAP content, DOM inefficiency) that batch filing will amplify and that must be addressed in this milestone.

## Key Findings

### Recommended Stack

The existing stack handles everything this milestone requires. imapflow's `listTree()` returns a pre-built hierarchical tree with `path`, `name`, `specialUse`, and `folders[]` children — no reconstruction from delimiters needed. Batch moves use `messageMove(range, destination, { uid: true })` with UID range compression to stay within IMAP's ~8KB command line limit. Progress reporting uses native SSE via Fastify's `reply.raw` — a Fastify SSE plugin would be abstraction for no gain. Job tracking uses an in-memory `Map<string, BatchJob>` with `crypto.randomUUID()` for IDs; `better-sqlite3` (already present) persists completed job results to the activity log.

**Core technologies:**
- `imapflow` 1.2.8: folder discovery (`listTree()`) and batch moves (`messageMove()`) — already in stack, verified from source
- `fastify` (existing): REST routes + SSE via `reply.raw` — no plugin needed
- Vanilla JS SPA + `h()` builder (existing): hand-rolled tree picker (~80-120 lines) — no library fits cleanly
- `better-sqlite3` (existing): activity log persistence for batch job results — no schema changes needed
- Node.js built-ins (`AbortController`, `crypto.randomUUID()`, `EventEmitter`): cancellation, job IDs, progress events

### Expected Features

**Must have (table stakes):**
- IMAP folder list discovery via `GET /api/folders` — picker and validation both require it
- Hierarchical folder display in the rule editor — flat dropdowns are unusable past ~30 folders
- Folder picker replacing the raw text input in the rule editor modal
- Batch filing engine with per-chunk progress reporting via SSE
- Batch cancellation with "stop after current chunk" semantics
- Folder path validation on rule save (warn if folder not in cached list)
- Sweep settings editable in UI (currently display-only; already a stated requirement)

**Should have (differentiators):**
- Dry-run mode — show match count and sample subjects before executing; critical given IMAP moves are irreversible
- Batch filing summary report — moved/skipped/errored counts, logged to activity table
- Folder search/filter in the picker — essential for 20-year Fastmail accounts with hundreds of folders
- Recently-used folders surfaced at top of picker
- Default archive destination per stream (Inbox vs. Review contexts)

**Defer (v2+):**
- Folder usage statistics (message counts via IMAP STATUS) — useful but not blocking any workflow
- Virtual scrolling in tree picker — unnecessary below ~500 folders
- Undo batch filing — feasible (track UIDs, move back) but adds complexity; dry-run prevents the problem

### Architecture Approach

Three new components bolt onto the existing architecture without restructuring it: `FolderCache` (in-memory TTL cache wrapping `imapflow.listTree()`), `BatchFiler` (EventEmitter-based worker that chunks through messages with AbortController cancellation), and their corresponding Fastify route registrars following the existing `registerXRoutes(app, deps)` pattern. `ServerDeps` gains two accessors: `getFolderCache()` and `getBatchManager()`. The tree picker is a pure frontend component communicating via DOM events within the existing vanilla JS SPA pattern. Both FolderCache and BatchFiler are initialized after ImapClient in `main()` and rebuilt on IMAP config change, following the existing monitor/sweeper rebuild pattern.

**Major components:**
1. `FolderCache` — fetches/caches IMAP folder tree; `getTree()` / `invalidate()`; 5-minute TTL
2. `BatchFiler extends EventEmitter` — chunked message iteration, AbortController cancellation, emits `progress` / `complete` / `cancelled`; checks UIDVALIDITY at start
3. `BatchManager` — owns the `Map<jobId, BatchFiler>` job registry; cleans up completed jobs
4. Tree Picker UI — `renderFolderTree(container, folders, onSelect)` using flat list with indentation; expand/collapse local state; keyboard navigation
5. Batch Panel UI — SSE `EventSource` consumer; progress counter; cancel button; dry-run preview
6. `Folders Route` — `GET /api/folders`, `POST /api/folders/refresh`
7. `Batch Route` — `POST /api/batch`, `GET /api/batch/:id/progress` (SSE), `POST /api/batch/:id/cancel`

### Critical Pitfalls

1. **UID invalidation during batch runs** — Check UIDVALIDITY at batch start; treat per-message move failures as non-fatal (log, skip, continue); report in final summary. Hold the mailbox lock per chunk, not per message.

2. **Single IMAP connection contention** — The monitor and sweeper share the same connection. A multi-minute batch hold blocks live mail processing. Chunk at 25-50 messages, release the mailbox lock between chunks, yield to the event loop. Consider a dedicated second IMAP connection for batch operations.

3. **Fastmail folder encoding** — Fastmail uses `.` as internal delimiter with caret substitution; international names use Modified UTF-7. Never construct folder paths by hand. Use `path` from ImapFlow's `list()` verbatim as the canonical identifier; decode only for display.

4. **EXPUNGE side effects during MOVE** — RFC 6851 MOVE is COPY+STORE \Deleted+EXPUNGE. On servers without UID EXPUNGE, unrelated `\Deleted` messages get nuked. Fastmail supports UID MOVE — verify ImapFlow uses it; never set `\Deleted` flags manually in batch logic.

5. **Batch against the wrong folder** — IMAP moves are irreversible. Always run dry-run preview before full execution. Show "347 of 15,000 messages match — proceed?" before moving anything.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Folder Taxonomy Foundation
**Rationale:** FolderCache is a prerequisite for the tree picker, batch folder-path validation, and folder usage statistics. Building it first unblocks all downstream work and is independently testable via the API.
**Delivers:** `GET /api/folders` and `POST /api/folders/refresh` endpoints; in-memory TTL cache; `FolderNode` type definition
**Addresses:** Folder list discovery, folder path validation on rule save
**Avoids:** Fastmail encoding pitfall (use ImapFlow's `path` verbatim from day one); stale cache pitfall (TTL + manual refresh endpoint)

### Phase 2: Tree Picker UI
**Rationale:** Depends only on Phase 1. Pure frontend work. Immediately fixes the most visible UX gap (raw text input for folder destinations). No batch infrastructure needed.
**Delivers:** `renderFolderTree()` component in the rule editor modal; expand/collapse; click-to-select; special-use icons; `\Noselect` greying; keyboard navigation; folder search/filter
**Uses:** `GET /api/folders` from Phase 1
**Avoids:** Tree state management bloat (local component state, flat list with indentation); special-use folder confusion; non-selectable folder pitfall

### Phase 3: Batch Filing Core
**Rationale:** BatchFiler is the heaviest new component and is foundational for all batch UX. Must be designed with chunking, UIDVALIDITY checking, and AbortController cancellation from the start — these cannot be retrofitted.
**Delivers:** `BatchFiler` service; `BatchManager`; `POST /api/batch` and `POST /api/batch/:id/cancel` routes; activity log entries with `source: 'batch'`; dry-run mode
**Uses:** FolderCache (path validation); existing `evaluateRules()`; existing `withMailboxLock`; `imapflow.messageMove()` with UID range compression
**Avoids:** UID invalidation (UIDVALIDITY check at start); EXPUNGE side effects (UID MOVE only); connection contention (25-50 message chunks with lock release); rate limiting (group UIDs per destination into single MOVE command)

### Phase 4: Batch Progress UI and Polish
**Rationale:** SSE progress stream and the Batch Panel UI depend on BatchFiler being stable. Building the UI after the core avoids chasing a moving target.
**Delivers:** Batch Panel UI; SSE `EventSource` consumer; count-based progress display ("150 of 2000"); separate failure tracking; dry-run preview dialog; cancel button with "stop after current chunk" label; batch summary report
**Avoids:** Misleading progress (count-based, not percentage); cancel semantics confusion; wrong-folder disasters (dry-run gate)

### Phase 5: Sweep Settings and Config Extensions
**Rationale:** Independent of all other phases. Low-complexity fix to an already-identified gap. Batching it with earlier phases would add noise to more complex work.
**Delivers:** Editable sweep settings form (wire up PUT endpoint, Zod validation already exists); default archive destination per stream (Inbox vs. Review context)
**Addresses:** Sweep settings editable, default archive per-stream features

### Phase Ordering Rationale

- FolderCache before tree picker: the picker is a consumer of the folder API; nothing to render without it
- Tree picker before batch UI: batch panel needs a folder picker for source/destination selection
- BatchFiler core before batch UI: SSE stream has nothing to emit without a running job
- Sweep settings last: fully independent; does not block or depend on anything

Chunking and UIDVALIDITY handling must be built into Phase 3 from scratch. The architecture research and pitfalls research are in full agreement on this — it is explicitly flagged as a rewrite risk if deferred.

### Research Flags

Phases with well-documented patterns (skip additional research):
- **Phase 1 (FolderCache):** imapflow `listTree()` API is verified from source; TTL cache pattern is standard Node.js
- **Phase 2 (Tree Picker):** vanilla JS component pattern follows existing codebase exactly; no unknowns
- **Phase 5 (Sweep Settings):** wiring an existing form to an existing PUT endpoint; Zod schema already present

Phases that may benefit from deeper research during planning:
- **Phase 3 (BatchFiler core):** UIDVALIDITY handling and UID range compression are IMAP-specific; worth reviewing RFC 3501 and imapflow source before writing the chunking logic. The second-connection option for batch operations needs evaluation against Fastmail's concurrent connection limits.
- **Phase 4 (Batch Panel UI):** SSE reconnection behavior (EventSource auto-reconnect on drop) and job state cleanup on reconnect need design decisions before building the UI.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All key APIs verified directly from imapflow source in node_modules; SSE is a web standard |
| Features | HIGH | Clear table stakes from domain analysis; MVP ordering is well-reasoned with explicit defer rationale |
| Architecture | HIGH | Component boundaries derived from existing codebase analysis; all patterns follow established conventions |
| Pitfalls | HIGH | Four critical pitfalls sourced from RFCs, Fastmail documentation, and Mozilla bug history; well-evidenced |

**Overall confidence:** HIGH

### Gaps to Address

- **Second IMAP connection for batch:** Research recommends it as a mitigation for connection contention but does not verify Fastmail's concurrent connection limit. Check Fastmail's IMAP connection policy before committing to this approach in Phase 3.
- **Activity log indexing:** PITFALLS.md flags the unindexed activity log as a pre-existing concern that batch filing (hundreds of new log entries per job) will amplify. An index migration should be added before Phase 3 ships, but the exact index columns need validation against the actual query patterns.
- **Folder search UX in picker:** Research recommends including search/filter in Phase 2, but the exact interaction model (filter-as-you-type vs. search button, ancestor inclusion in filtered results) is a UX design decision not resolved by research.

## Sources

### Primary (HIGH confidence)
- `node_modules/imapflow/lib/imap-flow.js` — `listTree()`, `messageMove()`, `list()` implementations verified from source
- `node_modules/imapflow/lib/tools.js` — `getFolderTree()` implementation
- [RFC 3501 - IMAP4rev1](https://www.rfc-editor.org/rfc/rfc3501) — UID, UIDVALIDITY, sequence numbers, Modified UTF-7
- [RFC 6851 - IMAP MOVE Extension](https://datatracker.ietf.org/doc/html/rfc6851.html) — MOVE atomicity, EXPUNGE side effects
- [Fastmail: What's in a name](https://www.fastmail.com/blog/whats-in-a-name-mailbox-names-via-imap/) — Fastmail-specific encoding, caret substitution, delimiter history
- Existing codebase: `src/imap/client.ts`, `src/web/server.ts`, `src/web/frontend/app.ts`, `src/actions/index.ts`

### Secondary (MEDIUM confidence)
- [ImapFlow Documentation](https://imapflow.com/docs/api/imapflow-client/) — public API surface
- [ImapFlow Mailbox Listing - DeepWiki](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing) — tree structure and encoding handling
- [ImapFlow Message Operations - DeepWiki](https://deepwiki.com/postalsys/imapflow/5-message-operations) — batch move patterns

### Tertiary (supporting)
- [Mozilla Bug 538375](https://bugzilla.mozilla.org/show_bug.cgi?id=538375) — batch move timeout failure patterns
- [Mozilla Bug 610131](https://bugzilla.mozilla.org/show_bug.cgi?id=610131) — batch move duplicate/hang issues
- [RFC 9586 - IMAP UID-only Extension](https://datatracker.ietf.org/doc/rfc9586/) — UID MOVE safety considerations

---
*Research completed: 2026-04-06*
*Ready for roadmap: yes*
