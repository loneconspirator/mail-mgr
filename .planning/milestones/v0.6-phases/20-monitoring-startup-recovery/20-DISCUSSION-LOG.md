# Phase 20: Monitoring & Startup Recovery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 20-monitoring-startup-recovery
**Areas discussed:** Poll mechanism, Priority processing, Startup pre-scan, Always-empty invariant
**Mode:** `--auto` (all decisions auto-selected)

---

## Poll Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Separate poll timer | setInterval in index.ts, independent from Monitor's IDLE-based events | ✓ |
| Extend Monitor class | Add action folder polling into existing Monitor.processNewMessages() | |
| Shared poll loop | Single timer that polls both INBOX and action folders | |

**User's choice:** [auto] Separate poll timer (recommended default)
**Notes:** Action folder polling (periodic STATUS checks on multiple folders) is fundamentally different from Monitor's IMAP IDLE event-driven pattern. Mixing them would couple two unrelated concerns.

---

## Priority Processing

| Option | Description | Selected |
|--------|-------------|----------|
| Process action folders first | Structural priority — pre-scan before Monitor.start(), separate timer for ongoing | ✓ |
| Priority flag in shared queue | Single processing queue with priority ordering | |
| Interleaved processing | Round-robin between action folders and INBOX | |

**User's choice:** [auto] Process action folders first in each cycle (recommended default)
**Notes:** Priority is achieved structurally (startup order + separate timer) rather than through a queue or flag mechanism. Simpler and naturally satisfies MON-02.

---

## Startup Pre-scan

| Option | Description | Selected |
|--------|-------------|----------|
| After IMAP connect, before Monitor.start() | One-shot scan using same logic as regular poll | ✓ |
| During Monitor.start() | Embedded in Monitor's initial scan | |
| Lazy on first poll tick | Skip explicit pre-scan, let first timer tick handle it | |

**User's choice:** [auto] After IMAP connect, before Monitor.start() (recommended default)
**Notes:** Explicit pre-scan guarantees FOLD-03 — no race window where INBOX arrivals could be processed before pending action folder messages. Shared code with regular poll avoids duplication.

---

## Always-Empty Invariant

| Option | Description | Selected |
|--------|-------------|----------|
| Process-then-verify | Process all messages, STATUS re-check, one retry if non-zero | ✓ |
| Process only | Trust that processMessage() moves all messages, no verification | |
| Retry loop | Keep processing until empty, with max iteration cap | |

**User's choice:** [auto] Process-then-verify loop per folder (recommended default)
**Notes:** Single retry after STATUS re-check balances safety and simplicity. processMessage() already moves messages out, so the re-check is a safety net for messages arriving during processing.

---

## Claude's Discretion

- Internal function naming for shared poll/scan logic
- Whether poll function lives in a separate module or inline in index.ts
- STATUS check API usage patterns
- Log messages and levels for poll events
- Async overlap guard implementation

## Deferred Ideas

None — discussion stayed within phase scope
