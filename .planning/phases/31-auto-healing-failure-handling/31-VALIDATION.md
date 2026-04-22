---
phase: 31
slug: auto-healing-failure-handling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 31-01-01 | 01 | 1 | HEAL-01 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-02 | 01 | 1 | HEAL-02 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-03 | 01 | 1 | HEAL-03 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-04 | 01 | 1 | HEAL-04 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-05 | 01 | 1 | FAIL-01 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-06 | 01 | 1 | FAIL-02 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |
| 31-01-07 | 01 | 1 | FAIL-03 | — | N/A | unit | `npx vitest run tests/sentinel/healer.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/sentinel/healer.test.ts` — stubs for HEAL-01, HEAL-02, HEAL-03, HEAL-04, FAIL-01, FAIL-02, FAIL-03

*Existing test infrastructure (vitest, fixtures) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| INBOX notification email renders correctly in mail client | FAIL-02 | Visual verification in mail client | 1. Trigger folder loss scenario 2. Check INBOX for notification 3. Verify subject/body are readable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
