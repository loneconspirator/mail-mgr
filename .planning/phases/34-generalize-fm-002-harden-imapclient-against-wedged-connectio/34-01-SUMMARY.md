---
phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio
plan: 01
subsystem: infra
tags: [imap, imapflow, fm-002, timeouts, vitest, typescript, fault-injection]

# Dependency graph
requires:
  - phase: 79d0315
    provides: existing FM-002 chokepoint pattern in cycleIdle and listFolders (withTimeout + flow.usable + handleClose) — extracted into the new guardedOp wrapper
provides:
  - Private async guardedOp<T>(label, op, timeoutMs) chokepoint on ImapClient
  - CONNECT_TIMEOUT_MS / LOCK_TIMEOUT_MS / WRITE_TIMEOUT_MS / BULK_FETCH_TIMEOUT_MS clustered constants
  - cleanupFlow now drains in-flight ops by calling flow.close() before nulling
  - Bounded flow.connect() and initial flow.mailboxOpen('INBOX') under CONNECT_TIMEOUT_MS
  - ImapFlowLike.close(): void method on the type; createMockFlow now provides close: vi.fn()
  - 4 new unit tests (cleanupFlow.close, cleanupFlow swallow-throw, connect-hang, mailboxOpen-hang) plus 2 mock-shape pins
