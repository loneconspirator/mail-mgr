# Phase 22: Add folder rename UI to settings page with IMAP folder rename - Research

**Researched:** 2026-04-20
**Domain:** IMAP folder operations + frontend settings UI
**Confidence:** HIGH

## Summary

This phase adds a folder rename capability to the settings page. The implementation touches three layers: (1) adding `mailboxRename` to the `ImapFlowLike` interface and a public `renameFolder` method to `ImapClient`, (2) a new API route `POST /api/folders/rename` that invokes the rename and invalidates the folder cache, and (3) a new settings card in `renderSettings()` that reuses the existing `folder-picker.ts` tree picker for selection and provides inline name editing.

The imapflow library already exposes `mailboxRename(path, newPath)` which returns `{ path, newPath }`. The existing `createMailbox` pattern in `ImapClient` provides the exact template: acquire a lock on INBOX, call the flow method, done. The folder cache already has `getTree(true)` for force-refresh. The frontend `folder-picker.ts` handles tree rendering with expand/collapse and selection callbacks.

**Primary recommendation:** Follow the `createMailbox` pattern exactly for `renameFolder`, add a thin POST route, and build a new settings card that embeds the folder picker with an editable name field below it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Reuse the existing tree picker component (`src/web/frontend/folder-picker.ts`) for folder selection
- **D-02:** Click a folder in the tree picker, an inline editable name field appears below with Save/Cancel buttons
- **D-03:** Only the leaf name is editable (not the full path)
- **D-04:** All folders are renamable EXCEPT: INBOX and the Actions/ folder hierarchy
- **D-05:** Special-use folders (Trash, Sent, Drafts, etc.) show a warning before rename but are not blocked
- **D-06:** Rename failures show a toast notification with the error message
- **D-07:** Folder tree refreshes/invalidates cache after any rename attempt
- **D-08:** Name collision caught and shown as user-friendly error before attempting IMAP rename if detectable from cached tree

### Claude's Discretion
- Loading state during rename operation (spinner, disabled button, etc.)
- Exact placement of the rename card within the settings page layout
- Whether to add a "Folders" section header or integrate into existing settings flow

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | (installed) | IMAP operations including `mailboxRename` | Already used throughout project [VERIFIED: node_modules] |
| fastify | (installed) | HTTP route for rename endpoint | Already used for all API routes [VERIFIED: codebase] |
| vitest | ^4.0.18 | Unit tests | Already configured [VERIFIED: package.json] |

### Supporting
No new dependencies required. Everything needed is already in the project.

## Architecture Patterns

### Recommended Implementation Structure

```
src/imap/client.ts          # Add mailboxRename to ImapFlowLike, renameFolder to ImapClient
src/web/routes/folders.ts   # Add POST /api/folders/rename route
src/web/frontend/api.ts     # Add folders.rename() API method
src/web/frontend/app.ts     # Add folder rename card to renderSettings()
test/unit/imap/client.test.ts    # Test renameFolder
test/unit/web/folders.test.ts    # Test rename route
test/unit/web/folder-picker.test.ts  # Test UI behavior (if applicable)
```

### Pattern 1: ImapClient Method (follows `createMailbox` exactly)
**What:** Add `mailboxRename` to `ImapFlowLike` interface, add `renameFolder` to `ImapClient` class
**When to use:** Any new IMAP operation
**Example:**
```typescript
// In ImapFlowLike interface:
mailboxRename(path: string | string[], newPath: string | string[]): Promise<unknown>;

// In ImapClient class:
async renameFolder(oldPath: string, newPath: string): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxRename(oldPath, newPath);
  });
}
```
[VERIFIED: follows existing `createMailbox` pattern at line 180 of client.ts]

### Pattern 2: API Route (follows existing folder route pattern)
**What:** POST route that takes `{ oldPath, newPath }`, calls ImapClient, invalidates cache
**Example:**
```typescript
app.post('/api/folders/rename', async (request, reply) => {
  const { oldPath, newPath } = request.body as { oldPath: string; newPath: string };
  // Validation: block INBOX and Actions/ prefix
  // Collision check against cached tree
  // Call renameFolder
  // Invalidate cache
  const cache = deps.getFolderCache();
  // ... need access to imapClient
});
```
[VERIFIED: route registration pattern from folders.ts]

