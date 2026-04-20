---
phase: 20
slug: monitoring-startup-recovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose test/unit/action-folders/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose test/unit/action-folders/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | MON-01 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-02 | 01 | 1 | MON-02 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-03 | 01 | 1 | FOLD-03 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-04 | 01 | 1 | FOLD-02 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/action-folders/poller.test.ts` — stubs for MON-01, MON-02, FOLD-02, FOLD-03
- [ ] Test fixtures for mock IMAP status responses and action folder messages

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Action folders monitored alongside INBOX in real IMAP | MON-01 | Requires live IMAP connection | Start app, move message to action folder, verify processing within poll interval |
| Startup pre-scan before Monitor.start() | FOLD-03 | Startup sequence timing | Stop app, place message in action folder, start app, verify message processed before INBOX scan |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
