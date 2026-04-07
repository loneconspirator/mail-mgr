# Feature Landscape

**Domain:** IMAP folder taxonomy, tree picker, and batch filing for email management
**Researched:** 2026-04-06

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| IMAP folder list discovery | Cannot pick a folder if you do not know what folders exist. Every mail client does this on connect. | Low | ImapFlow provides `list()` (flat) and `listTree()` (hierarchical). Already using `list()` for special-use resolution. |
| Hierarchical folder display | Fastmail users have deeply nested folders (20 years of accumulation). A flat dropdown is unusable past ~30 folders. | Medium | Must handle Fastmail's `.` separator (port 993 INBOX-rooted namespace) or `/` separator (altnamespace). ImapFlow normalizes this. |
| Folder picker in rule editor | Currently a raw text input for destination folder. Users will mistype folder names, creating silent failures when IMAP MOVE targets a non-existent path. | Medium | Replace the text `<input>` in the rule modal with a tree picker component. Must still allow typed input as fallback for folders not yet discovered. |
| Batch move with progress indicator | Applying a rule retroactively to thousands of messages without feedback is unacceptable. User has no idea if it is working, stuck, or failed. | Medium | Server-Sent Events (SSE) or polling endpoint. Show messages processed / total, current message subject, elapsed time. |
| Batch operation cancellation | If a user starts a batch of 5,000 messages and realizes the rule is wrong at message 200, they need to stop it. Forcing a full run or a process kill is hostile. | Medium | AbortController pattern on the backend. Frontend sends cancel request, backend stops after current message completes. Already-moved messages stay moved (no rollback -- IMAP moves are not transactional). |
| Default archive destination per stream | Sweep currently archives to a single `defaultArchiveFolder`. User needs Inbox-sourced and Review-sourced messages to potentially go to different default folders. | Low | Config schema change: `defaultArchiveFolder` becomes per-context or gains a `reviewDefaultArchive` sibling. |
| Sweep settings editable in UI | Settings page shows sweep config as read-only. User must edit config file to change sweep intervals or age thresholds. This is already listed as an active requirement. | Low | Wire up form inputs to PUT endpoint. Validation already exists in Zod schema. |
| Folder path validation on rule save | If user types or selects a folder that does not exist on the server, the rule will silently fail at execution time. | Low | Validate against cached folder list on save. Warn (not block) -- folder may be created later. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dry-run for batch filing | Before moving 3,000 messages, show what WOULD happen: "2,847 messages match, would move to Archive/Newsletters". Prevents costly mistakes with irreversible IMAP moves. | Medium | Run the rule evaluator against fetched envelopes without executing moves. Return match count and sample subjects. |
| Batch filing summary report | After a batch completes, show: moved X, skipped Y, errored Z, with a breakdown by destination folder. Logged to activity table for audit trail. | Low | Already have activity logging infrastructure. Aggregate counts and return summary object. |
| Folder usage statistics | Show message counts per folder (from IMAP STATUS command). Helps user identify where mail accumulates and which folders need rules. | Low | ImapFlow supports STATUS. Cache results. Display alongside folder tree. |
| Recently-used folders | In the folder picker, surface the 5-10 most recently used destination folders at the top. Saves drilling through a deep tree for common targets. | Low | Track in SQLite from activity log. Simple query on rule actions + activity entries. |
| Folder search/filter in picker | For users with hundreds of folders, typing "news" should filter the tree to show only matching paths. Faster than expanding every node. | Low | Client-side filter on the flat folder list, re-render tree showing only matching branches. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Folder creation from the app | PROJECT.md explicitly scopes this out. Folder structure is owned by the mail client. Creating folders from this app creates a management split-brain. | Show "folder not found" warning on rule save. User creates folders in Mac Mail, then refreshes the folder list. |
| Folder deletion or renaming | Same reasoning as creation. Destructive folder operations from a background daemon are dangerous. | Not even a consideration. |
| Folder retirement automation (zz_old/) | PROJECT.md scopes this out. The user handles this manually. Automating it risks moving active folders. | Could show a "suggestion" in the UI if a folder has had zero new messages in 6 months, but take no action. |
| Drag-and-drop folder reorganization | This is a mail client feature, not a rule engine feature. Building it duplicates Mac Mail's functionality. | Focus on folder selection for rule destinations, not folder management. |
| Real-time folder sync (IMAP NOTIFY) | IMAP NOTIFY (RFC 5465) would push folder changes. Overkill for a single-user tool where folder structure changes rarely. | Refresh folder list on demand (manual refresh button or on rule editor open). Cache for the session. |
| Batch filing rollback/undo | IMAP MOVE is a copy+delete. Undoing means moving messages back, but flags and state may have changed. False promise of safety. | Dry-run before execution. Clear warnings that batch moves are permanent. |
| Concurrent batch operations | Running two batch jobs simultaneously against the same IMAP connection creates lock contention and unpredictable behavior. | Queue batch requests. Show "batch in progress" if one is already running. One at a time. |

