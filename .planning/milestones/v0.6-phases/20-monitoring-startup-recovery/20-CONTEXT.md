# Phase 20: Monitoring & Startup Recovery - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Action folders are continuously monitored via poll-based IMAP STATUS checks and any pending messages are processed on startup before entering the normal monitoring loop. This phase delivers the polling integration, startup pre-scan, and always-empty invariant. Requirements: MON-01, MON-02, FOLD-02, FOLD-03.

This phase does NOT include idempotency/edge cases (Phase 21). The ActionFolderProcessor from Phase 19 handles the actual message processing — this phase wires it into the monitoring lifecycle.

</domain>

<decisions>
## Implementation Decisions

### Poll Mechanism
- **D-01:** Separate poll timer (`setInterval`) in `index.ts`, NOT integrated into the event-driven Monitor class. Action folder polling uses periodic STATUS checks on multiple folders — a fundamentally different pattern from Monitor's IMAP IDLE-based arrival detection.
- **D-02:** Poll interval uses `actionFolders.pollInterval` config (15s default from Phase 17 D-06). Timer stored on a variable with `.unref()` for clean shutdown, matching MoveTracker's timer pattern.
- **D-03:** Each poll tick: STATUS-check all enabled action folders, fetch messages from any with count > 0, process via `ActionFolderProcessor.processMessage()` for each message+actionType pair.

### Priority Processing
- **D-04:** Action folder processing takes structural priority over regular arrival routing (MON-02). The separate poll timer processes action folders independently from Monitor's event-driven INBOX processing.
- **D-05:** On startup, action folder pre-scan runs BEFORE `monitor.start()` — pending action folder messages are always processed before any new INBOX arrivals are handled.
- **D-06:** If both the action folder poll and Monitor's `processNewMessages()` fire concurrently, they operate on different mailboxes (action folders vs INBOX) so there's no conflict. The IMAP client handles concurrent operations.

### Startup Pre-scan
- **D-07:** One-shot scan of all action folders after `ensureActionFolders()` succeeds and BEFORE `monitor.start()` is called. Per FOLD-03.
- **D-08:** The pre-scan uses the exact same fetch-and-process logic as the regular poll — no separate code path. A shared function handles both startup scan and periodic poll.
- **D-09:** If pre-scan fails (IMAP error), log error and continue startup. Action folders will be picked up on the first regular poll tick. Graceful degradation, not a startup blocker.

### Always-Empty Invariant
- **D-10:** After processing all fetched messages from an action folder, do a STATUS re-check to confirm message count is 0. Per FOLD-02.
- **D-11:** If count > 0 after processing (new message arrived during processing), run one more fetch-and-process cycle for that folder. Single retry — if still non-zero after retry, log a warning and move on. Next poll tick will catch it.
- **D-12:** The invariant is a natural consequence of `processMessage()` already moving messages to their destinations. The STATUS re-check is a safety net, not a retry mechanism.

### Shutdown & Config Reload
- **D-13:** On shutdown: `clearInterval` on the action folder poll timer. Clean stop alongside Monitor/Sweeper/MoveTracker.
- **D-14:** On action folder config change (Phase 17 D-11 `onActionFolderConfigChange`): stop poll timer, re-read config, ensure any new folders exist, restart poll timer with new interval. Follow the existing sweeper rebuild pattern in `index.ts`.
- **D-15:** On IMAP config change: rebuild action folder polling alongside Monitor/Sweeper/MoveTracker rebuild. Same lifecycle.

### Claude's Discretion
- Internal function naming for the shared poll/scan logic
- Whether poll function is a standalone module or inline in index.ts
- Exact STATUS check API usage (imapClient.status() call pattern)
- Log messages and log levels for poll events
- Whether the poll timer callback is async-safe (guard against overlapping polls)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & PRD
- `.planning/REQUIREMENTS.md` — MON-01, MON-02, FOLD-02, FOLD-03 requirement definitions
- `.planning/ROADMAP.md` §Phase 20 — Success criteria (4 items) and dependency on Phase 19
- `docs/prd-v0.6.md` §AF-02 — Monitoring spec (poll-based STATUS, startup scan, always-empty)

