---
phase: 8
slug: extended-matchers-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | UI-01 | — | N/A | manual | Browser check | — | ⬜ pending |
| 8-01-02 | 01 | 1 | UI-01 | — | N/A | manual | Browser check | — | ⬜ pending |
| 8-01-03 | 01 | 1 | UI-01 | — | N/A | manual | Browser check | — | ⬜ pending |
| 8-02-01 | 02 | 1 | UI-03 | — | N/A | manual | Browser check | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Envelope recipient glob input renders and accepts input | UI-01 | UI rendering requires browser | Open rule editor, verify glob input field appears |
| Header visibility multi-select shows direct/cc/bcc/list | UI-01 | UI rendering requires browser | Open rule editor, verify multi-select options |
| Read status toggle renders and toggles | UI-01 | UI rendering requires browser | Open rule editor, verify toggle control |
| IMAP settings shows discovery status and re-run button | UI-03 | UI rendering requires browser | Open settings page, verify discovery section |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
