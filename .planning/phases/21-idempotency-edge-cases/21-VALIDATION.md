---
phase: 21
slug: idempotency-edge-cases
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/action-folders/processor.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/action-folders/processor.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | PROC-07 | — | N/A | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 21-01-02 | 01 | 1 | PROC-08 | — | N/A | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 21-01-03 | 01 | 1 | PROC-07 | — | N/A | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Processor test suite already exists at `test/unit/action-folders/processor.test.ts`.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
