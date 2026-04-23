# Phase 32: UI Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 32-ui-cleanup
**Areas discussed:** API removal strategy, CSS cleanup, IMAP rename method retention
**Mode:** Auto (all decisions auto-selected)

---

## API Removal Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Remove entirely | Hard delete the endpoint — no external consumers | :heavy_check_mark: |
| Return deprecation error | Keep route but return 410 Gone or similar | |

**User's choice:** Remove entirely (auto-selected — recommended default)
**Notes:** Single-user app with no API consumers beyond its own frontend. Deprecation response adds complexity for zero benefit.

---

## CSS Cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Remove rename CSS | Delete .rename-section, .rename-disabled-hint, .rename-warning | :heavy_check_mark: |
| Leave CSS in place | Keep styles even though no elements use them | |

**User's choice:** Remove them (auto-selected — recommended default)
**Notes:** Dead CSS should not linger in the codebase.

---

## IMAP Rename Method Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep renameFolder() | Retain the IMAP primitive on folder cache | :heavy_check_mark: |
| Remove renameFolder() | Delete from cache since UI no longer uses it | |

**User's choice:** Keep it (auto-selected — recommended default)
**Notes:** renameFolder() is a low-level IMAP capability that sentinel healer or future features may need. Only the user-facing route and frontend code are removed.

---

## Claude's Discretion

- Remove `renderFolderRenameCard` function entirely (no callers remain)
- Remove `api.folders.rename` client method (endpoint is being deleted)

## Deferred Ideas

None — discussion stayed within phase scope.
