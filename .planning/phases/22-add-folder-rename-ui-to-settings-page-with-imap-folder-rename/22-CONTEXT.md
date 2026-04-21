# Phase 22: Add folder rename UI to settings page with IMAP folder rename - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a folder rename capability to the settings page. Users can select a folder from their IMAP folder tree and rename it, with the rename operation executed on the IMAP server. This is the first UI-driven folder mutation operation in the app.

</domain>

<decisions>
## Implementation Decisions

### Folder Selection UX
- **D-01:** Reuse the existing tree picker component (`src/web/frontend/folder-picker.ts`) for folder selection — keeps UI consistent with folder pickers used elsewhere (rule editor, sweep settings)

### Rename Interaction
- **D-02:** Click a folder in the tree picker, an inline editable name field appears below with Save/Cancel buttons — direct manipulation, minimal chrome
- **D-03:** Only the leaf name is editable (not the full path) — the folder stays in its current parent location

### Scope of Rename
- **D-04:** All folders are renamable EXCEPT: INBOX (immutable per IMAP spec) and the Actions/ folder hierarchy (system-managed by the app)
- **D-05:** Special-use folders (Trash, Sent, Drafts, etc.) show a warning before rename but are not blocked — user may have legitimate reasons

### Error Handling
- **D-06:** Rename failures show a toast notification with the error message (consistent with existing settings page patterns)
- **D-07:** Folder tree refreshes/invalidates cache after any rename attempt (success or failure) to show current state
- **D-08:** Name collision (folder already exists at target path) is caught and shown as a user-friendly error before attempting IMAP rename if detectable from cached tree

### Claude's Discretion
- Loading state during rename operation (spinner, disabled button, etc.)
- Exact placement of the rename card within the settings page layout
- Whether to add a "Folders" section header or integrate into existing settings flow

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above.

### Relevant source files
- `src/web/frontend/folder-picker.ts` — Existing tree picker component to reuse/extend
- `src/web/frontend/app.ts` (renderSettings function ~line 780) — Settings page structure
- `src/imap/client.ts` — ImapClient wrapper, needs `mailboxRename` addition to `ImapFlowLike` interface
- `src/web/routes/folders.ts` — Existing folder API route (GET only, needs rename endpoint)
- `src/imap/folder-cache.ts` — Folder cache that needs invalidation after rename

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `folder-picker.ts`: Full tree picker with expand/collapse, recent folders, selection callback — can be reused directly or with minor adaptation for "select folder to rename" use case
- `toast()` function in app.ts: Existing notification system for success/error feedback
- Settings page card pattern: `h('div', { className: 'settings-card' })` with form groups

### Established Patterns
- Settings cards: Each section is a `settings-card` div with h2 heading, form content, and action buttons
- API routes: Fastify route registration in `src/web/routes/` with deps injection
- IMAP operations: All go through `ImapClient` wrapper which manages connection lifecycle
- Folder cache: `getFolderCache()` provides cached folder tree, has `getTree(forceRefresh)` for invalidation

### Integration Points
- `ImapFlowLike` interface needs `mailboxRename(path, newPath)` method added
- `ImapClient` needs a public `renameFolder(oldPath, newPath)` method
- New API route: `POST /api/folders/rename` (or `PATCH /api/folders/:path`)
- Settings page: New card section added to `renderSettings()` function
- Folder cache: Call `getTree(true)` after successful rename to invalidate

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename*
*Context gathered: 2026-04-20*
