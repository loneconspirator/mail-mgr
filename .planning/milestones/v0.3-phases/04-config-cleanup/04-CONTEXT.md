# Phase 4: Config & Cleanup - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Editable sweep/archive settings in the web UI, optional rule names with behavior-driven display, stale sweeper reference fix, and message cursor toggle. This phase is cleanup and configuration polish — no new processing capabilities.

</domain>

<decisions>
## Implementation Decisions

### Sweep Settings Editing (CONF-01)
- **D-01:** Edit in place on the existing Sweep Settings card — swap read-only `<dd>` elements for input fields with a Save button. No modal.
- **D-02:** Editable fields: review folder, archive folder, trash folder, sweep interval, read max age, unread max age — all fields currently displayed.
- **D-03:** Folder fields (archive folder, review folder, trash folder) use the Phase 2 tree picker component for selection. Consistent with rule editor UX.

### Archive Defaults (CONF-02 — narrowed)
- **D-04:** No per-stream archive split. Inbox processing (Monitor) has no archive fallback and doesn't need one — unmatched messages stay in INBOX. CONF-02 reduces to making the existing `defaultArchiveFolder` editable in the sweep settings UI.
- **D-05:** The `PUT /api/config/review` route already accepts updates — backend is partially wired. Frontend needs the editable form.

### Stale Sweeper Reference (CONF-03)
- **D-06:** `ServerDeps.getSweeper` uses a closure over `let sweeper` which tracks reassignment — verify whether the reported bug is a real timing gap or already resolved by the getter pattern. Fix if real, close if not.

### Message Cursor Toggle (CONF-04)
- **D-07:** Settings option to disable `lastUid` persistence. When disabled, Monitor does a full re-evaluation on restart instead of resuming from the last processed UID.

### Rule Name / Behavior Display (CONF-05 — revised)
- **D-08:** Rule `name` field becomes optional in the Zod schema (change `z.string().min(1)` to `z.string().optional()`).
- **D-09:** Rules always display a generated behavior description built from populated match fields and action. Format: `sender:*@github.com, subject:*PR* → Notifications`. Only include match fields that have a value — skip empty ones.
- **D-10:** If a user-provided name exists, show it as secondary text alongside the behavior description. The behavior description is always primary.
- **D-11:** Generation is display-side only — no auto-generated name is stored in the config. The `name` field is either user-provided or absent.

### Claude's Discretion
- Save button behavior (inline save vs submit-all)
- Validation feedback style for sweep settings form
- Exact CSS/layout for the editable sweep card
- How the message cursor toggle is presented in the settings UI
- Investigation approach for the stale sweeper bug (CONF-03)

### Folded Todos
- "Make message cursor optional via settings toggle" — maps directly to CONF-04
- "Make rule name optional with auto-generated description fallback" — maps directly to CONF-05 (revised to remove name field as primary, use behavior description instead)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Patterns
- `src/web/frontend/app.ts` lines 430-445 — Current read-only Sweep Settings card. This is what becomes editable.
- `src/web/routes/review-config.ts` — `PUT /api/config/review` already exists and accepts updates. Backend partially done.
- `src/config/schema.ts` lines 77-101 — `sweepConfigSchema`, `reviewConfigSchema`, `sweepDefaults`, `reviewDefaults`. Schema for all editable sweep fields.
- `src/config/schema.ts` lines 45-52 — `ruleSchema` with `name: z.string().min(1)` — must change to optional.

### Config Reload Flow
- `src/index.ts` lines 67-113 — `onReviewConfigChange` and `onImapConfigChange` handlers. Rebuild sweeper, monitor, batch engine. Key to understanding CONF-03 stale reference bug.
- `src/web/server.ts` lines 20-29 — `ServerDeps` interface with getter functions (`getSweeper`, `getMonitor`, etc.).

### Sweep Destination Resolution
- `src/sweep/index.ts` — `resolveSweepDestination()` uses `defaultArchiveFolder` as fallback. Only the sweep path uses this — Monitor does not.

### Monitor UID Persistence
- `src/monitor/index.ts` lines 43-44, 108-110 — `lastUid` loaded from and persisted to SQLite state table. CONF-04 toggle controls this.

### Frontend Components
- Phase 2 tree picker component — reuse for folder selection fields in sweep settings.

### Requirements
- `.planning/REQUIREMENTS.md` — CONF-01 through CONF-05 define this phase's scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PUT /api/config/review` route — already handles review config updates with validation
- Phase 2 tree picker component — reuse for folder field selection
- `ConfigRepository.updateReviewConfig()` — backend method for persisting review config changes
- `configRepo.onReviewConfigChange()` — hot-reload callback, already triggers sweeper rebuild

### Established Patterns
- Settings page uses `settings-card` CSS class with `<dl class="sweep-info">` for display
- Config changes trigger `onReviewConfigChange` / `onImapConfigChange` callbacks for live reload
- Zod schemas define defaults and validation — single source of truth for config shape
- Getter functions in ServerDeps (`getSweeper()`, `getMonitor()`) track reassigned local variables via closure

### Integration Points
- `src/web/frontend/app.ts` — Sweep Settings card rendering needs edit mode
- `src/config/schema.ts` — Rule schema `name` field constraint change
- `src/web/routes/rules.ts` — Rule CRUD routes may need adjustment for optional name
- `src/web/frontend/app.ts` — Rule list rendering needs behavior description generation
- `src/log/index.ts` — Activity log displays `rule_name` — may need to show behavior description when name is null

</code_context>

<specifics>
## Specific Ideas

- Rule behavior description format: `sender:*@github.com, subject:*PR* → Notifications` — only populated match fields, comma-separated, arrow to destination
- Name is secondary when present, behavior description is always primary display

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)
None — both matched todos were folded into scope.

</deferred>

---

*Phase: 04-config-cleanup*
*Context gathered: 2026-04-10*
