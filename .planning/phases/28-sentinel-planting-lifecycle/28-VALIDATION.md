---
phase: 28
slug: sentinel-planting-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/sentinel` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/sentinel`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 1 | SENT-01 | — | N/A | unit | `npx vitest run src/sentinel` | ❌ W0 | ⬜ pending |
| 28-01-02 | 01 | 1 | SENT-01 | — | N/A | unit | `npx vitest run src/sentinel` | ❌ W0 | ⬜ pending |
| 28-01-03 | 01 | 1 | SENT-07 | — | N/A | unit | `npx vitest run src/sentinel` | ❌ W0 | ⬜ pending |
| 28-01-04 | 01 | 1 | SENT-01 | — | INBOX exclusion enforced | unit | `npx vitest run src/sentinel` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/sentinel/__tests__/lifecycle.test.ts` — stubs for SENT-01, SENT-07
- [ ] Test fixtures for mock ImapClient, ConfigRepository, and SentinelStore

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Self-test round-trip on real IMAP server | SENT-06 | Requires live IMAP connection | Connect to test IMAP server, observe self-test pass in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
