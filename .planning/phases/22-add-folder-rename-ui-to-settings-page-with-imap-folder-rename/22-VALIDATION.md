---
phase: 22
slug: add-folder-rename-ui-to-settings-page-with-imap-folder-rename
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
---

# Phase 22 — Validation Strategy

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
| 22-01-01 | 01 | 1 | D-03, D-04, D-07 | — | N/A | unit | `npx vitest run test/unit/imap/client-rename.test.ts` | TDD — created by task | ⬜ pending |
| 22-01-02 | 01 | 1 | D-04, D-07, D-08 | — | Path traversal prevention | unit | `npx vitest run test/unit/web/folders-rename.test.ts` | TDD — created by task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing test infrastructure covers all phase requirements. New test files are created inline by TDD tasks in Plan 01. No Wave 0 stubs needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Folder tree picker visual selection | D-01 | Requires visual browser rendering | Open settings, click a folder in tree, verify highlight and name field appear |
| Toast notification display | D-06 | Requires browser DOM and CSS | Trigger a rename, verify toast appears with correct message |
| Special-use folder warning | D-05 | Requires visual confirmation of warning banner | Select a special-use folder (Sent/Drafts), verify warning appears |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-20
