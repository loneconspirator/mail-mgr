---
phase: 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename
verified: 2026-04-20T19:20:00Z
status: human_needed
score: 12/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Navigate to Settings page, scroll to 'Folder Management' card. Select a regular folder, type a new name, click 'Rename Folder'."
    expected: "Toast confirms rename success; folder tree refreshes showing new name."
    why_human: "End-to-end IMAP rename operation requires a live IMAP connection — cannot verify programmatically."
  - test: "Select INBOX in the folder picker."
    expected: "'INBOX cannot be renamed' message appears; no rename form shown."
    why_human: "Visual DOM state requires a running browser."
  - test: "Select an Actions/ folder in the picker."
    expected: "'System folders cannot be renamed' message appears."
    why_human: "Visual DOM state requires a running browser."
  - test: "Select Sent or Trash folder."
    expected: "Yellow warning banner 'This is a special-use folder. Renaming may affect your mail client.' appears above rename field."
    why_human: "Visual DOM state requires a running browser."
  - test: "Type a name that already exists in the same parent and click 'Rename Folder'."
    expected: "Inline field error 'already exists' appears; no toast."
    why_human: "Requires live backend collision detection in browser context."
  - test: "Click 'Keep Current Name'."
    expected: "Rename section hides; folder picker shows no active selection."
    why_human: "Visual DOM state requires a running browser."
---

# Phase 22: Add Folder Rename UI to Settings Page Verification Report

**Phase Goal:** Users can rename IMAP folders from the settings page with full validation and feedback
**Verified:** 2026-04-20T19:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ImapClient exposes a renameFolder method that delegates to imapflow mailboxRename | VERIFIED | `src/imap/client.ts:187-190` — `renameFolder` uses `withMailboxLock('INBOX')` and calls `flow.mailboxRename(oldPath, newPath)`; `mailboxRename` in `ImapFlowLike` interface at line 27 |
| 2 | FolderCache exposes a renameFolder method that calls ImapClient and refreshes cache | VERIFIED | `src/folders/cache.ts:42-45` — calls `this.deps.imapClient.renameFolder(oldPath, newPath)` then `this.refresh()` |
| 3 | POST /api/folders/rename validates input, blocks INBOX and Actions/ prefix, detects collisions, calls FolderCache.renameFolder | VERIFIED | `src/web/routes/folders.ts:28-89` — 400 for bad input, 403 for INBOX/Actions, 409 for collision, success path calls `cache.renameFolder` |
| 4 | Frontend api.ts exposes folders.rename() that POSTs to /api/folders/rename | VERIFIED | `src/web/frontend/api.ts:77-81` — `rename: (oldPath, newPath) => request<...>('/api/folders/rename', { method: 'POST', ... })` |
| 5 | User can see a 'Folder Management' settings card on the settings page | VERIFIED | `src/web/frontend/app.ts:1627-1628` — `h('h2', {}, 'Folder Management')` in card; `renderFolderRenameCard(app)` called from `renderSettings()` at line 1006 |
| 6 | User can select a folder from the tree picker in the rename card | VERIFIED | `src/web/frontend/app.ts:1646-1653` — `renderFolderPicker` called with `onSelect` callback that triggers `handleFolderSelection` |
| 7 | User sees an inline editable name field with the leaf folder name after selecting a folder | VERIFIED | `src/web/frontend/app.ts:1701-1708` — input pre-filled with `leafName` (last path segment); label "New name"; error div for validation messages |
| 8 | User cannot rename INBOX or Actions/ folders (disabled state with explanation) | VERIFIED | `src/web/frontend/app.ts:1660-1672` — INBOX check (case-insensitive) shows "INBOX cannot be renamed"; Actions prefix check shows "System folders cannot be renamed" |
| 9 | User sees a warning when selecting special-use folders (Sent, Drafts, Trash, etc.) | VERIFIED | `src/web/frontend/app.ts:1688-1698` — `specialUseFolders` array checked; `.rename-warning` div added if matched |
| 10 | User can type a new name and click Rename Folder to execute the rename | VERIFIED | `src/web/frontend/app.ts:1727-1793` — rename button handler validates, builds full new path, calls `api.folders.rename(selectedPath, newPath)` |
| 11 | User sees a collision error inline if a folder with the new name already exists | VERIFIED | `src/web/frontend/app.ts:1775-1777` — `message.includes('already exists')` routes 409 error to `errorDiv`, not toast |
| 12 | User sees a toast on success or failure | VERIFIED | `src/web/frontend/app.ts:1761,1779` — success: `toast('Folder renamed to ...')`, other failures: `toast('Rename failed: ...', true)` |
| 13 | Folder tree refreshes after any rename attempt | VERIFIED | `src/web/frontend/app.ts:1763,1782` — `clearFolderCache()` + `renderFolderPicker` called in both success and catch blocks; backend: `cache.getTree(true)` on error at `src/web/routes/folders.ts:85` |

