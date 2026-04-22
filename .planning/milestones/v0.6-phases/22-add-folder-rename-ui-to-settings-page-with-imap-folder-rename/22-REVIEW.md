---
phase: 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/folders/cache.ts
  - src/imap/client.ts
  - src/web/frontend/api.ts
  - src/web/frontend/app.ts
  - src/web/frontend/styles.css
  - src/web/routes/folders.ts
  - test/unit/imap/client-rename.test.ts
  - test/unit/web/folders-rename.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-04-20
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This phase adds a folder rename feature: a new `POST /api/folders/rename` route, a `FolderCache.renameFolder` method, `ImapClient.renameFolder`, and a Folder Management card in the Settings UI. The overall implementation is solid — input validation is thorough server-side, INBOX and system folder protections exist on both client and server, and the cache is refreshed after rename (success or failure). Tests are well-structured and cover the main paths.

Three warnings were found: a delimiter-detection bug in the frontend that can incorrectly parse folder names containing `.`, an overly broad case-insensitive comparison in `FolderCache.searchTree` that could produce false positives, and a stale-cache window for collision detection. Two info items cover a hardcoded prefix in the client and the `..` check that adds no actual traversal protection.

## Warnings

### WR-01: Frontend Delimiter Detection Can Misidentify Leaf Names

**File:** `src/web/frontend/app.ts:1676-1683`
**Issue:** The `handleFolderSelection` function detects the path delimiter by scanning for `/` or `.` in the full folder path. A legitimate top-level folder named `my.archive` would be matched as having `.` as its delimiter, causing `leafName` to be computed as `archive` instead of `my.archive`. The user would see a pre-filled input of `archive`, and the rename would silently target the wrong name/path.

The correct delimiter is already available from the folder tree data returned by the server (`FolderNode.delimiter`). The folder picker's `onSelect` callback only receives the path string, not the node, so the delimiter needs to be threaded through.

**Fix:** Extend the `onSelect` callback signature to pass the selected `FolderNode` (or at minimum its delimiter), then use `node.delimiter` directly:
```typescript
// In renderFolderPicker options, pass the full node
onSelect: (folderPath: string, node: FolderNode) => {
  selectedPath = folderPath;
  selectedDelimiter = node.delimiter ?? '/';
  handleFolderSelection(folderPath, node.delimiter ?? '/');
},
```
As a short-term alternative, look up the delimiter from the cached tree rather than guessing from string content.

---

### WR-02: FolderCache.searchTree Case-Insensitive Logic Is Overly Broad

**File:** `src/folders/cache.ts:69-71`
**Issue:** The condition `if (target.toLowerCase() === 'inbox' || node.path.toLowerCase() === 'inbox')` applies case-insensitive comparison whenever *either* the target OR the node is named "inbox". This means: searching for `"inbox"` against any folder node, OR searching for any arbitrary path against a node literally named `"inbox"`, will use case-insensitive matching. In practice this means `hasFolder("inbox")` would match a node whose path is `"INBOX"` (correct), but also `hasFolder("SomePath")` against a node named `"inbox"` would do a case-insensitive compare — potentially matching `"SOMEPATH"` against `"inbox"` (which would return false anyway, but the logic is inconsistent and fragile).

The intent is clearly to make INBOX lookups case-insensitive. The condition should be:
```typescript
if (target.toLowerCase() === 'inbox' && node.path.toLowerCase() === 'inbox') {
  return true;
}
if (node.path === target) return true;
```

**Fix:**
```typescript
private searchTree(nodes: FolderNode[], target: string): boolean {
  for (const node of nodes) {
    // Case-insensitive only for INBOX
    if (target.toLowerCase() === 'inbox' && node.path.toLowerCase() === 'inbox') {
      return true;
    }
    if (node.path === target) return true;
    if (this.searchTree(node.children, target)) return true;
  }
  return false;
}
```

---

### WR-03: Collision Check Uses Potentially Stale Cache

**File:** `src/web/routes/folders.ts:49,75`
**Issue:** The route fetches the folder tree with `cache.getTree()` (no force-refresh, line 49), then checks for collisions with `cache.hasFolder(fullNewPath)` (line 75). If the TTL has not expired, this uses the cached tree from a previous fetch, which may not reflect recent IMAP changes (folders added by another client). A concurrent rename or folder creation outside this app could result in the collision check passing while the IMAP rename itself fails.

This is not catastrophic — the IMAP server will reject the operation and the error path returns 500 — but the 409 collision response would be missed and the user gets a less informative error.

**Fix:** Force a refresh before collision detection, or document this as an accepted limitation with a comment. If a fresh fetch is too expensive on every rename, at minimum detect IMAP-side "already exists" errors in the catch block and map them to 409:
```typescript
} catch (err) {
  try { await cache.getTree(true); } catch { /* best effort */ }
  const message = err instanceof Error ? err.message : String(err));
  // Map IMAP "already exists" errors to 409 for better UX
  if (message.toLowerCase().includes('already exist')) {
    return reply.status(409).send({ error: `A folder named "${newPath}" already exists in this location` });
  }
  return reply.status(500).send({ error: `Rename failed: ${message}` });
}
```

---

## Info

### IN-01: Frontend Action Folder Prefix Is Hardcoded

**File:** `src/web/frontend/app.ts:1661-1662`
**Issue:** `handleFolderSelection` hardcodes `const actionPrefix = 'Actions'` rather than fetching the configured prefix from the backend. If the server's `configRepo.getActionFolderConfig().prefix` is set to a different value, the client-side guard will fail to block the rename UI for the custom system folder, and the user will see a 403 error from the server instead of the friendly "System folders cannot be renamed" message. The server-side block (in `folders.ts:64`) is correct; this is a UI inconsistency only.

**Fix:** Expose the action folder prefix via an API endpoint (or include it in the status/config response) and use that value in `handleFolderSelection`.

---

### IN-02: `newPath.includes('..')` Check Provides No Traversal Protection

**File:** `src/web/routes/folders.ts:54`
**Issue:** The `..` check on `newPath` is redundant for path traversal purposes. The server reconstructs the full path by replacing only the last segment of `oldPath.split(delimiter)` — so even if `newPath` contained `..`, the resulting `fullNewPath` would be something like `Parent/..`, which is a folder name literally containing `..` rather than a traversal. The check does prevent a folder from being named `..` (which is arguably desirable), but the comment framing it as traversal prevention is misleading.

**Fix:** Keep the check if preventing a folder literally named `..` is desired, but update the error message and comment to reflect the actual intent:
```typescript
// Disallow ".." as a literal folder name component
if (newPath === '..' || newPath.includes('..')) {
  return reply.status(400).send({ error: 'New name cannot contain ".."' });
}
```

---

_Reviewed: 2026-04-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
