# Phase 33: Action Folder Safety Hardening - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Prevent the action-folder processor from generating activity log floods and eliminate wasteful sentinel-only IMAP polling. Fix the two root-cause bugs identified in the 2026-04-23 incident. Add diagnostic logging to trace phantom messages to their source.

</domain>

<decisions>
## Implementation Decisions

### Sentinel-Aware Skip
- **D-01:** Poller uses simple count check — if `status.messages === 1`, assume it's the sentinel and skip `fetchAllMessages`. No DB query, no sentinel store lookup.
- **D-02:** If `status.messages === 0` (sentinel missing), skip fetch entirely. The existing sentinel scanner/auto-healer (v0.7 Phase 30-31) handles re-planting on its own cycle.
- **D-03:** If `status.messages > 1`, proceed with normal `fetchAllMessages` and processing.

### Circuit Breaker — DROPPED
- **D-04:** No circuit breaker. Batch operations (dragging 20 messages into Block/VIP at once) are a legitimate use case that a hard cap would break. The erroneous rule floods likely originated from INBOX processing, not action folder messages. The sentinel-aware skip (D-01) eliminates the stuck-message reprocessing loop, and diagnostic logging will identify the actual source.

### Processor Bug Fixes
- **D-05:** Fix activity logging order — move `logActivity` call to AFTER `moveMessage` succeeds, not before. Currently `buildActionResult` hardcodes `success: true` and logs before the move, so failed moves show as successful.
- **D-06:** Add early return after duplicate detection path. Currently `processor.ts:66-70` logs the duplicate but falls through to `moveMessage`. With D-05 (log after move), this becomes: detect duplicate → move message → log activity → return. No fall-through to the create path.

### Diagnostic Logging
- **D-07:** Log sender, subject, message-id, and UID for every message processed from action folders. Full diagnostic payload for tracing phantom messages.

### Claude's Discretion
- Sentinel-aware skip log level (debug vs info vs hybrid) — D-01 skip fires every 15s per folder, so noise is a factor
- Diagnostic logging destination (pino only vs pino + activity log) — balance between ops debugging and user-visible audit trail

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Incident Context
- `.planning/debug/false-trash-activities.md` — Root cause analysis of the 2026-04-23 activity flood incident. Documents the two bugs (pre-move logging, missing early return) and the stuck-message reprocessing loop.
- `docs/incidents/2026-04-23-action-folder-activity-flood.md` — Incident report

### Action Folder Implementation
- `src/action-folders/poller.ts` — ActionFolderPoller with scanAll(), FOLD-02 retry logic, sentinel count tracking
- `src/action-folders/processor.ts` — ActionFolderProcessor with processMessage(), the duplicate detection path (lines 66-70), and buildActionResult (hardcoded success: true)
- `src/action-folders/registry.ts` — ACTION_REGISTRY defining vip/block/undoVip/unblock action types

### Sentinel System
- `src/sentinel/detect.ts` — isSentinel() and isSentinelRaw() functions
- `src/sentinel/index.ts` — Barrel exports for sentinel detection

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isSentinel()` — Already guards `processMessage()` as first check (processor.ts:35). Poller can use the same function if needed, but simple count check (D-01) avoids fetching messages entirely.
- `reviewMessageToEmailMessage()` — Converts raw IMAP messages to EmailMessage type, used in poller's processing loop.
- `ActivityLog.logActivity()` — Existing logging interface for activity table entries.

### Established Patterns
- Pino structured logging with child loggers per component (logger.info/debug/warn/error with context objects)
- `status.messages` from `client.status(path)` returns total message count — already called before `fetchAllMessages` in the poller loop
- Sentinel count tracked per-folder in current poller code (sentinelCount variable at line 43)

### Integration Points
- `ActionFolderPoller.scanAll()` — Main loop where sentinel-aware skip goes (before `fetchAllMessages` call)
- `ActionFolderProcessor.processMessage()` — Where bug fixes (D-05, D-06) and diagnostic logging (D-07) apply
- `buildActionResult()` — Private method with hardcoded `success: true` that needs to respect actual move outcome

</code_context>

<specifics>
## Specific Ideas

- User suspects erroneous Block/VIP rule floods originated from INBOX processing, not action folders. Diagnostic logging should help confirm or deny this theory.
- The incident debug file has extensive elimination analysis — downstream agents should read it to understand what was already ruled out.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 33-action-folder-safety-hardening*
*Context gathered: 2026-04-24*
