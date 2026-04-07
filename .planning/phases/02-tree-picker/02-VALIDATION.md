---
phase: 2
slug: tree-picker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PICK-03 | — | N/A | unit | `npx vitest run test/unit/log/activity.test.ts -x` | Yes (needs new tests) | ⬜ pending |
| 02-01-02 | 01 | 1 | PICK-03 | — | N/A | unit | `npx vitest run test/unit/web/api.test.ts -x` | Yes (needs new tests) | ⬜ pending |
| 02-02-01 | 02 | 1 | PICK-01 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 | ⬜ pending |
| 02-02-02 | 02 | 1 | PICK-02 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 | ⬜ pending |
| 02-02-03 | 02 | 1 | PICK-03 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 | ⬜ pending |
| 02-02-04 | 02 | 1 | PICK-01 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/web/folder-picker.test.ts` — stubs for PICK-01, PICK-02, PICK-03 (tree rendering, expand/collapse, selection, recent folders display)
- [ ] New test cases in `test/unit/log/activity.test.ts` — covers PICK-03 (getRecentFolders query)
- [ ] New test cases in `test/unit/web/api.test.ts` — covers PICK-03 (recent-folders endpoint)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tree picker renders visually correct in rule editor modal | PICK-01 | Visual layout/styling verification | Open rule editor, select "move" action, verify tree picker appears with proper indentation and styling |
| Modal scrolling works with large folder tree | PICK-02 | Visual overflow behavior | Load account with 50+ nested folders, verify picker area scrolls independently |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
