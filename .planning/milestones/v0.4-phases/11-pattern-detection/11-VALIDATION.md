---
phase: 11
slug: pattern-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | `vitest.config.ts` |
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
| 11-01-01 | 01 | 1 | LEARN-03 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | LEARN-04 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 2 | LEARN-05 | — | N/A | integration | `npx vitest run` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 2 | UI-02 | — | N/A | integration | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for PatternDetector class (LEARN-03, LEARN-04)
- [ ] Test stubs for proposal API routes (LEARN-05)
- [ ] Test stubs for proposal UI components (UI-02)

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Proposed tab renders correctly in nav | UI-02 | Visual layout | Open browser, verify "Proposed" tab appears in nav bar |
| Proposal cards show correct styling | UI-02 | Visual styling | Verify cards match existing card patterns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
