---
phase: 33
slug: action-folder-safety-hardening
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-24
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
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
| 33-01-01 | 01 | 1 | — | — | Activity logged after move, not before | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 33-01-02 | 01 | 1 | — | — | Duplicate path returns early (no double-process) | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 33-01-03 | 01 | 1 | — | — | Diagnostic fields in log output | unit | `npx vitest run test/unit/action-folders/processor.test.ts` | ✅ | ⬜ pending |
| 33-02-01 | 02 | 1 | — | — | Sentinel-only folders skip fetch | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ✅ | ⬜ pending |
| 33-02-02 | 02 | 1 | — | — | Zero-message folders skip fetch | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ✅ | ⬜ pending |
| 33-02-03 | 02 | 1 | — | — | Multi-message folders proceed normally | unit | `npx vitest run test/unit/action-folders/poller.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-24
