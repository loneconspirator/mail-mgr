# Phase 18: Safety Predicates & Activity Log - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

MoveTracker correctly ignores action folder moves, the activity log supports action-folder operations, a declarative action type registry exists, and a shared `findSenderRule` predicate is available for reuse. This phase delivers building blocks only — no processor class, no polling, no message handling. Requirements: LOG-01, LOG-02, EXT-01.

</domain>

<decisions>
## Implementation Decisions

### MoveTracker Safety
- **D-01:** Extend `isSystemMove()` IN clause to include `'action-folder'`. Single check covers all system-initiated moves. No separate predicate needed.
- **D-02:** Activity log cross-reference only — no path awareness in MoveTracker. MoveTracker does NOT get a list of action folder paths or skip scanning them. It relies purely on the activity log entry from the action folder processor.
- **D-03:** Rely on two-scan confirmation window for timing safety. MoveTracker's existing two-consecutive-scan requirement naturally gives the action processor time to log its activity before the confirmation scan fires. No explicit coordination or notification mechanism between the two systems.

### Activity Logging Extension
- **D-04:** Extend `logActivity()` source union type to include `'action-folder'`. Action folder processor builds `ActionResult`-shaped objects for logging. One method for all sources.
- **D-05:** Action values for undo operations use user-intent strings: `'vip'`, `'block'`, `'undo-vip'`, `'unblock'`. Describes what the user did, not the rule mechanics. Clear in activity log UI.
- **D-06:** Conflicting rule removal produces two separate activity log entries — one for the removal, one for the creation. Same `message_id` links them. Simple, auditable, no schema changes.

### Action Type Registry
- **D-07:** Static `Record<string, ActionDefinition>` keyed by action type string. Module-level constant, no class. Adding a new action type = adding an entry.
- **D-08:** Action type identifiers use camelCase: `'vip'`, `'block'`, `'undoVip'`, `'unblock'`. Matches Phase 17 config schema keys (`actionFolders.folders.vip`, `.undoVip`, etc.).
- **D-09:** Registry entries use declarative config, not callback functions: `{ operation: 'create' | 'remove', ruleAction: 'skip' | 'delete' }`. Two fields fully describe all four action types. Processor has a single code path for create vs remove.
- **D-10:** Registry stores abstract destination references (`'inbox'` | `'trash'`), resolved to actual folder paths from config at runtime. Survives config changes without re-registration.

### Shared findSenderRule Predicate
- **D-11:** New file `src/rules/sender-utils.ts`. Extract `isSenderOnly()` there too (re-export from `dispositions.ts` for backward compat). Clean rules-domain home for sender rule lookups.
- **D-12:** `findSenderRule(sender, actionType, rules)` returns `Rule | undefined`. Simple — caller checks action type for conflict detection. Matches existing patterns in `conflict-checker.ts`.

### File Organization
- **D-13:** New directory `src/action-folders/` for all action folder code (registry now, processor in Phase 19). Isolated from existing `src/actions/` which handles rule execution.
- **D-14:** Pure building blocks only — no processor skeleton. Phase 18 delivers: isSystemMove extension, logActivity extension, ActionRegistry data structure, findSenderRule function. Phase 19 creates the processor from scratch using these blocks.

### Claude's Discretion
- Internal naming of ActionDefinition type fields
- Whether findSenderRule uses exact string match or picomatch for sender comparison
- Test file organization within test/unit/ for new modules
- Whether isSenderOnly re-export uses `export { isSenderOnly } from` or a wrapper function

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & PRD
- `.planning/REQUIREMENTS.md` — LOG-01, LOG-02, EXT-01 requirement definitions
- `.planning/ROADMAP.md` §Phase 18 — Success criteria (4 items) and dependency on Phase 17
- `docs/prd-v0.6.md` §AF-04 — Activity logging spec (source value, action values, message fields)
- `docs/prd-v0.6.md` §AF-01 — Conflicting rules behavior (PROC-09, PROC-10)

### Research
- `.planning/research/ARCHITECTURE.md` — ActionFolderProcessor design, component boundaries, data flow diagrams
- `.planning/research/PITFALLS.md` — IMAP timing risks, race condition patterns

### Prior phase context
- `.planning/phases/17-configuration-folder-lifecycle/17-CONTEXT.md` — Config schema decisions (D-01 through D-12), folder creation strategy, config keys

### Existing code to modify or extend
- `src/log/index.ts` — `isSystemMove()` at line 170 (extend IN clause), `logActivity()` at line 87 (extend source union)
- `src/tracking/index.ts` — MoveTracker (no changes needed, but understand `handleDisappearedMessage` flow)
- `src/web/routes/dispositions.ts` — `isSenderOnly()` predicate to extract to shared utils
- `src/rules/conflict-checker.ts` — `senderMatches()` pattern to reuse in findSenderRule

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isSenderOnly()` in `src/web/routes/dispositions.ts`: Already implements the sender-only rule check. Extract to `src/rules/sender-utils.ts` for shared use.
- `senderMatches()` in `src/rules/conflict-checker.ts`: Case-insensitive sender comparison. Same logic needed in `findSenderRule`.
- `hasNarrowingFields()` in `src/rules/conflict-checker.ts`: Detects rules with fields beyond sender. Useful for PROC-10 (preserving more specific rules).

### Established Patterns
- Activity log source as string literal union (`'arrival' | 'sweep' | 'batch'`). Extend with `'action-folder'`.
- `logActivity()` takes `ActionResult`, `EmailMessage`, `Rule | null`, and source. Action folder processor must build compatible objects.
- `isSystemMove()` uses a simple SQL IN clause with 1-day lookback window.
- Module-level constants for static data (e.g., `DISPOSITION_TYPES` in dispositions.ts). Same pattern for action registry.

### Integration Points
- `src/log/index.ts` — isSystemMove() SQL and logActivity() type signature
- `src/rules/sender-utils.ts` — New file, imported by action folder processor (Phase 19) and re-exported for dispositions
- `src/action-folders/registry.ts` — New file, imported by action folder processor (Phase 19)
- `src/web/routes/dispositions.ts` — Import isSenderOnly from new shared location

</code_context>

<specifics>
## Specific Ideas

- The two-scan confirmation window is the key safety mechanism — we discussed in detail how MoveTracker's existing architecture naturally handles the timing gap with the action processor without any explicit coordination
- Action-folder moves are conceptually system moves (the user's intent is "VIP this sender" not "file to Actions/VIP Sender"), so extending `isSystemMove` is semantically correct
- User-intent action values ('vip', 'block', 'undo-vip', 'unblock') were chosen because activity log is user-facing — readability over query structure

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-safety-predicates-activity-log*
*Context gathered: 2026-04-20*