### Pattern 3: Settings Card (follows existing card pattern)
**What:** New `settings-card` div with folder picker and inline edit field
**Example:**
```typescript
const renameCard = h('div', { className: 'settings-card' });
renameCard.innerHTML = `<h2>Rename Folder</h2>`;
// Embed folder picker
// Show editable name field on selection
// Save/Cancel buttons
app.append(renameCard);
```
[VERIFIED: settings page pattern at line 793+ of app.ts]

### Anti-Patterns to Avoid
- **Don't create a modal for rename:** Decision D-02 specifies inline editing below the tree picker
- **Don't allow full path editing:** D-03 says only leaf name is editable; construct the full new path by replacing the last segment
- **Don't skip cache invalidation on failure:** D-07 says always refresh after any attempt

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder tree display | Custom tree renderer | Existing `folder-picker.ts` | Already handles expand/collapse, selection, caching |
| IMAP rename protocol | Raw IMAP commands | `imapflow.mailboxRename()` | Handles encoding, path separators, response parsing |
| Toast notifications | Custom notification system | Existing `toast()` function | Already styled and positioned |

## Common Pitfalls

### Pitfall 1: IMAP Path Separator
**What goes wrong:** Constructing new path with wrong separator (e.g., `/` vs `.`)
**Why it happens:** IMAP servers use different path separators (usually `/` or `.`)
**How to avoid:** The `FolderNode` type includes `delimiter` field. Use the delimiter from the selected node's parent to reconstruct the full path. OR simply replace only the last segment after the last delimiter occurrence.
**Warning signs:** Rename succeeds but creates nested folder instead of renaming

### Pitfall 2: Renaming Folder with Children
**What goes wrong:** IMAP RENAME on a parent folder may or may not move children depending on server
**Why it happens:** RFC 3501 says RENAME of a folder with inferiors SHOULD rename the inferiors too, but behavior varies
**How to avoid:** imapflow handles this correctly per the protocol. Just be aware in the UI — after rename, the tree will show the new name and children under it after cache refresh.
**Warning signs:** Children appearing as orphans after rename

### Pitfall 3: FolderCache Access to ImapClient for Route
**What goes wrong:** The rename route needs ImapClient access but `ServerDeps` only exposes `getFolderCache()`
**Why it happens:** Current architecture only needed read access to folders from routes
**How to avoid:** Either (a) add a `renameFolder` method to `FolderCache` that delegates to its internal `imapClient`, or (b) expose `imapClient` through FolderCache, or (c) add `getImapClient` to `ServerDeps`. Option (a) is cleanest — keeps the cache as the single point of folder operations.
**Warning signs:** Circular dependencies or leaky abstractions

### Pitfall 4: Special-Use Folder Detection
**What goes wrong:** Not detecting special-use folders for warning display (D-05)
**Why it happens:** The `FolderNode` type may not carry special-use flags
**How to avoid:** Check if `FolderNode` has a `specialUse` or `flags` field. If not, the `listMailboxes()` method returns flags — may need to enrich the tree data or check separately.
**Warning signs:** No warning shown when renaming Sent/Trash/Drafts

### Pitfall 5: Frontend Cache Staleness After Rename
**What goes wrong:** The frontend `folder-picker.ts` has its own 60-second cache (`CACHE_TTL = 60_000`). After rename, the picker shows old names.
**How to avoid:** Call `clearFolderCache()` (already exported from folder-picker.ts) before re-rendering the picker after a rename.
**Warning signs:** Old folder name still visible after successful rename until page refresh

## Code Examples

### ImapFlowLike Interface Addition
```typescript
// Source: node_modules/imapflow/lib/imap-flow.d.ts line 674
// Add to ImapFlowLike in src/imap/client.ts:
mailboxRename(path: string | string[], newPath: string | string[]): Promise<unknown>;
```

### ImapClient.renameFolder (following createMailbox at line 180)
```typescript
async renameFolder(oldPath: string, newPath: string): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxRename(oldPath, newPath);
  });
}
```

