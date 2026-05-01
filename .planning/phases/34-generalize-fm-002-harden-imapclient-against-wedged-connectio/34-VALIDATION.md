---
phase: 34
slug: generalize-fm-002-harden-imapclient-against-wedged-connectio
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run test/unit/imap/client.test.ts` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~10s (client.test.ts), ~60s (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run test/unit/imap/client.test.ts`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

*(Populated by planner — one row per task. See RESEARCH.md "Validation Architecture" for the test matrix shape.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/imap/client.test.ts` — extend FM-002 describe block with `it.each` matrix covering every public op × `usable=false` and × never-resolving inner promise
- [ ] No new framework install — vitest already present

---

## Manual-Only Verifications

*All FM-002 generalization behaviors are verifiable via fault-injection unit tests against the `ImapFlowLike` mock seam — same pattern as the existing FM-002 tests at test/unit/imap/client.test.ts:928-1008.*

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production wedge recovery | (R5 idleTimeout tune) | Real NAT-timeout reproduction is environmental | Deploy candidate, leave running >24h, observe `/api/folders` and IDLE recovery via logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
