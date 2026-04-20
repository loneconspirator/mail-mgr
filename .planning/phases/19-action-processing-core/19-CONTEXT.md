# Phase 19: Action Processing Core - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can VIP, block, undo-VIP, and unblock senders by moving messages to action folders. This phase delivers the processor that extracts senders from messages, creates or removes rules via the action registry, handles conflicting rules, and moves messages to their final destination. Requirements: PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-06, PROC-09, PROC-10, RULE-01, RULE-02, RULE-03, RULE-04.

This phase does NOT include monitoring/polling integration (Phase 20) or idempotency/edge cases (Phase 21). The processor is called by Phase 20's monitoring loop — this phase delivers the processing function(s) that take a message and action type and do the work.

</domain>

<decisions>
## Implementation Decisions

### Processor Architecture
- **D-01:** Class-based processor (`ActionFolderProcessor`) with constructor-injected dependencies (ConfigRepository, ImapClient, ActivityLog, Logger). Matches established patterns in the codebase (MoveTracker, BatchEngine are classes with constructor DI).
- **D-02:** Single public method `processMessage(message, actionType)` that orchestrates the full flow: extract sender → check conflicts → create/remove rule → move message → log activity. Returns a result object for the caller.
- **D-03:** Processor lives in `src/action-folders/processor.ts`, exported from `src/action-folders/index.ts`.

### Sender Extraction
- **D-04:** Parse sender from the message's envelope/From header. Normalize to lowercase bare email address (strip display name, lowercase). Per PROC-05.
- **D-05:** Use a dedicated `extractSender(message)` utility function within the processor module. Parse using standard email address extraction (angle brackets, bare address formats).
- **D-06:** If no parseable From address: move message to INBOX, log error, return early. Per PROC-06. Do not throw — caller should not need to catch.

### Rule Creation & Removal
- **D-07:** Created rules use `configRepo.addRule()` — same Zod validation path as web UI rules. Per RULE-01.
- **D-08:** Rule names follow pattern: `"VIP: sender@example.com"`, `"Block: sender@example.com"`. Per RULE-02.
- **D-09:** Rules are appended at end of rule list via `addRule()` which pushes to array end. Per RULE-03.
- **D-10:** For remove operations (undo-vip, unblock): use `findSenderRule()` from `src/rules/sender-utils.ts` to locate the matching rule, then `configRepo.deleteRule(id)` to remove it.

### Conflict Resolution
- **D-11:** For create operations: before creating the new rule, check for conflicting sender-only rules using `findSenderRule()` with the opposite action type. Per PROC-09.
- **D-12:** If conflict found: remove conflicting rule first, then create new rule. Log both removal and creation as separate activity entries with same message_id. Per Phase 18 D-06.
- **D-13:** If a more specific rule exists (multi-field match beyond just sender): preserve it, append the new action folder rule after it. Per PROC-10. Use `isSenderOnly()` to distinguish — non-sender-only rules for the same sender are preserved.

### Message Routing
- **D-14:** After rule operation completes, move message to final destination using `ImapClient.moveMessages()`.
- **D-15:** Resolve abstract destinations ('inbox', 'trash') from config at runtime. INBOX from IMAP config, Trash from trash folder resolution (existing `resolveTrashFolder` logic). Per Phase 18 D-10.
- **D-16:** If message move fails: log error but don't roll back rule changes. The rule change is the user's intent — a stuck message in an action folder will be retried on next poll (Phase 20).

### Claude's Discretion
- Internal type for processMessage return value (success/error result shape)
- Whether extractSender uses a regex or a small parser library
- Error message wording for unparseable From addresses
- Whether conflict check and rule creation are wrapped in a single method or kept as sequential steps
- Test fixture structure for mock messages and rules

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & PRD
- `.planning/REQUIREMENTS.md` — PROC-01 through PROC-06, PROC-09, PROC-10, RULE-01 through RULE-04
- `.planning/ROADMAP.md` §Phase 19 — Success criteria (7 items) and dependency on Phase 18
- `docs/prd-v0.6.md` §AF-01 — Action folder set (all four actions, duplicate prevention, conflicting rules)
- `docs/prd-v0.6.md` §AF-03 — Sender extraction spec (bare email, lowercase, error case)
- `docs/prd-v0.6.md` §AF-04 — Activity logging format (source, action values, rule fields)

### Prior phase context
- `.planning/phases/17-configuration-folder-lifecycle/17-CONTEXT.md` — Config schema decisions, folder names, config keys
- `.planning/phases/18-safety-predicates-activity-log/18-CONTEXT.md` — Registry pattern (D-07 through D-10), sender-utils (D-11/D-12), activity log extension (D-04 through D-06)

### Existing code (Phase 18 building blocks)
- `src/action-folders/registry.ts` — ACTION_REGISTRY with operation/ruleAction/destination per action type
- `src/rules/sender-utils.ts` — `findSenderRule()` and `isSenderOnly()` predicates
- `src/config/repository.ts:31-42` — `addRule()` with Zod validation and UUID generation
- `src/config/repository.ts:60-65` — `deleteRule()` for rule removal
- `src/log/index.ts:87` — `logActivity()` with `'action-folder'` source support
- `src/action-folders/folders.ts` — `ensureActionFolders()` for reference on config/client patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ACTION_REGISTRY` (registry.ts): Declarative lookup — given an action type, get operation, ruleAction, destination, folderConfigKey
- `findSenderRule()` (sender-utils.ts): Finds matching sender-only rule by sender + action type — used for both conflict detection and undo lookups
- `isSenderOnly()` (sender-utils.ts): Distinguishes sender-only rules from more specific rules — needed for PROC-10
- `configRepo.addRule()`: Creates rule with UUID, Zod validation, persists, notifies listeners
- `configRepo.deleteRule()`: Removes rule by ID, persists, notifies listeners
- `logActivity()`: Accepts `'action-folder'` source, takes ActionResult + EmailMessage + Rule

### Established Patterns
- Class with constructor DI for stateful components (MoveTracker, BatchEngine)
- `configRepo.getRules()` returns current rule array — always fresh after add/delete
- Activity log entries use `ActionResult` shape: `{ type, folder }` where type is the disposition action
- Rule creation via `addRule(Omit<Rule, 'id'>)` — caller provides everything except id

### Integration Points
- `src/action-folders/processor.ts` — New file, the core deliverable
- `src/action-folders/index.ts` — Export processor alongside existing exports
- Processor receives ConfigRepository, ImapClient, ActivityLog, Logger via constructor
- Phase 20 will instantiate processor in startup sequence and call it from poll handler

</code_context>

<specifics>
## Specific Ideas

- The processor is a "called" component — it doesn't poll or monitor. Phase 20's monitoring loop calls `processMessage()` when it detects a message in an action folder. This keeps Phase 19 focused on pure processing logic.
- Conflict resolution order matters: remove conflicting rule FIRST, then create new rule. This avoids any window where two conflicting rules coexist.
- Rule names like "VIP: sender@example.com" make rules immediately identifiable in the rule list and disposition views (RULE-04).
- The abstract destination resolution (D-15) means the processor doesn't hardcode any folder paths — everything comes from config, matching Phase 18's registry design.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-action-processing-core*
*Context gathered: 2026-04-20*
