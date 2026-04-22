# Phase 29: Pipeline Guards - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 29-pipeline-guards
**Areas discussed:** Detection approach, Guard placement, Header access
**Mode:** --auto (all decisions auto-selected)

---

## Detection Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Shared `isSentinel()` utility | Single function in `src/sentinel/` checking `X-Mail-Mgr-Sentinel` header presence, reused by all 5 processors | [auto] |
| Per-processor inline check | Each processor checks the header directly without a shared function | |
| IMAP SEARCH pre-filter | Filter sentinels at the IMAP fetch level before processors see them | |

**User's choice:** [auto] Shared `isSentinel()` utility (recommended default)
**Notes:** Single function, already-established module location, reusable across all 5 processors.

---

## Guard Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Per-message early-exit | Check immediately after fetching/receiving message, `if (isSentinel(msg)) continue;` at top of loop | [auto] |
| Pre-filter before loop | Filter sentinel messages out of the message array before the processing loop | |
| Fetch-level exclusion | Modify IMAP SEARCH queries to exclude sentinels | |

**User's choice:** [auto] Per-message early-exit (recommended default)
**Notes:** Simplest approach, minimal code changes, each processor gets one guard line.

---

## Header Access

| Option | Description | Selected |
|--------|-------------|----------|
| Use existing message headers | Detection function works with headers each processor already has available | [auto] |
| Dedicated header fetch | Add a separate IMAP FETCH for the sentinel header before processing | |

**User's choice:** [auto] Use existing message headers (recommended default)
**Notes:** ImapFlow fetch already provides headers. Minimal changes expected.

---

## Claude's Discretion

- Exact `isSentinel()` function signature
- `SENTINEL_HEADER` constant export location
- Test file organization
- Detection utility file placement within `src/sentinel/`

## Deferred Ideas

None -- discussion stayed within phase scope
