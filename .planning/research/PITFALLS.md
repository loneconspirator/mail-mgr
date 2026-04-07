# Domain Pitfalls

**Domain:** IMAP folder taxonomy, tree picker UI, and batch filing operations
**Researched:** 2026-04-06

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major operational failures.

### Pitfall 1: UID Invalidation During Batch Move Operations

**What goes wrong:** Batch filing iterates over a list of UIDs collected at scan time, then moves them one-by-one (or in chunks). Between the scan and the move, another client (Mac Mail, the sweeper, the monitor) moves or deletes messages. The UIDs either no longer exist in the source folder or, worse, the folder's UIDVALIDITY has changed, meaning every UID you cached is garbage.

**Why it happens:** IMAP UIDs are only stable within a single UIDVALIDITY epoch. Folder renames, server-side compaction, or delete-and-recreate cycles reset UIDVALIDITY. Even within a stable epoch, other clients moving messages out of the folder between your SEARCH and your MOVE means your cached UIDs point at nothing.

**Consequences:** Silent no-ops (message already gone -- best case), error storms flooding the log, or the batch job aborting halfway and leaving the user wondering which messages moved and which did not.

**Prevention:**
1. Check UIDVALIDITY at the start of the batch and compare it to the value from the scan. If it changed, abort and re-scan.
2. Use UID MOVE (not sequence-number MOVE) exclusively -- the codebase already does this via `messageMove` with `{ uid: true }`.
3. Treat individual move failures as non-fatal: log the UID, skip it, continue. Report failures in the final summary.
4. Hold the mailbox lock for the entire batch chunk (not per-message) to prevent interleaving with the monitor or sweeper.

**Detection:** A batch job that reports "0 of 500 messages moved" or errors like "Message not found" on UIDs that definitely existed at scan time.

**Phase relevance:** Batch filing implementation. Must be addressed in the core batch-move logic before any UI work.

---

### Pitfall 2: Single IMAP Connection Contention Kills Batch Operations

**What goes wrong:** The existing architecture uses a single ImapFlow connection shared between the monitor, sweeper, and now batch filing. A batch job that moves 2,000 messages holds `withMailboxLock` for minutes. During that time, the monitor cannot process new mail and the sweeper cannot run. If the batch takes long enough, the IMAP server drops the connection for inactivity on the IDLE side, or the connection times out entirely.

**Why it happens:** CONCERNS.md already flags this: "Monitor and sweeper compete for the same IMAP connection." Batch filing makes it dramatically worse because the lock duration goes from milliseconds (single message move) to minutes or tens of minutes.

**Consequences:** New mail stops being processed for the entire batch duration. If the connection drops mid-batch, you get a partial move with no clean recovery. The user sees the system as "frozen."

**Prevention:**
1. Process batch moves in small chunks (25-50 messages per lock acquisition). Release the lock between chunks so the monitor gets a turn.
2. Add a yield mechanism: after each chunk, release the lock, allow one monitor cycle, then re-acquire.
3. Track batch progress in SQLite so a dropped connection can resume from where it left off, not from the beginning.
4. Consider a dedicated second IMAP connection for batch operations (Fastmail supports multiple concurrent connections).

**Detection:** Monitor's `lastProcessedAt` goes stale during a batch run. Activity log shows a gap in arrival processing.

**Phase relevance:** Must be designed into the batch filing architecture from the start. Retrofitting chunking into a naive "move all in one lock" implementation is a rewrite.

---

### Pitfall 3: Fastmail Hierarchy Delimiter and Encoding Surprises

**What goes wrong:** Fastmail uses `.` as its internal hierarchy delimiter (legacy from Cyrus IMAPd) but presents `/` to clients via altnamespace. Dot characters in folder names appear as `^` (caret) via IMAP on the `mail.messagingengine.com` host. International folder names use Modified UTF-7 encoding (RFC 3501), where `,` replaces `/` in the BASE64 alphabet. A tree picker that displays raw IMAP paths will show mangled names. A folder path you type in the UI may not match the encoded path the server expects.

