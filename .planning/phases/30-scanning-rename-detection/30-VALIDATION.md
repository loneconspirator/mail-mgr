---
phase: 30
slug: scanning-rename-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/sentinel/scanner` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/sentinel/scanner`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | SCAN-01 | — | N/A | unit | `npx vitest run test/unit/sentinel/scanner` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 1 | SCAN-02 | — | N/A | unit | `npx vitest run test/unit/sentinel/scanner` | ❌ W0 | ⬜ pending |
| 30-01-03 | 01 | 1 | SCAN-03 | — | N/A | unit | `npx vitest run test/unit/sentinel/scanner` | ❌ W0 | ⬜ pending |
| 30-01-04 | 01 | 1 | SCAN-04 | — | N/A | unit | `npx vitest run test/unit/sentinel/scanner` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/sentinel/scanner.test.ts` — stubs for SCAN-01 through SCAN-04
- [ ] Test fixtures for sentinel store mock data and IMAP folder listing mock

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scan does not delay INBOX monitoring | SCAN-04 | Timer independence is architectural, not directly testable in unit tests | Verify scanner timer is independent via code review; integration test with real IMAP optional |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
