# Phase 29: Pipeline Guards - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Every message processor in the system ignores sentinel messages. Five processors need guards: action folder processor, monitor rule engine, review sweeper, batch filing engine, and move tracker. This phase adds sentinel detection and early-exit logic to each processor. No new sentinel capabilities — just protection of existing pipelines.

</domain>

<decisions>
## Implementation Decisions

### Detection Approach
- **D-01:** Shared `isSentinel()` utility function in `src/sentinel/` that checks for the presence of the `X-Mail-Mgr-Sentinel` header. Single function reused by all 5 processors.
- **D-02:** Detection is header-based only — checking for header existence, not validating the Message-ID value. Simple and fast.

### Guard Placement
- **D-03:** Early-exit at per-message level in each processor's message loop. Check immediately after receiving/fetching the message, before any processing logic runs.
- **D-04:** Pattern: `if (isSentinel(msg)) { logger.debug(...); continue; }` — skip with debug log, no errors, no special handling.

### Header Access
- **D-05:** Each processor accesses message headers through its existing message type (EmailMessage, ReviewMessage, etc.). The `isSentinel()` function accepts the headers object that each processor already has available.
- **D-06:** If any FETCH request doesn't already include headers sufficient for detection, extend the fetch to include the `X-Mail-Mgr-Sentinel` header. Minimal fetch changes — most processors already fetch full headers.

### Per-Processor Specifics
- **D-07:** Action folder processor (`src/action-folders/processor.ts`) — guard in `processMessage()` before sender extraction
- **D-08:** Monitor rule engine (`src/monitor/index.ts`) — guard in `processMessage()` before `evaluateRules()`
- **D-09:** Review sweeper (`src/sweep/index.ts`) — guard in the sweep message loop before eligibility check
- **D-10:** Batch filing engine (`src/batch/index.ts`) — guard in both dry-run and execute message loops
- **D-11:** Move tracker (`src/tracking/index.ts`) — guard in `fetchFolderState()` to exclude sentinels from UID snapshots, preventing false move detection

### Claude's Discretion
- Exact function signature for `isSentinel()` (whether it takes full message, headers object, or envelope)
- Whether to add a `SENTINEL_HEADER` constant export from sentinel module or inline the header name
- Test organization (one test file per processor guard vs. consolidated)
- Whether `isSentinel()` lives in `format.ts`, a new `detect.ts`, or `index.ts`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` -- GUARD-01 through GUARD-05 (pipeline guard requirements for each processor)

### Sentinel Foundation (Phase 26)
- `.planning/phases/26-sentinel-store-message-format/26-CONTEXT.md` -- D-04 defines `X-Mail-Mgr-Sentinel` header, D-10/D-11 define module structure
- `src/sentinel/format.ts` -- Sentinel message format builder, header name constant location

### Processors to Guard
- `src/action-folders/processor.ts` -- `processMessage()` method, GUARD-01
- `src/monitor/index.ts` -- `processMessage()` method with `evaluateRules()`, GUARD-02
- `src/sweep/index.ts` -- `processSweepMessage()` and sweep loop, GUARD-03
- `src/batch/index.ts` -- Dry-run and execute message loops, GUARD-04
- `src/tracking/index.ts` -- `fetchFolderState()` and `scanFolder()` UID tracking, GUARD-05

### Message Types
- `src/shared/types.ts` -- EmailMessage, ReviewMessage types and their header access patterns
- `src/imap/index.ts` -- ImapFetchResult, parseMessage, header availability in fetch results

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/sentinel/format.ts` -- Already defines the sentinel header name (`X-Mail-Mgr-Sentinel`); detection utility can reference or re-export this constant
- `src/sentinel/index.ts` -- Barrel export to extend with the new detection utility

### Established Patterns
- Each processor has a clear per-message processing loop with early-exit patterns (e.g., `if (this.processing) return;` in monitor)
- Processors log at debug level for skipped messages (monitor logs "No rule matched, leaving in inbox")
- All processors receive messages with envelope/header data from ImapFlow fetch results

### Integration Points
- `src/sentinel/index.ts` -- Add `isSentinel` export
- Each of the 5 processor files gets a single import and a single guard line
- No changes to IMAP fetch queries expected (headers already fetched) -- verify during implementation

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 29-pipeline-guards*
*Context gathered: 2026-04-21*
