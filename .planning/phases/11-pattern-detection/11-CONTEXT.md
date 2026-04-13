# Phase 11: Pattern Detection & Proposed Rules - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

System analyzes accumulated move signals to identify repeating patterns, surfaces them as proposed rules with strength scoring, and provides a UI for the user to approve, modify, or dismiss proposals. Pattern detection runs in real-time as signals arrive. This phase delivers the analysis engine, proposed rules storage, API, and UI.

</domain>

<decisions>
## Implementation Decisions

### Pattern Matching Strategy
- **D-01:** One proposal per sender + envelope_recipient + source_folder combination. This is the grouping key for pattern detection.
- **D-02:** Each new move signal either strengthens or weakens an existing proposal. Same destination = +1 strength. Different destination = -1 strength (counterindication). Strength = matching signals - contradicting signals.
- **D-03:** Negative-strength proposals are retained as ambiguous counterindications, not deleted. They represent conflicting user behavior that may be resolved by adding refinements (visibility, subject matching, or future LLM analysis).
- **D-04:** All proposals with strength >= 1 are shown to the user. Ambiguous proposals (negative strength) are also visible. Maximum transparency — user decides what's noise.
- **D-05:** Strength is displayed as plain language: "Strong pattern (N moves)", "Weak (1 move)", "Ambiguous — conflicting destinations". No raw numeric scores exposed in the UI.
- **D-06:** Conflicted proposals (same sender+recipient+source but different destinations) show as one proposal with the dominant destination, annotated with the conflicting destinations and their respective move counts.

### Proposed Rules Lifecycle
- **D-07:** Proposed rules stored in a new SQLite `proposed_rules` table, separate from config.yml real rules. Proposals live in the database until approved (copied to config) or dismissed.
- **D-08:** Approve action creates a real rule in config.yml via `ConfigRepository.addRule()` (triggers hot-reload) and marks the proposal as approved.
- **D-09:** Dismiss action suppresses the proposal, but it resurfaces if 5+ new signals arrive after dismissal. The system notes "You dismissed this but kept moving these messages."
- **D-10:** Signal retention is 90 days (inherited from Phase 10 D-08), giving the analysis engine a wide window.

### UI Presentation
- **D-11:** Proposed rules get their own "Proposed" nav tab in the top navigation bar, alongside Rules, Activity, Batch, Settings.
- **D-12:** Each proposal card shows: plain-language strength label, sender → destination, envelope recipient, and 2-3 recent example message subjects with dates from move_signals.
- **D-13:** Each card has Approve, Modify, and Dismiss action buttons.
- **D-14:** Modify opens the existing rule editor pre-filled with the proposed match fields (sender glob, envelope recipient, destination folder action). User can add subject matching, visibility filters, or other refinements before saving as a real rule.

### Analysis Trigger
- **D-15:** Pattern detection runs immediately after each new move signal is logged, scoped to the affected sender+recipient+source combo. Real-time proposal updates with no stale data.

### Claude's Discretion
- Whether approved proposal rows are kept as historical records or deleted after the real rule is created
- SQL schema details for proposed_rules table (columns, indexes, constraints)
- How conflicting destination data is stored (JSON column, separate table, etc.)
- Exact plain-language thresholds for "Strong" vs "Weak" labels
- How the resurface-after-dismiss threshold (5+ new signals) is tracked
- Sorting/ordering of proposals in the UI (by strength, by recency, etc.)
- Whether to show a badge count on the Proposed tab when new proposals exist

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — LEARN-03 (statistical analysis, configurable thresholds), LEARN-04 (proposed rules UI with approve/modify/dismiss), LEARN-05 (approved rules become real rules with hot-reload), UI-02 (proposed rules view)

### Upstream Phase Context
- `.planning/phases/10-move-tracking/10-CONTEXT.md` — D-04/D-05 (two-tier destination resolution), D-07 (signal data schema), D-08 (90-day retention), D-09 (MoveTracker standalone pattern)

### Existing Code — Signal Storage
- `src/tracking/signals.ts` — SignalStore class with `logSignal()`, `getSignals()`, `getSignalByMessageId()`, `prune()`. This is where Phase 11 reads move data from.
- `src/tracking/index.ts` — MoveTracker class. Pattern detection hooks into signal logging here.

### Existing Code — Rule System
- `src/config/schema.ts` — Zod schemas for Rule, EmailMatch, Action types. Proposed rules must generate valid Rule objects when approved.
- `src/config/repository.ts` — `ConfigRepository.addRule()` with hot-reload via `onRulesChange()`. Used when approving proposals.
- `src/rules/matcher.ts` — `matchRule()` with picomatch globs. Proposed rules should generate match fields compatible with this.

### Existing Code — Web UI
- `src/web/frontend/app.ts` — Main SPA logic, nav rendering, page patterns. New "Proposed" tab added here.
- `src/web/frontend/api.ts` — Typed fetch wrapper. Extend with proposed rules API endpoints.
- `src/web/routes/rules.ts` — Rule CRUD route pattern to follow for proposed rules API.
- `src/web/server.ts` — Fastify server, ServerDeps interface, route registration.

### Existing Code — Database
- `src/log/migrations.ts` — Versioned migration system for `proposed_rules` table creation.
- `src/log/index.ts` — ActivityLog pattern for DB access, state management.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SignalStore.getSignals()` — Query move signals for pattern analysis
- `ConfigRepository.addRule()` — Create real rules from approved proposals (with validation + hot-reload)
- `runMigrations()` — Versioned migration for proposed_rules table
- Rule editor in `app.ts` — Reuse for Modify flow (pre-fill with proposal data)
- `ActivityLog.getState()`/`setState()` — Could track dismiss metadata

### Established Patterns
- MoveTracker standalone class with start()/stop() — pattern detector could follow same structure or be a method on MoveTracker
- Fastify route registration in server.ts — new /api/proposed-rules routes follow same pattern
- Zod schema validation — proposed_rules API should validate input same way
- ServerDeps expansion — add getPatternDetector() or extend getMoveTracker()

### Integration Points
- `src/tracking/signals.ts` — Hook into signal logging to trigger real-time analysis
- `src/web/frontend/app.ts` — Add "Proposed" nav tab and page renderer
- `src/web/server.ts` — Register proposed rules routes
- `src/config/repository.ts` — Approve flow calls addRule()
- `src/log/migrations.ts` — New migration for proposed_rules table

</code_context>

<specifics>
## Specific Ideas

- User explicitly designed the strength model: every move creates or updates a proposal, with reinforcement (+1 same destination) and counterindication (-1 different destination). This is the core innovation of the phase.
- Ambiguous/negative proposals are kept as valuable data — the user may later refine them by adding visibility or subject matching during the Modify flow, or future LLM analysis could resolve the ambiguity.
- The resurface-after-dismiss mechanic ("you dismissed this but kept moving these messages") is specifically desired — the system should gently push back when user behavior contradicts their dismissal.
- Plain language display was chosen over numeric scores — the user wants this to feel approachable, not like a data analytics dashboard.

</specifics>

<deferred>
## Deferred Ideas

- LLM analysis to resolve ambiguous proposals (mentioned by user as a future phase capability)
- Subject matching and visibility as automatic pattern refinements (user wants these added manually during Modify, not auto-detected in Phase 11)

</deferred>

---

*Phase: 11-pattern-detection*
*Context gathered: 2026-04-12*
