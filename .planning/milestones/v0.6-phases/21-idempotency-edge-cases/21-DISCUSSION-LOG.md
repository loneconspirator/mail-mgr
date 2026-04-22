# Phase 21: Idempotency & Edge Cases - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 21-idempotency-edge-cases
**Areas discussed:** Idempotency strategy, Undo-no-match behavior, Crash recovery approach
**Mode:** --auto (all decisions auto-selected)

---

## Idempotency Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Check-before-create using findSenderRule | Reuse existing findSenderRule with same action type to detect duplicates before addRule() | ✓ |
| UID tracking / message deduplication | Track processed message UIDs to skip re-processing entirely | |
| Rule creation with upsert semantics | Replace addRule with upsert that handles duplicates internally | |

**User's choice:** [auto] Check-before-create using findSenderRule (recommended default)
**Notes:** Most surgical approach — adds ~5 lines to existing create branch. Leverages existing findSenderRule utility without new infrastructure.

---

## Undo-No-Match Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Move message silently with info log | Treat as normal success — user's intent (message in INBOX) is fulfilled | ✓ |
| Return error result | Treat missing rule as a processing error | |
| Move message with warning | Move but flag as unexpected condition | |

**User's choice:** [auto] Move message silently with info log (recommended default)
**Notes:** PROC-08 explicitly requires the message still moves to destination. Info-level log provides visibility without noise.

---

## Crash Recovery Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Implicit via idempotency + startup pre-scan | No new code — idempotency makes re-processing safe, pre-scan ensures retry | ✓ |
| Explicit transaction log | Write processing intent before acting, check on restart | |
| Message flag-based tracking | Use IMAP flags to mark in-progress messages | |

**User's choice:** [auto] Implicit via idempotency + startup pre-scan (recommended default)
**Notes:** Phase 20's startup pre-scan already re-processes pending messages. With idempotency in place, re-processing is safe. Zero new infrastructure needed.

---

## Claude's Discretion

- Implementation details of idempotency check (inline vs private method)
- Test fixture structure for duplicate/crash-recovery scenarios
- Exact log message wording
- Whether to add skippedDuplicate field to ProcessResult

## Deferred Ideas

None — discussion stayed within phase scope
