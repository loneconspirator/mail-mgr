# Phase 22: Add folder rename UI to settings page with IMAP folder rename - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 22-add-folder-rename-ui-to-settings-page-with-imap-folder-rename
**Areas discussed:** Folder selection UX, Rename interaction, Scope of rename, Error and edge case handling
**Mode:** --auto (all decisions auto-selected as recommended defaults)

---

## Folder Selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing tree picker | Consistent with rest of app, already built | ✓ |
| Flat dropdown list | Simpler but loses hierarchy context | |
| Searchable text input | Fast for power users but unfamiliar pattern in this app | |

**User's choice:** Reuse existing tree picker component (auto-selected)
**Notes:** Tree picker already exists and is used in rule editor and sweep settings. Consistency wins.

---

## Rename Interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Inline editable field below tree | Click folder, name field appears with Save/Cancel | ✓ |
| Modal dialog | More chrome, interrupts flow | |
| Double-click to edit in tree | Discoverability issues | |

**User's choice:** Inline editable name field below tree with Save/Cancel (auto-selected)
**Notes:** Direct manipulation, minimal UI. Only leaf name editable (not full path).

---

## Scope of Rename

| Option | Description | Selected |
|--------|-------------|----------|
| All except INBOX and Actions/ | INBOX is IMAP-immutable, Actions/ is system-managed | ✓ |
| All except INBOX only | Allows renaming Action Folders (risky) | |
| Whitelist approach | Only user-created folders renamable (too restrictive) | |

**User's choice:** All folders except INBOX and Actions/ hierarchy (auto-selected)
**Notes:** Special-use folders (Trash, Sent, etc.) show warning but are not blocked.

---

## Error and Edge Case Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Toast + cache refresh | Consistent with existing error patterns | ✓ |
| Inline error below field | More specific but new pattern | |
| Modal error dialog | Too heavy for this context | |

**User's choice:** Toast notification with error, folder tree cache refresh (auto-selected)
**Notes:** Pre-check name collision from cached tree when possible.

---

## Claude's Discretion

- Loading state during rename operation
- Exact placement of rename card within settings page
- Whether to add "Folders" section header

## Deferred Ideas

None.