### FolderCache.renameFolder (encapsulates operation + invalidation)
```typescript
async renameFolder(oldPath: string, newPath: string): Promise<void> {
  await this.deps.imapClient.renameFolder(oldPath, newPath);
  await this.refresh();
}
```

### Frontend API Addition
```typescript
// In api.ts, folders object:
folders: {
  list: () => request<FolderTreeResponse>('/api/folders'),
  rename: (oldPath: string, newPath: string) => request<void>('/api/folders/rename', {
    method: 'POST',
    body: JSON.stringify({ oldPath, newPath }),
  }),
},
```

### Leaf Name Extraction and Path Reconstruction
```typescript
// Given a folder path and delimiter, extract leaf and rebuild with new name:
function getLeafName(path: string, delimiter: string): string {
  const parts = path.split(delimiter);
  return parts[parts.length - 1];
}

function buildNewPath(oldPath: string, newLeafName: string, delimiter: string): string {
  const parts = oldPath.split(delimiter);
  parts[parts.length - 1] = newLeafName;
  return parts.join(delimiter);
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts (assumed default) |
| Quick run command | `npm test -- --testPathPattern folders\|client` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | Folder picker reuse for selection | unit | `npx vitest run test/unit/web/folder-picker.test.ts` | Yes |
| D-04 | INBOX and Actions/ blocked from rename | unit | `npx vitest run test/unit/web/folders.test.ts` | Yes (needs new tests) |
| D-07 | Cache invalidation after rename | unit | `npx vitest run test/unit/folders/cache.test.ts` | Yes (needs new tests) |
| D-08 | Collision detection | unit | `npx vitest run test/unit/web/folders.test.ts` | Yes (needs new tests) |
| IMAP | renameFolder delegates to flow.mailboxRename | unit | `npx vitest run test/unit/imap/client.test.ts` | Yes (needs new tests) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/web/folders.test.ts test/unit/imap/client.test.ts test/unit/folders/cache.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. New test cases need to be added to existing files.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (app is single-user local) |
| V3 Session Management | no | N/A |
| V4 Access Control | no | Single-user app |
| V5 Input Validation | yes | Validate folder name: no path separators, no control chars, reasonable length |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via folder name | Tampering | Reject names containing delimiter characters, `..`, or control chars |
| Denial of service via very long names | Tampering | Cap folder name length (e.g., 255 chars) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `FolderNode` type includes `delimiter` field | Pitfalls | Need alternate way to determine path separator - could use `/` as default |
| A2 | imapflow `mailboxRename` renames children of parent folders | Pitfalls | May need to warn user about child folders |
| A3 | No lock conflicts when renaming via INBOX lock | Code Examples | May need different lock strategy |

## Open Questions

1. **Does FolderNode carry special-use flags?**
   - What we know: `FolderNode` is defined in shared/types.ts, `listMailboxes()` returns flags separately
   - What's unclear: Whether the tree transformation preserves special-use info
   - Recommendation: Check shared/types.ts FolderNode definition; if no flags, add them or use `listMailboxes()` result to identify special-use folders

2. **Should FolderCache own the rename operation?**
   - What we know: FolderCache already holds the ImapClient reference internally
   - What's unclear: Whether adding mutation methods to a "cache" class is appropriate
   - Recommendation: Add `renameFolder(old, new)` to FolderCache -- it already does mutation-adjacent work (refresh). Alternative: expose `imapClient` from FolderCache or add to ServerDeps.

## Sources

### Primary (HIGH confidence)
- imapflow node_modules - verified `mailboxRename(path, newPath)` signature and return type
- src/imap/client.ts - verified `ImapFlowLike` interface, `createMailbox` pattern, `withMailboxLock`
- src/folders/cache.ts - verified cache structure, `refresh()`, `hasFolder()`
- src/web/frontend/folder-picker.ts - verified tree picker API, `clearFolderCache()` export
- src/web/frontend/app.ts - verified settings card pattern, `toast()` function
- src/web/routes/folders.ts - verified route registration pattern

### Secondary (MEDIUM confidence)
- RFC 3501 RENAME semantics for child folders [ASSUMED from training data]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all verified in codebase, no new dependencies
- Architecture: HIGH - follows established patterns exactly
- Pitfalls: HIGH - identified from real code inspection

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable codebase, no external dependency changes)