affects: [34-02, 34-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "guardedOp chokepoint extracted from inline FM-002 pattern (RESEARCH.md Standard Stack > guardedOp shape)"
    - "imapflow.close() as the in-flight cancellation seam (lib/imap-flow.js:1673-1759 — requestTagMap + locks rejected via setImmediate)"
    - "Clustered op-class timeout buckets (CONNECT/LOCK/WRITE/BULK_FETCH) instead of per-op constants"

key-files:
  created: []
  modified:
    - src/imap/client.ts
    - test/unit/imap/client.test.ts

key-decisions:
  - "Captured flow into a local `const flow` inside guardedOp before passing to op — protects the closure if a concurrent handleClose nulls this.flow between the usable check and the inner imapflow call"
  - "Used CONNECT_TIMEOUT_MS for both flow.connect() and the initial flow.mailboxOpen('INBOX') — research recommended a connect-phase budget shared between the TLS handshake/LOGIN and the initial SELECT INBOX"
  - "cleanupFlow swallows any throw from flow.close() — best-effort drain; we still must remove listeners and null the reference even if close() misbehaves"
  - "Defined LOCK_TIMEOUT_MS / WRITE_TIMEOUT_MS / BULK_FETCH_TIMEOUT_MS in this plan even though they are unused until Plan 02 — keeps the foundation atomic and lets Plan 02 import from a frozen surface"

patterns-established:
  - "Chokepoint wrapper pattern: every public IMAP op should funnel through guardedOp(label, op, timeoutMs) so wedge detection logic is single-sourced"
  - "Cancellation via library API: imapflow.close() is the documented in-flight rejection seam — do not roll AbortController plumbing"

requirements-completed: [R2, R3, R4]

# Metrics
duration: 7min
completed: 2026-05-01
---

# Phase 34 Plan 01: Foundation for FM-002 generalization Summary

**guardedOp wrapper, four clustered timeout constants, cleanupFlow.close() drain, and bounded flow.connect/mailboxOpen — the mechanical foundation Plan 02 wires through every public ImapClient method.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-01T22:33:16Z
- **Completed:** 2026-05-01T22:39:48Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 2 (src/imap/client.ts, test/unit/imap/client.test.ts)

## Accomplishments

- **guardedOp chokepoint** added as a private async method on ImapClient — refuses to issue against a missing/unusable flow (force-closes), bounds the inner op with withTimeout, and triggers handleClose only on timeout-shaped errors so non-wedge errors still propagate cleanly.
- **cleanupFlow now invokes flow.close()** before removing listeners. This is the single line that makes imapflow's requestTagMap and pending-lock rejection logic actually fire — old wedged callers will now receive a NoConnection rejection instead of staying stuck forever (T-34-02 / T-34-03 mitigation, per the threat model).
- **flow.connect() and the initial flow.mailboxOpen('INBOX') are now bounded by CONNECT_TIMEOUT_MS (30s)** — a wedge during reconnect (TLS handshake stall, hung SELECT INBOX) routes through the existing setState('error') + emit + scheduleReconnect path instead of leaving the client stuck in 'connecting' forever (R3).
- **ImapFlowLike.close(): void** added to the type and **createMockFlow now provides close: vi.fn()** — the type system now requires every flow consumer to supply close, eliminating the "we forgot to drain" foot-gun for future contributors.
- **6 commits** (3 RED test commits + 3 GREEN feat commits) keep the TDD loop legible in `git log`.

## Task Commits

Each TDD task split into RED + GREEN commits:

1. **Task 1 RED: failing tests for createMockFlow close()** — `b9d187a` (test)
2. **Task 1 GREEN: timeout constants + ImapFlowLike.close() + mock factory** — `cdc929b` (feat)
3. **Task 2 RED: failing tests for cleanupFlow.close()** — `6033fb0` (test)
4. **Task 2 GREEN: guardedOp wrapper + cleanupFlow.close() drain** — `5b68d8e` (feat)
5. **Task 3 RED: failing tests for connect/mailboxOpen timeout** — `5c1e8a7` (test)
6. **Task 3 GREEN: bound flow.connect and flow.mailboxOpen with withTimeout** — `ac2116c` (feat)

## Files Created/Modified

- `src/imap/client.ts` — added `close(): void` to ImapFlowLike; added 4 clustered timeout constants; added `private async guardedOp<T>` chokepoint; cleanupFlow now calls `this.flow.close()` first, swallowing any throw; flow.connect() and initial flow.mailboxOpen('INBOX') now bounded by CONNECT_TIMEOUT_MS via withTimeout.
- `test/unit/imap/client.test.ts` — added `close: vi.fn()` to createMockFlow; added 2 mock-factory pin tests; added 2 cleanupFlow.close() behavior tests inside the FM-002 describe block; added 2 connect-hang / mailboxOpen-hang tests inside the connect describe block. Total +6 tests (61 → 67).

## Verification

- `pnpm tsc --noEmit` exits 0
- `npx vitest run test/unit/imap/client.test.ts` — 67/67 green (61 prior + 6 new)
- `npx vitest run test/unit/imap/` — 100/100 green (full IMAP test directory)
- `grep -n 'private async guardedOp' src/imap/client.ts` — 1 match (line 212)
- `grep -nE '^const (CONNECT|LOCK|WRITE|BULK_FETCH)_TIMEOUT_MS' src/imap/client.ts` — 4 matches with values 30_000 / 15_000 / 30_000 / 120_000 respectively
- `grep -nE 'withTimeout\(this\.flow\.connect\(\), CONNECT_TIMEOUT_MS' src/imap/client.ts` — 1 match (line 147)
- `grep -nE "withTimeout\(this\.flow\.mailboxOpen\('INBOX'\), CONNECT_TIMEOUT_MS" src/imap/client.ts` — 1 match (line 148)
- `grep -n 'this.flow.close()' src/imap/client.ts` — 1 match inside cleanupFlow (line 684)
- `grep -n 'close: vi.fn()' test/unit/imap/client.test.ts` — 1 match in createMockFlow (line 19)

## Decisions Made

- **Closure capture of `this.flow` in guardedOp.** Stashed into a local `const flow = this.flow` before passing into the user-supplied `op` callback. If a concurrent handleClose nulls this.flow between the usable check and the inner call, the inner call still has a valid reference — the rejection will surface naturally via the timeout or via imapflow's own close-rejection path.
- **Shared CONNECT_TIMEOUT_MS for the initial SELECT INBOX.** RESEARCH.md recommended bounding both calls in the connect path with the same budget. Considered using LIST_TIMEOUT_MS for SELECT but kept the connect-phase budget unified — both stalls are "the connect path is wedged" and recovery is the same.
- **Defined LOCK/WRITE/BULK_FETCH constants now even though unused.** Plan 02 wires them through every public op. Defining them in this plan (Wave 1) gives Plan 02 (Wave 2) a frozen surface to import from; otherwise both plans would touch the same constant block and serialize.
- **Tests for guardedOp behavior live inside the cleanupFlow assertions.** Per the plan, guardedOp's correctness in this plan is observable through the cleanupFlow path it triggers (handleClose on usable=false, handleClose on timeout). Plan 02's matrix-test wave will add direct guardedOp-shape assertions when every public op consumes it.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed with their TDD commits and acceptance criteria.

## Issues Encountered

- **Worktree branch base mismatch.** This worktree was branched from `e38a7a59` (main HEAD) instead of the expected `cb8edfd4` (feature-branch HEAD). Resolved per the worktree_branch_check protocol via `git rebase --onto cb8edfd4...` which re-pointed HEAD to the correct base. The worktree branch had no work of its own to preserve, so the rebase was a clean re-base. No code lost.
- **Pre-existing frontend test failures (out of scope).** `pnpm test` (full suite) shows 7 failures in `test/unit/web/frontend.test.ts` because `dist/app.js` and `dist/styles.css` are 404'd — the suite expects `pnpm build:frontend` to have run first. Verified pre-existing on the base commit via a `git checkout cb8edfd4 -- ...` sanity run. Logged to `deferred-items.md` per scope-boundary rules; not addressed in this plan.

## Self-Check

Files claimed in SUMMARY:
- `src/imap/client.ts` — FOUND
- `test/unit/imap/client.test.ts` — FOUND
- `.planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-01-SUMMARY.md` — FOUND (this file)

Commits claimed:
- `b9d187a` — FOUND
- `cdc929b` — FOUND
- `6033fb0` — FOUND
- `5b68d8e` — FOUND
- `5c1e8a7` — FOUND
- `ac2116c` — FOUND

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 02 (Wave 2) is unblocked.** Plan 02 will refactor every public op on ImapClient to consume guardedOp with the appropriate clustered timeout constant, plus add the N×2 fault-injection matrix test. Both prerequisites land in this plan.
- **T-34-02 mitigation (cleanupFlow.close()) is in place** — Plan 02's per-op guarding will be observable in tests because in-flight ops in an abandoned imapflow now actually reject.
- **No release on Plan 01 alone** per the threat model's `block_on: high` clause — Plan 02 must follow before this phase can ship. That's expected and handled by the wave plan.

---
*Phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio*
*Plan: 01*
*Completed: 2026-05-01*
