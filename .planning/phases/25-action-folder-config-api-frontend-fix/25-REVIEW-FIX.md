---
phase: 25-action-folder-config-api-frontend-fix
fixed_at: 2026-04-21T00:00:00Z
review_path: .planning/phases/25-action-folder-config-api-frontend-fix/25-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 3
skipped: 1
status: partial
---

# Phase 25: Code Review Fix Report

**Fixed at:** 2026-04-21T00:00:00Z
**Source review:** .planning/phases/25-action-folder-config-api-frontend-fix/25-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 3
- Skipped: 1

## Fixed Issues

### CR-01: PUT route casts unvalidated body with `as any`, bypassing type safety entirely

**Files modified:** `src/web/routes/action-folder-config.ts`
**Commit:** f1668b1
**Applied fix:** Added null/object guard before the repository call so missing or non-object bodies return 400 with a clear error. Replaced `as any` double-cast with `as Partial<ActionFolderConfig>` using a proper type import.

### WR-01: Race condition -- action-folder prefix fetch result may arrive after folder selection

**Files modified:** `src/web/frontend/app.ts`
**Commit:** 3f3d4ad
**Applied fix:** Replaced the floating `.then()/.catch()` Promise with an awaited try/catch block so the action-folder prefix is resolved before `renderFolderPicker` renders.

### WR-02: `details` field in 400 response may expose internal Zod error paths

**Files modified:** `src/web/routes/action-folder-config.ts`
**Commit:** f1668b1
**Applied fix:** Removed the `details: [err.message]` field from the 400 validation error response, returning only `{ error: 'Validation failed' }`. Committed atomically with CR-01 since both changes target the same file and handler.

## Skipped Issues

### WR-03: Missing `await` on re-render `renderFolderPicker` inside rename error handler

**File:** `src/web/frontend/app.ts:1788-1792`
**Reason:** False positive. In an async function, `finally` runs only after the `catch` block has fully completed, including any `await` expressions within it. The `await renderFolderPicker(...)` on line 1789 resolves fully before the `finally` block on line 1794 executes. The reviewer acknowledged this uncertainty in their parenthetical note. No code change needed.
**Original issue:** The `finally` block allegedly fires before the `await renderFolderPicker` inside catch resolves, creating a brief state where the user can interact with stale UI.

---

_Fixed: 2026-04-21T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
