# Phase 5: Frontend Polish - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three specific tech debt items from the v0.3 milestone audit: a protocol mismatch bug in the batch dry-run no-match display, inconsistent raw fetch usage for the cursor toggle API, and unsafe `catch(e: any)` error typing in app.ts. No new features — pure cleanup.

</domain>

<decisions>
## Implementation Decisions

### No-Match Display Fix (BATC-06 integration fix)
- **D-01:** Fix the frontend filter to check `action === 'no-match'` instead of `action === 'skip' && destination === ''`. The backend (`BatchEngine`) already returns the semantically correct `action='no-match'` value — the frontend was filtering for the wrong thing.
- **D-02:** No-match group gets muted styling (existing `.no-match` CSS class: `color: #888; font-weight: 400`) plus a subtle divider line separating it from the match groups above.
- **D-03:** No-match group label: "No match (stay in folder)" — already implemented in `buildDryRunGroup()`, just not rendering due to the filter bug.

### Cursor Toggle API Migration
- **D-04:** Add `getCursor()` and `setCursor(enabled: boolean)` methods to the existing `api.config` namespace in the api wrapper. No new namespace — cursor toggle is a configuration concept.
- **D-05:** Replace the raw `fetch('/api/settings/cursor')` calls at lines 437 and 489 of app.ts with `api.config.getCursor()` and `api.config.setCursor()`.

### Error Typing Cleanup
- **D-06:** Replace all 6 `catch(e: any)` blocks with `catch(e: unknown)` using inline `instanceof Error` check: `const msg = e instanceof Error ? e.message : String(e)`. Matches the existing pattern at line 242 of app.ts.
- **D-07:** No shared helper function — keep the check inline at each catch site. Matches existing codebase conventions and avoids unnecessary abstraction.

### Claude's Discretion
- Exact CSS for the divider line between match groups and no-match group (border, margin, or spacing)
- Whether `api.config.getCursor` returns `{ enabled: boolean }` or just `boolean` (follow existing api wrapper patterns)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend Source
- `src/web/frontend/app.ts` — Main SPA file. Lines 437, 489 (raw fetch for cursor toggle), lines 106, 121, 136, 331, 390, 503 (catch(e: any) blocks), lines 599-640 (dry-run preview rendering with no-match group logic)
- `src/web/frontend/api.ts` — API wrapper object with namespaced methods. Add cursor toggle methods to `config` namespace.
- `src/web/frontend/styles.css` lines 375-384 — Dry-run group CSS including existing `.no-match` class

### Backend Reference
- `src/batch/index.ts` — BatchEngine returns `action='no-match'` for unmatched messages (the correct value)
- `src/shared/types.ts` — Shared API types including `DryRunGroup`

### Requirements
- `.planning/REQUIREMENTS.md` — BATC-06 (dry-run mode previews)

### Milestone Audit
- `.planning/v0.3-MILESTONE-AUDIT.md` lines 98-106 — Tech debt items that define this phase's scope

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api` wrapper in `api.ts` — already imported in app.ts, has `config` namespace with `getImap()`, `getReview()`, etc.
- Existing `catch(e: unknown)` pattern at app.ts line 242 — template for all 6 replacements
- `.no-match` CSS class — already defined, just not being applied due to the filter bug

### Established Patterns
- API wrapper methods return parsed JSON (e.g., `api.config.getImap()` returns typed object)
- Error handling: `catch(e: unknown) { const msg = e instanceof Error ? e.message : String(e); toast(msg, true); }`
- Dry-run groups rendered via `buildDryRunGroup()` function with `isNoMatch` boolean parameter

### Integration Points
- `src/web/frontend/api.ts` — Add `getCursor()` and `setCursor()` to config namespace
- `src/web/frontend/app.ts` — All changes are in this single file (plus api.ts for new methods)
- `src/web/frontend/styles.css` — Add divider styling for no-match group separation

</code_context>

<specifics>
## Specific Ideas

No specific requirements — straightforward bug fix and cleanup following existing codebase patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-frontend-polish*
*Context gathered: 2026-04-11*
