# Phase 32: UI Cleanup - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove the manual folder rename feature from the settings page and its backing API endpoint. Sentinel auto-healing (Phase 31) replaces the need for manual folder renames — users no longer need to tell the app about folder name changes because sentinels detect and heal them automatically.

</domain>

<decisions>
## Implementation Decisions

### API Removal Strategy
- **D-01:** Remove the `POST /api/folders/rename` endpoint entirely (hard delete, not deprecation). Rationale: single-user app with no external consumers — a deprecation response adds complexity for zero benefit.

### CSS Cleanup
- **D-02:** Remove all rename-related CSS classes (`.rename-section`, `.rename-disabled-hint`, `.rename-warning`) from `styles.css`. Dead code should not linger.

### IMAP Rename Method Retention
- **D-03:** Keep `renameFolder()` on the folder cache (`src/folders/cache.ts`). It's a low-level IMAP primitive that the sentinel healer or future features may use. Only the UI-facing route and frontend code are removed.

### Claude's Discretion
- Whether to remove the `renderFolderRenameCard` function entirely or just remove its call site — Claude should remove the function entirely since it will have no callers.
- Whether to remove the `api.folders.rename` client method — Claude should remove it since the endpoint is being deleted.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01 (remove rename card) and UI-02 (remove rename API)

### Prior Phase Context
- `.planning/phases/31-auto-healing-failure-handling/31-CONTEXT.md` — Auto-healing decisions that make this phase possible

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Files to Modify
- `src/web/frontend/app.ts` — Contains `renderFolderRenameCard()` function (~180 lines) and its call site at line 1006
- `src/web/frontend/api.ts` — Contains `api.folders.rename()` client method at line 82
- `src/web/frontend/styles.css` — Contains `.rename-section`, `.rename-disabled-hint`, `.rename-warning` CSS classes starting at line 684
- `src/web/routes/folders.ts` — Contains `POST /api/folders/rename` route handler starting at line 28

### Files to Keep Unchanged
- `src/folders/cache.ts` — `renameFolder()` method stays (IMAP primitive, per D-03)
- `src/imap/client.ts` — Low-level IMAP rename stays

### Integration Points
- Settings page render function calls `renderFolderRenameCard(app)` — this call must be removed
- No other code references the rename API endpoint or UI card

</code_context>

<specifics>
## Specific Ideas

No specific requirements — straightforward removal of superseded functionality.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 32-ui-cleanup*
*Context gathered: 2026-04-22*
