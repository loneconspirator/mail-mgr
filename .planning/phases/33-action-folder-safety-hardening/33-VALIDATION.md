---
phase: 33
slug: action-folder-safety-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x + ts-jest |
| **Config file** | `jest.config.ts` |
| **Quick run command** | `npx jest --testPathPattern="action-folders" --bail` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="action-folders" --bail`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 33-01-01 | 01 | 1 | — | — | Sentinel-only folders skip fetch | unit | `npx jest --testPathPattern="poller" --bail` | ✅ | ⬜ pending |
| 33-01-02 | 01 | 1 | — | — | Zero-message folders skip fetch | unit | `npx jest --testPathPattern="poller" --bail` | ✅ | ⬜ pending |
| 33-01-03 | 01 | 1 | — | — | Multi-message folders proceed normally | unit | `npx jest --testPathPattern="poller" --bail` | ✅ | ⬜ pending |
| 33-02-01 | 02 | 1 | — | — | Activity logged after move, not before | unit | `npx jest --testPathPattern="processor" --bail` | ✅ | ⬜ pending |
| 33-02-02 | 02 | 1 | — | — | Duplicate path returns early (no double-process) | unit | `npx jest --testPathPattern="processor" --bail` | ✅ | ⬜ pending |
| 33-02-03 | 02 | 1 | — | — | Diagnostic fields in log output | unit | `npx jest --testPathPattern="processor" --bail` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

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