**Why it happens:** IMAP mailbox naming is a minefield. The protocol is from the 1990s and uses Modified UTF-7 -- not UTF-8 -- for international characters. Fastmail adds its own caret-for-dot substitution on top. ImapFlow handles encoding/decoding internally via `encodePath`/`decodePath`, but if you store or compare paths without going through ImapFlow's normalization, you get mismatches.

**Consequences:** Folder picker shows `INBOX^Receipts` instead of `INBOX.Receipts`. Rules configured with human-readable folder names fail to match server paths. Move operations fail with "folder not found" because the path was not properly encoded.

**Prevention:**
1. Always use the `path` property from ImapFlow's `list()` response as the canonical folder identifier. Never construct paths by hand.
2. Display a decoded/human-readable name in the UI but store the server-canonical path in rules.
3. Do not allow free-text folder entry for the tree picker -- only selection from discovered folders. The existing text input for folder names in the rule editor is the thing being replaced, which is good.
4. Cache the folder list and refresh it on demand, not on every render.

**Detection:** Rules that work in the UI preview but fail when the monitor tries to move messages. Folder names with accented characters or dots displaying incorrectly in the tree.

**Phase relevance:** Folder taxonomy discovery phase. The data model for storing folder paths must be decided before the tree picker is built.

---

### Pitfall 4: EXPUNGE Side Effects During Batch Moves

