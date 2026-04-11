# Phase 3: Batch Filing Engine - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Retroactive rule application engine. Users select a source folder, the system applies the full ruleset to all messages in that folder, and moves matches to their destinations. Includes dry-run preview mode and mid-run cancellation. This phase builds the backend engine and basic API — real-time SSE progress and batch summary UI are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Rule Selection & Scope
- **D-01:** Apply entire ruleset to the source folder — no per-rule selection. Matches how Monitor already works (first-match-wins across all rules).
- **D-02:** Unmatched messages stay in the source folder. No catchall destination.
- **D-03:** Process all messages in the folder — no date range or read/unread filtering. Dry-run is the safety valve.
- **D-04:** Source folder selected via the Phase 2 tree picker component — consistent UX.

### Dry-Run Preview
- **D-05:** Dry-run results grouped by destination folder with message counts (e.g., "Receipts (47)", "Newsletters (23)", "No match (12)").
- **D-06:** Groups are expandable to show individual messages for sanity-checking before committing.
- **D-07:** Dry-run flows directly into execution — a "Run batch" button on the preview lets the user confirm and execute without restarting the workflow.

### Cancellation
- **D-08:** Visible "Cancel" button while batch is running. Stops after the current chunk completes.
- **D-09:** After cancellation, show partial results summary with moved/skipped/remaining counts.
- **D-10:** Already-moved messages stay moved after cancellation. No undo in v1 (BATC-08 is v2).

### Destination Resolution
- **D-15:** Batch uses sweep-style destination resolution, not monitor-style. Review rules with a folder move to that folder (their final destination). Review rules without a folder are skipped — the message stays in the source folder. Rationale: the review folder is a transient triage queue; batch-processing an archive folder should not move manually-filed messages into a default archive. Bias toward leaving messages where they are when no explicit destination exists.

### Job Lifecycle
- **D-11:** Batch and monitor share the single IMAP connection. Batch yields between chunks so monitor can process new mail.
- **D-12:** One batch at a time — UI disables start while a batch is active.
- **D-13:** Batch runs server-side regardless of browser state. User can navigate away and return to see progress or final results.
- **D-14:** Batch moves logged to the activity log with source='batch' — consistent with monitor (source='monitor') and sweep (source='sweep'). No separate batch history table.

### Claude's Discretion
- Chunk size (25-50 messages per chunk — already flagged in STATE.md research)
- Yield mechanism between chunks (setTimeout, setImmediate, or similar)
- Internal batch state machine design
- API endpoint structure for batch operations

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Patterns
- `src/sweep/index.ts` — ReviewSweeper is the closest pattern: iterates messages, evaluates rules, moves with per-message error isolation. Batch engine should follow this structure.
- `src/actions/index.ts` — `executeAction()`, `ActionContext`, `ActionResult` — reusable for batch moves.
- `src/rules/index.ts` — `evaluateRules()` — first-match-wins evaluation, reuse directly.
- `src/imap/messages.ts` — `EmailMessage` and `ReviewMessage` types, `reviewMessageToEmailMessage()` converter.

### Requirements
- `.planning/REQUIREMENTS.md` — BATC-01 through BATC-06 define this phase's scope. BATC-04 (SSE progress) and BATC-07 (summary report) are Phase 4.

### Research Gaps (from STATE.md)
- Fastmail concurrent IMAP connection limit — affects whether batch can use a dedicated second connection (decision: share single connection, D-11)
- Activity log indexing — needed before batch ships due to hundreds of entries per job

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ReviewSweeper.runSweep()` — per-message loop with error isolation, activity logging, running guard. Batch engine mirrors this pattern.
- `evaluateRules()` — first-match-wins rule evaluation, works on `EmailMessage` type.
- `executeAction()` — handles move/delete/skip/review with auto-folder-creation retry.
- `ActionResult` — success/error result type with message UID, action, folder, rule.
- `ActivityLog.logActivity()` — already supports a `source` parameter ('monitor', 'sweep') — add 'batch'.
- Phase 2 tree picker — reuse for source folder selection.
- `GET /api/folders` — folder list API from Phase 1.

### Established Patterns
- Dependency injection via interfaces (`SweepDeps`, `ActionContext`, `MonitorDeps`) — batch should follow same pattern.
- Per-message error isolation: individual failures logged and counted, don't abort the loop.
- State exposed via getter method (`getState()`) for API consumption.
- Activity logging with source tag to distinguish origin.

### Integration Points
- `src/web/server.ts` — `ServerDeps` needs batch engine accessor (like `getMonitor()`, `getSweeper()`).
- `src/index.ts` — batch engine instantiated and wired into deps alongside Monitor and ReviewSweeper.
- `src/web/routes/` — new batch route file(s) for start/cancel/status/dry-run endpoints.
- `src/log/index.ts` — activity log may need indexing for batch-scale inserts.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches following existing codebase patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-batch-filing-engine*
*Context gathered: 2026-04-08*