### Prior phase context
- `.planning/phases/17-configuration-folder-lifecycle/17-CONTEXT.md` — Config schema (D-06 pollInterval, D-07 lazy creation, D-10 startup position, D-11 config change callback)
- `.planning/phases/18-safety-predicates-activity-log/18-CONTEXT.md` — MoveTracker safety (D-01 isSystemMove, D-03 two-scan timing)
- `.planning/phases/19-action-processing-core/19-CONTEXT.md` — Processor API (D-01 class DI, D-02 processMessage, D-16 failed move retry)

### Existing code to integrate with
- `src/index.ts` — Startup sequence, component lifecycle, config change handlers, timer management
- `src/action-folders/processor.ts` — `ActionFolderProcessor.processMessage(message, actionType)` — the processing API this phase calls
- `src/action-folders/folders.ts` — `ensureActionFolders()` — called before polling starts
- `src/action-folders/registry.ts` — `ACTION_REGISTRY` — maps action types to folder config keys for folder path resolution
- `src/monitor/index.ts` — Monitor class pattern (event-driven, `processing` flag, `start()`/`stop()`)
- `src/tracking/index.ts` — MoveTracker timer pattern (setInterval, `.unref()`, `stop()` cleanup)
- `src/imap/client.ts` — `status()` for mailbox message counts, `fetchNewMessages()` for UID-based fetch
- `src/config/repository.ts` — `getActionFolderConfig()`, `onActionFolderConfigChange()` callback

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ActionFolderProcessor` (processor.ts): Constructor-injected, `processMessage(message, actionType)` — this phase just needs to call it
- `ensureActionFolders()` (folders.ts): Already called in startup sequence at line 251 of index.ts — this phase adds polling after it
- `ACTION_REGISTRY` (registry.ts): Maps action types to `folderConfigKey` — resolve folder paths from config for STATUS checks
- `ImapClient.status(path)`: Returns mailbox status including message count — used for polling
- `ImapClient.fetchNewMessages(lastUid)`: UID-based fetch — but may need a `fetchAll()` variant for action folders (process ALL messages, not just new ones)

### Established Patterns
- Timer-based polling with `.unref()` (MoveTracker at `src/tracking/index.ts:71-96`)
- Component lifecycle: constructor with DI → `start()` → `stop()` with timer cleanup
- Config change handlers registered in `index.ts` after component creation
- `processing` boolean guard to prevent overlapping async work (Monitor pattern)
- Graceful degradation on failure: log error, continue running, retry on next cycle

### Integration Points
- `src/index.ts` — Wire action folder polling into startup after `ensureActionFolders()`, before `monitor.start()`
- `src/index.ts` — Add poll timer setup, shutdown cleanup, config change handling
- `src/action-folders/` — May need a new `poller.ts` or poll logic in `index.ts` directly
- `src/imap/client.ts` — May need a method to fetch ALL messages from a folder (not just UID > lastUid)

</code_context>

<specifics>
## Specific Ideas

- The startup pre-scan and regular poll share the same code — a function that takes a list of action folders, STATUS-checks each, fetches messages from non-empty ones, and processes them. Called once on startup (blocking) and then on each poll tick (timer).
- Action folder paths are resolved from config using `ACTION_REGISTRY[actionType].folderConfigKey` → `config.actionFolders.folders[key].name` → `config.actionFolders.prefix + '/' + name`. This resolution already exists in `ensureActionFolders()` — reuse it.
- The always-empty invariant (FOLD-02) is mostly free — `processMessage()` moves messages out. The STATUS re-check is belt-and-suspenders.
- Priority (MON-02) is structural, not a flag. Action folders process first because the pre-scan runs before Monitor starts, and the poll timer operates independently.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-monitoring-startup-recovery*
*Context gathered: 2026-04-20*