**What goes wrong:** When you MOVE a message, the server EXPUNGEs it from the source folder. If other messages in that folder are flagged `\Deleted` (e.g., by Mac Mail's delete-then-expunge pattern), the EXPUNGE step may remove those messages too -- not just the ones you intended to move. Additionally, EXPUNGE responses change sequence numbers of all subsequent messages in the folder.

**Why it happens:** RFC 6851 (IMAP MOVE) specifies that MOVE is essentially COPY + STORE \Deleted + EXPUNGE. On servers without UID EXPUNGE (UIDPLUS extension), the EXPUNGE is not scoped to specific UIDs -- it nukes everything with `\Deleted`. Fastmail supports UIDPLUS, but the code must explicitly use it.

**Consequences:** Messages the user deleted in Mac Mail but hadn't expunged yet get permanently removed during a batch filing operation. The user never sees them in Trash.

**Prevention:**
1. Verify that ImapFlow uses UID MOVE (it does when the server supports the MOVE extension, which Fastmail does). Do not fall back to COPY+STORE+EXPUNGE manually.
2. Never set `\Deleted` flags as part of batch filing logic. Let the MOVE command handle it atomically.
3. Add an integration test that verifies a MOVE of message A does not EXPUNGE an unrelated message B that has `\Deleted` set.

**Detection:** Users report messages disappearing that they did not file. Activity log shows no action for those messages.

**Phase relevance:** Batch filing implementation. Requires an integration test before the feature ships.

---

## Moderate Pitfalls

### Pitfall 5: Folder List Caching Staleness

**What goes wrong:** The folder taxonomy is fetched once and cached. The user creates a new folder in Mac Mail, then tries to file messages into it via the tree picker. The folder does not appear. The user has to restart the app or manually refresh.

**Prevention:**
1. Expose a "Refresh Folders" button in the tree picker UI.
2. Set a reasonable TTL on the cache (5 minutes) and auto-refresh when the tree picker is opened.
3. Do NOT refresh on every API call -- `LIST` is expensive on accounts with hundreds of folders, and Fastmail rate-limits aggressive clients.

**Phase relevance:** Tree picker UI phase. Design the cache invalidation strategy before building the component.

---

### Pitfall 6: Batch Progress Reporting Lies

**What goes wrong:** The progress bar says "50% complete" but the job is actually stuck on a single large message or a server timeout. Or the progress bar jumps from 10% to 90% because the first 10% were slow (large messages) and the rest were fast (small messages). Or the batch is "complete" but 47 messages silently failed.

**Prevention:**
1. Report progress as `moved / total` count, not percentage-of-time. Users understand "150 of 2000 messages" better than a progress bar.
2. Track and display failures separately: "1,953 moved, 47 failed."
3. Use Server-Sent Events (SSE) for real-time progress updates rather than polling. The existing Fastify server can handle SSE without additional dependencies.
4. Include an estimated time remaining based on the rolling average of the last N moves, not the overall average.

**Phase relevance:** Batch filing progress UI. Can be layered on after the core batch logic works.

---

### Pitfall 7: Tree Picker State Management Complexity

**What goes wrong:** The tree has expand/collapse state, a search filter, a selection state, and possibly a "recently used" section. Developers store all of this in a global state store, causing the entire tree to re-render on every expand/collapse. Or they lose expand state when the folder list refreshes. Or search filtering breaks the tree hierarchy (showing a child without its parent).

**Prevention:**
1. Keep expand/collapse state local to the tree component, not in any global store. It is pure UI state.
2. Use a flat list internally with indentation levels, not a recursive DOM structure. This makes search filtering trivial (filter the flat list, then walk up to include ancestors).
3. Store the selected folder path (the actual value) separately from the tree display state.
4. For this project's scale (~100-500 folders for a 20-year Fastmail account), virtual scrolling is not needed. A simple DOM tree with lazy child rendering (expand on click) is sufficient.

**Phase relevance:** Tree picker implementation. Architectural decision at the start of the tree picker phase.

---

### Pitfall 8: Batch Filing Interruptibility is Harder Than It Looks

**What goes wrong:** The user clicks "Cancel" on a batch job. The current message move is in-flight on the IMAP connection. You cannot abort a MOVE command mid-flight. The cancel button either does nothing (waits for the current operation) or kills the connection (losing the in-flight move, possibly corrupting state).

**Prevention:**
1. "Cancel" means "stop after the current chunk finishes," not "abort immediately." Document this in the UI.
2. Check a cancellation flag between chunks, not between individual messages.
3. Store batch job state (which messages have been moved) persistently so the user can see what was accomplished before cancellation.
4. The cancelled batch should be resumable -- "Continue filing" picks up where it left off.

**Phase relevance:** Batch filing interruptibility feature. Design the cancellation model before implementing progress reporting.

---

### Pitfall 9: Batch Filing Against the Wrong Folder

**What goes wrong:** The user selects "Apply rule to INBOX" but INBOX has 15,000 messages. The batch starts moving messages that match the rule. But the user meant to apply it to only *new* messages, not the entire folder. Or the rule is wrong and the batch moves 500 messages to the wrong folder before the user notices.

**Prevention:**
1. Show a preview/dry-run before executing: "This rule matches 347 of 15,000 messages in INBOX. Proceed?"
2. Start with a small confirmation batch: move the first 10, show them to the user, then proceed with the rest.
3. Implement an undo mechanism: track all UIDs moved in a batch job, and offer "Undo batch" which moves them all back. This is feasible because IMAP MOVE is reversible.
4. CONCERNS.md already flags the lack of a dry-run/preview feature. This is the phase to address it.

**Phase relevance:** Batch filing UX design. The dry-run preview should be implemented before the full batch execution.

---

## Minor Pitfalls

### Pitfall 10: Special-Use Folders in the Tree Picker

**What goes wrong:** The tree picker shows Trash, Sent, Drafts, and Junk as selectable filing destinations. The user files messages into Drafts by accident. Or the system auto-creates a "Review" subfolder inside Trash.

**Prevention:**
1. Mark special-use folders (via IMAP special-use attributes) in the tree picker UI with icons or labels.
2. Warn (do not block) when the user selects a special-use folder as a filing destination.
3. The codebase already has `getSpecialUseFolder()` with caching -- reuse this data to annotate the tree.

**Phase relevance:** Tree picker UI.

---

### Pitfall 11: Empty Folder Nodes in Tree Display

**What goes wrong:** IMAP servers can have "non-selectable" folders that exist only as hierarchy containers (they have the `\Noselect` flag). The tree picker shows them as selectable destinations, but moves to these folders fail.

**Prevention:**
1. Check the `\Noselect` (or `\NonExistent`) flag from `list()` results. Display these nodes as non-selectable hierarchy containers (greyed out, no click handler).
2. ImapFlow's `list()` returns flags per mailbox -- use them.

**Phase relevance:** Tree picker UI.

---

### Pitfall 12: Rate Limiting on Aggressive Folder Operations

**What goes wrong:** Batch filing 2,000 messages fires 2,000 individual MOVE commands in rapid succession. Fastmail rate-limits the connection or throttles responses, causing timeouts that cascade into reconnection loops.

**Prevention:**
1. Use UID MOVE with UID ranges where possible (e.g., `UID MOVE 100,105,200:250 "Target"`). ImapFlow's `messageMove` accepts arrays.
2. Batch UIDs into a single MOVE command when they share the same destination folder. Group by destination first, then issue one MOVE per destination with all UIDs in a single range.
3. Add a configurable delay between chunks (default 100ms) to avoid hammering the server.

**Phase relevance:** Batch filing implementation.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Folder taxonomy discovery | Encoding/delimiter confusion (Pitfall 3) | Use ImapFlow's `list()` paths verbatim; decode only for display |
| Folder taxonomy discovery | Stale cache (Pitfall 5) | TTL-based cache with manual refresh button |
| Tree picker UI | State management bloat (Pitfall 7) | Local component state, flat list with indentation |
| Tree picker UI | Non-selectable folders (Pitfall 11) | Check `\Noselect` flag, grey out containers |
| Tree picker UI | Special-use folder confusion (Pitfall 10) | Annotate with icons using existing `getSpecialUseFolder()` |
| Batch filing core | UID invalidation (Pitfall 1) | Check UIDVALIDITY, non-fatal per-message errors |
| Batch filing core | Connection contention (Pitfall 2) | Chunked processing with lock release between chunks |
| Batch filing core | EXPUNGE side effects (Pitfall 4) | Verify UID MOVE usage, integration test |
| Batch filing core | Rate limiting (Pitfall 12) | Group UIDs per destination, single MOVE command per group |
| Batch filing UX | Wrong-folder disasters (Pitfall 9) | Dry-run preview, undo mechanism |
| Batch filing UX | Misleading progress (Pitfall 6) | Count-based reporting, separate failure tracking |
| Batch filing UX | Cancel semantics (Pitfall 8) | "Stop after current chunk" model, resumable jobs |

## Existing Codebase Risks for This Milestone

These are not new pitfalls but existing concerns (from CONCERNS.md) that this milestone will amplify:

| Existing Concern | Why It Gets Worse | Action |
|-----------------|-------------------|--------|
| Single IMAP connection (no pooling) | Batch filing holds the lock for extended periods | Chunked processing or second connection |
| Race condition on rule updates during processing | Batch filing reads rules at start; config reload mid-batch changes behavior | Snapshot rules at batch start |
| XSS in modal forms | Tree picker adds more dynamic content (folder names from IMAP) | Use `h()` helper exclusively; sanitize all IMAP-sourced strings |
| Activity log not indexed | Batch filing generates hundreds/thousands of log entries at once | Add indexes before this milestone |
| Frontend DOM inefficiency | Tree picker with 500 folders needs efficient rendering | Use flat list, not recursive innerHTML |

## Sources

- [RFC 3501 - IMAP4rev1](https://www.rfc-editor.org/rfc/rfc3501) - UID, UIDVALIDITY, sequence numbers, Modified UTF-7
- [RFC 6851 - IMAP MOVE Extension](https://datatracker.ietf.org/doc/html/rfc6851.html) - MOVE atomicity, EXPUNGE side effects
- [RFC 9586 - IMAP UID-only Extension](https://datatracker.ietf.org/doc/rfc9586/) - UID MOVE safety
- [Fastmail: What's in a name - mailbox names via IMAP](https://www.fastmail.com/blog/whats-in-a-name-mailbox-names-via-imap/) - Fastmail-specific encoding, caret substitution, delimiter history
- [ImapFlow Mailbox Listing - DeepWiki](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing) - list() vs listTree(), encoding/decoding, special-use detection
- [Mozilla Bug 538375](https://bugzilla.mozilla.org/show_bug.cgi?id=538375) - Batch move timeout failures
- [Mozilla Bug 610131](https://bugzilla.mozilla.org/show_bug.cgi?id=610131) - Batch move duplicate/hang issues
- [Mozilla Bug 332309](https://bugzilla.mozilla.org/show_bug.cgi?id=332309) - IMAP connection timeout during large operations

---

*Pitfalls audit: 2026-04-06*
