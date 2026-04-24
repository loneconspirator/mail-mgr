# Phase 33: Action Folder Safety Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 33-action-folder-safety-hardening
**Areas discussed:** Sentinel-aware skip threshold, Circuit breaker limits & response, Diagnostic logging scope

---

## Sentinel-aware skip threshold

### Q1: How should the poller determine "nothing to process"?

| Option | Description | Selected |
|--------|-------------|----------|
| Simple count check | If status.messages === 1, assume sentinel and skip fetch | ✓ |
| Count check with sentinel count from DB | Query SentinelStore for expected count per folder | |
| You decide | Claude picks best approach | |

**User's choice:** Simple count check
**Notes:** Fast, zero IMAP overhead. Preferred over DB lookup.

### Q2: What should happen if status.messages === 0 (sentinel missing)?

| Option | Description | Selected |
|--------|-------------|----------|
| Process anyway | fetchAllMessages as normal, returns empty | |
| Log warning and skip | Note missing sentinel, don't fetch | |
| You decide | Claude picks best approach | |

**User's choice:** Let existing sentinel scanner/auto-healer handle it
**Notes:** User pointed to the v0.7 two-tier scan and auto-healing process. Skip fetch, let that system do its job.

### Q3: Should the skip log at debug or info level?

| Option | Description | Selected |
|--------|-------------|----------|
| Debug | Silent in normal operation, fires every 15s per folder | |
| Info on first skip then debug | Log once at info, then quiet | |
| You decide | Claude picks best approach | ✓ |

**User's choice:** Claude's discretion
**Notes:** None

---

## Circuit breaker limits & response

### Q1: What should the rule creation cap be per scan cycle?

| Option | Description | Selected |
|--------|-------------|----------|
| 5 rules per cycle | As roadmap suggests | |
| 3 rules per cycle | More conservative | |
| Configurable with default 5 | Expose threshold in config | |
| You decide | Claude picks best approach | |

**User's choice:** Drop the circuit breaker entirely
**Notes:** User said batch operations are perfectly legitimate (dragging 20 messages at once). Also not convinced the erroneous rules came from action folders — suspects INBOX processing is the actual source. Circuit breaker solves the wrong problem.

### Q2: Should we fix the two bugs from the incident?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes fix both | Fix pre-move logging and missing early return | ✓ |
| Fix bug 2 only | Early return after duplicate detection | |
| No keep scope tight | Separate phase for bug fixes | |

**User's choice:** Yes, fix both
**Notes:** These are the actual mechanism that caused the flood. Without fixing them the flood can recur from any source.

---

## Diagnostic logging scope

### Q1: What should be logged for each action folder message?

| Option | Description | Selected |
|--------|-------------|----------|
| Sender + subject | As roadmap says | |
| Sender + subject + message-id + UID | Full diagnostic payload | ✓ |
| You decide | Claude picks best approach | |

**User's choice:** Full diagnostic payload (sender, subject, message-id, UID)
**Notes:** Maximum breadcrumbs for tracing phantom messages.

### Q2: Where should diagnostic logging go?

| Option | Description | Selected |
|--------|-------------|----------|
| Pino logger only | Structured JSON, doesn't pollute activity table | |
| Both pino and activity log | Ops debugging + user-visible audit | |
| You decide | Claude picks best approach | ✓ |

**User's choice:** Claude's discretion
**Notes:** None

---

## Claude's Discretion

- Sentinel-aware skip log level (debug vs info vs hybrid)
- Diagnostic logging destination (pino only vs pino + activity log)

## Deferred Ideas

None — discussion stayed within phase scope
