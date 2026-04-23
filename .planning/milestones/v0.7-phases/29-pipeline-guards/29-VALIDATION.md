---
phase: 29
slug: pipeline-guards
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 29 — Validation Strategy

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
| 29-01-01 | 01 | 1 | — | — | isSentinel detection utility | unit | `npx vitest run test/unit/sentinel/detect.test.ts` | ❌ W0 | ⬜ pending |
| 29-01-02 | 01 | 1 | — | — | IMAP fetch includes sentinel header | unit | `npx vitest run test/unit/imap/client.test.ts` | ✅ | ⬜ pending |
| 29-02-01 | 02 | 2 | GUARD-01 | — | Action folder processor ignores sentinels | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 29-02-02 | 02 | 2 | GUARD-02 | — | Monitor skips sentinel evaluation | unit | `npx vitest run test/unit/monitor/monitor.test.ts` | ✅ | ⬜ pending |
| 29-02-03 | 02 | 2 | GUARD-03 | — | Sweeper leaves sentinel in place | unit | `npx vitest run test/unit/sweep/sweep.test.ts` | ✅ | ⬜ pending |
| 29-02-04 | 02 | 2 | GUARD-04 | — | Batch engine excludes sentinels | unit | `npx vitest run test/unit/batch/engine.test.ts` | ✅ | ⬜ pending |
| 29-02-05 | 02 | 2 | GUARD-05 | — | Move tracker excludes sentinels from snapshots | unit | `npx vitest run test/unit/tracking/tracker.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/sentinel/detect.test.ts` — stubs for isSentinel detection utility tests

*Existing test infrastructure covers all other phase requirements.*

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
