---
phase: 34
slug: generalize-fm-002-harden-imapclient-against-wedged-connectio
status: in-progress
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
updated: 2026-05-01
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/imap/client.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10s (client.test.ts), ~60s (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/imap/client.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

*One row per task across plans 34-01 (foundation), 34-02 (per-op rollout + matrix), 34-03 (specs + validator). See RESEARCH.md "Validation Architecture" for the test matrix shape.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 34-01-T1 | 34-01 | 1 | R2/R4 (foundation: constants + ImapFlowLike.close + mock factory) | T-34-03 | New timeout constants exist; ImapFlowLike declares close(): void; mock factory supplies close: vi.fn() so the new cleanupFlow contract type-checks | unit | `npx vitest run test/unit/imap/client.test.ts && npx tsc --noEmit` | ✅ existing file extended | ✅ green |
| 34-01-T2 | 34-01 | 1 | R2/R4 (guardedOp wrapper + cleanupFlow.close) | T-34-02, T-34-03 | guardedOp routes every public op through usable-check + withTimeout + handleClose-on-wedge; cleanupFlow calls flow.close() before nulling so imapflow drains requestTagMap and pending locks | unit | `npx vitest run test/unit/imap/client.test.ts -t "cleanupFlow"` and `-t "FM-002"` | ✅ existing file extended | ✅ green |
| 34-01-T3 | 34-01 | 1 | R3 (bound flow.connect + initial mailboxOpen) | T-34-01 | flow.connect() and the initial flow.mailboxOpen('INBOX') are bounded by CONNECT_TIMEOUT_MS; a wedge during reconnect transitions to error and reschedules instead of hanging in 'connecting' | unit | `npx vitest run test/unit/imap/client.test.ts -t "connect"` | ✅ existing file extended | ✅ green |
| 34-02-T1 | 34-02 | 2 | R2 (apply guardedOp to non-lock public ops + lock-acquisition guards) | T-34-01, T-34-02 | listMailboxes / listFolders / status / appendMessage / getSpecialUseFolder / fetchMessagesRaw / createMailbox / renameFolder all route through guardedOp; withMailboxLock and withMailboxSwitch guard both the getMailboxLock acquisition (LOCK_TIMEOUT_MS) and the inner fn (caller-provided timeout) | unit | `npx vitest run test/unit/imap/client.test.ts && npx tsc --noEmit` | ✅ existing file extended | ⬜ pending |
| 34-02-T2 | 34-02 | 2 | R2/R5 (inner-work timeouts + idleTimeout default 90s + fixture migration) | T-34-01, T-34-02 | moveMessage/fetchNewMessages/fetchAllMessages/searchByHeader/deleteMessage pass the right inner-work timeout (WRITE_TIMEOUT_MS / BULK_FETCH_TIMEOUT_MS / LIST_TIMEOUT_MS); imapConfigSchema.idleTimeout default is 90_000; logout bounded; all 13 test fixtures pinned to 300_000 migrated to 90_000 (one documented exception in client.test.ts) | unit | `npx vitest run test/unit/config/config.test.ts && npm test` | ✅ existing files | ⬜ pending |
| 34-02-T3 | 34-02 | 2 | R6/R4 (FM-002 it.each matrix + R4 in-flight rejection test) | T-34-02, T-34-03 | FM-002 describe block contains it.each over every public op × usable=false and × never-resolving inner; ≥30 FM-002 cases total; R4 test verifies flow.close() was called and the in-flight fetchAllMessages rejected | unit | `npx vitest run test/unit/imap/client.test.ts -t "FM-002"` | ✅ existing file extended | ⬜ pending |
| 34-03-T1 | 34-03 | 2 | R1 (FM-002 spec generalization — title, Required behavior, Test approach) | T-34-01, T-34-05 | FM-002 spec body binds every public ImapClient op (not just listFolders); enumerates the full guarded surface; spec/code parity preserved; frontmatter id/integrations/modules/fault-injection-test untouched | docs validator (skill) | `npx tsx .claude/skills/validate-failure-mode/scripts/validate-failure-mode.ts FM-002 --skip-tests` | ✅ existing file rewritten | ✅ green |
| 34-03-T2 | 34-03 | 2 | R1 (MOD-0002 wedge-detection Notes paragraph generalization) | T-34-01, T-34-05 | MOD-0002 Notes paragraph names guardedOp, every covered op, the timeout buckets, and the cleanupFlow→flow.close() chain; "currently listFolders" framing removed; frontmatter unchanged | grep | `grep -nE 'guardedOp\|cleanupFlow\|BULK_FETCH_TIMEOUT_MS' specs/modules/mod-0002-imap-client.md` | ✅ existing file edited | ✅ green |
| 34-03-T3 | 34-03 | 2 | R1 (full validate-failure-mode FM-002 run + semantic checks + R4 chain assert) | T-34-05 | validate-failure-mode FM-002 returns PASS or WARN (no FAIL); IX-001 still cites FM-002 in Failure Handling; SKILL.md Step-3 semantic checks pass (named components exist; trigger fidelity holds); FM-002 vitest cases green | docs validator + unit | `npx tsx .claude/skills/validate-failure-mode/scripts/validate-failure-mode.ts FM-002 && npx vitest run test/unit/imap/client.test.ts -t "FM-002"` | ✅ skill script + test file exist | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/unit/imap/client.test.ts` exists — FM-002 describe block already lives at line 976 (Plan 34-01 extended it; Plan 34-02 adds the it.each matrix)
- [x] No new framework install — vitest 4.0.18 already present
- [x] `ImapFlowLike` type has `close(): void` (Plan 34-01 Task 1)
- [x] Mock factory provides `close: vi.fn()` (Plan 34-01 Task 1)

---

## Manual-Only Verifications

*All FM-002 generalization behaviors are verifiable via fault-injection unit tests against the `ImapFlowLike` mock seam — same pattern as the existing FM-002 tests at test/unit/imap/client.test.ts:976+.*

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production wedge recovery | R5 (idleTimeout tune) | Real NAT-timeout reproduction is environmental — cannot be deterministically simulated in CI | Deploy candidate, leave running >24h, observe `/api/folders` and IDLE recovery via logs; expect wedge detection within ~90s instead of ~300s |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has a vitest or validator command)
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s (client.test.ts is ~200ms; full suite ~60s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** in-progress — Plans 34-01 and 34-03 complete (verified PASS); Plan 34-02 pending (parallel wave, separate worktree).
