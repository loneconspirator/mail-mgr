---
phase: 26
slug: sentinel-store-message-format
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose test/unit/sentinel` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose test/unit/sentinel`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | SENT-02 | — | N/A | unit | `npx vitest run test/unit/sentinel/format.test.ts` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | SENT-05 | — | INBOX rejection (case-insensitive) | unit | `npx vitest run test/unit/sentinel/format.test.ts` | ❌ W0 | ⬜ pending |
| 26-02-01 | 02 | 1 | SENT-03 | — | N/A | unit | `npx vitest run test/unit/sentinel/store.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/sentinel/format.test.ts` — stubs for SENT-02, SENT-05
- [ ] `test/unit/sentinel/store.test.ts` — stubs for SENT-03

*Existing vitest infrastructure covers all phase requirements. No framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