## Feature Dependencies

```
Folder List Discovery --> Tree Picker UI (picker needs folder data)
Folder List Discovery --> Folder Path Validation (validation needs folder data)
Folder List Discovery --> Folder Usage Statistics (stats query same endpoint)
Tree Picker UI --> Rule Editor Integration (picker embedded in modal)
Batch Filing Engine --> Progress Reporting (engine emits progress events)
Batch Filing Engine --> Cancellation Support (engine checks abort signal)
Batch Filing Engine --> Dry-Run Mode (engine runs evaluator without executing)
Batch Filing Engine --> Summary Report (engine aggregates results)
Sweep Settings Editable --> (no dependency, standalone fix)
Default Archive Per-Stream --> Sweep Settings Editable (edit UI should include the new field)
```

## MVP Recommendation

Build in this order:

1. **Folder list discovery API** -- foundation for everything else. GET /api/folders returns the IMAP folder tree. Cache server-side with a manual refresh endpoint.
2. **Tree picker component** -- replace the raw text input in the rule editor modal. Collapsible tree with click-to-select. No external library needed; 150 lines of vanilla JS with CSS for expand/collapse.
3. **Folder path validation** -- warn on rule save if the destination folder is not in the cached folder list.
4. **Sweep settings editable** -- low-hanging fruit, already display-only, wire up the form.
5. **Batch filing engine** -- the big one. Apply a rule to all messages in a source folder. Process in chunks (50 messages at a time to avoid IMAP timeouts). Emit progress via SSE.
6. **Batch cancellation** -- AbortController on the server, cancel button in the UI.
7. **Dry-run mode** -- run evaluation without moves, return match summary.
8. **Default archive per-stream** -- config schema extension.

**Defer:**
- Folder usage statistics: nice to have, not blocking any workflow
- Recently-used folders: optimize after the picker is in use and the user confirms it is annoying to navigate
- Folder search in picker: same reasoning, optimize after the basic tree is proven

## Fastmail-Specific Considerations

Fastmail uses Cyrus IMAP. On the standard port (993), folders are namespaced under `INBOX.` with `.` as the hierarchy separator. On port 992 (altnamespace), folders sit alongside INBOX with `/` as separator. ImapFlow normalizes this, but the tree picker must handle both representations gracefully. The app should use whatever ImapFlow returns from `listTree()` and not assume a specific separator.

Special-use folders (Archive, Drafts, Sent, Trash, Junk) are returned with RFC 6154 attributes. The tree picker should visually distinguish these (e.g., bold or icon) since they are system folders the user should not accidentally target with bulk moves.

## Sources

- [Fastmail blog: What's in a name -- mailbox names via IMAP](https://www.fastmail.com/blog/whats-in-a-name-mailbox-names-via-imap/)
- [ImapFlow documentation](https://imapflow.com/)
- [ImapFlow mailbox listing (DeepWiki)](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing)
- [RFC 2342: IMAP4 Namespace](https://www.rfc-editor.org/rfc/rfc2342.html)
- [Mailstrom batch email management](https://www.guideflow.com/blog/email-management-software-tools)