**Score:** 13/13 truths verified (all automated checks pass; end-to-end behavior needs human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/imap/client.ts` | `mailboxRename` in interface + `renameFolder` on ImapClient | VERIFIED | Lines 27, 187-190 |
| `src/folders/cache.ts` | `renameFolder` method on FolderCache | VERIFIED | Lines 42-45 |
| `src/web/routes/folders.ts` | POST /api/folders/rename with validation | VERIFIED | Lines 28-89 |
| `src/web/frontend/api.ts` | `folders.rename()` API method | VERIFIED | Line 77 |
| `src/web/frontend/app.ts` | Folder Management settings card | VERIFIED | Lines 1626-1801 |
| `src/web/frontend/styles.css` | `.rename-section` and companion CSS classes | VERIFIED | Lines 685-717 |
| `test/unit/imap/client-rename.test.ts` | Unit tests for renameFolder | VERIFIED | 5 tests, all passing |
| `test/unit/web/folders-rename.test.ts` | Unit tests for rename route | VERIFIED | 9 tests, all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/web/routes/folders.ts` | `src/folders/cache.ts` | `deps.getFolderCache().renameFolder()` | WIRED | Line 81: `await cache.renameFolder(oldPath, fullNewPath)` |
| `src/folders/cache.ts` | `src/imap/client.ts` | `this.deps.imapClient.renameFolder()` | WIRED | Line 43: `await this.deps.imapClient.renameFolder(oldPath, newPath)` |
| `src/web/frontend/app.ts` | `src/web/frontend/api.ts` | `api.folders.rename()` | WIRED | Line 1760: `await api.folders.rename(selectedPath, newPath)` |
| `src/web/frontend/app.ts` | `src/web/frontend/folder-picker.ts` | `renderFolderPicker()` and `clearFolderCache()` | WIRED | Import at line 4; used at lines 1646, 1763, 1782 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/web/routes/folders.ts` rename route | `tree` (FolderNode[]) | `cache.getTree()` → `ImapClient.listTree()` | Yes — real IMAP data | FLOWING |
| `src/web/frontend/app.ts` rename card | folder picker selection | `renderFolderPicker` → `GET /api/folders` → IMAP | Yes — live folder tree | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests pass (ImapClient rename) | `npx vitest run test/unit/imap/client-rename.test.ts` | 5/5 tests pass | PASS |
| Unit tests pass (route validation) | `npx vitest run test/unit/web/folders-rename.test.ts` | 9/9 tests pass | PASS |
| TypeScript build succeeds | `npm run build` | Exit 0, "Frontend built to dist/public/" | PASS |
| End-to-end rename with live IMAP | requires running app | N/A | SKIP — needs live IMAP server |

### Requirements Coverage

Phase 22 uses phase-local design decisions (D-01 through D-08) from `22-CONTEXT.md`, not entries in the shared `REQUIREMENTS.md`. These decisions are not in the REQUIREMENTS.md traceability table, which covers only v0.6 milestone requirements (FOLD/PROC/RULE/MON/LOG/CONF/EXT). This is correct — Phase 22 is a self-contained feature outside the v0.6 action-folders milestone. No orphaned entries in REQUIREMENTS.md for Phase 22.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| D-01 | 22-02-PLAN | Reuse tree picker for folder selection | SATISFIED | `renderFolderPicker` used in rename card |
| D-02 | 22-02-PLAN | Click folder → inline editable name field | SATISFIED | `handleFolderSelection` builds inline form on click |
| D-03 | 22-01-PLAN, 22-02-PLAN | Only leaf name editable | SATISFIED | Route splits oldPath on delimiter, replaces last segment; frontend extracts `leafName` |
| D-04 | 22-01-PLAN, 22-02-PLAN | Block INBOX and Actions/ rename | SATISFIED | Both frontend (client-side) and backend (403 responses) enforce this |
| D-05 | 22-02-PLAN | Special-use folders show warning, not blocked | SATISFIED | Warning shown for Sent/Drafts/Trash/Junk/Archive; no block |
| D-06 | 22-02-PLAN | Rename failures show toast | SATISFIED | `toast('Rename failed: ' + message, true)` in catch block |
| D-07 | 22-01-PLAN, 22-02-PLAN | Tree refreshes after any rename attempt | SATISFIED | `clearFolderCache()` + re-render on success/failure; `cache.getTree(true)` on backend error |
| D-08 | 22-01-PLAN, 22-02-PLAN | Collision detected from cache before IMAP attempt | SATISFIED | `cache.hasFolder(fullNewPath)` → 409 before `renameFolder` call |

### Anti-Patterns Found

No blockers or warnings found. The `return null` at `folders.ts:11` is in the `findNode` tree-search helper (correct "not found" return). No TODOs, placeholders, or empty implementations detected in phase 22 files.

### Human Verification Required

End-to-end UI flow requires a running app with a live IMAP connection.

#### 1. Successful Rename

**Test:** Navigate to Settings, find "Folder Management" card, select a regular folder, type a new name, click "Rename Folder."
**Expected:** Toast "Folder renamed to [name]" appears; folder tree picker refreshes showing the new name.
**Why human:** Requires live IMAP connection; frontend DOM state cannot be verified statically.

#### 2. INBOX Block

**Test:** Click INBOX in the folder picker.
**Expected:** "INBOX cannot be renamed" text appears; no rename input field is shown.
**Why human:** Visual DOM state requires a running browser.

#### 3. Actions Folder Block

**Test:** If Actions/ folder exists, click it in the picker.
**Expected:** "System folders cannot be renamed" text appears.
**Why human:** Visual DOM state requires a running browser.

#### 4. Special-Use Warning

**Test:** Select Sent, Trash, or Drafts folder.
**Expected:** Yellow warning banner "This is a special-use folder. Renaming may affect your mail client." appears above the rename input.
**Why human:** Visual DOM state requires a running browser.

#### 5. Collision Error

**Test:** Select a folder, type the name of an existing sibling folder, click "Rename Folder."
**Expected:** Inline error message containing "already exists" appears below the input field; no toast shown.
**Why human:** Requires live backend serving collision detection data.

#### 6. Cancel Button

**Test:** Select a folder (rename section appears), click "Keep Current Name."
**Expected:** Rename section hides; hint text "Select a folder above to rename it" reappears.
**Why human:** Visual DOM state requires a running browser.

### Gaps Summary

No automated-verifiable gaps found. All artifacts exist, are substantive, are wired, and data flows through them. All 14 unit tests pass. Build succeeds.

Six human verification items remain due to UI behavior requiring a running browser with live IMAP. These are normal for frontend features and do not indicate implementation defects — all code paths for these behaviors are present and correct in the source.

---

_Verified: 2026-04-20T19:20:00Z_
_Verifier: Claude (gsd-verifier)_
