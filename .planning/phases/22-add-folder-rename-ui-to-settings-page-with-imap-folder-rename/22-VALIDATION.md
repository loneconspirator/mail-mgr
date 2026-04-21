---
phase: 22
slug: add-folder-rename-ui-to-settings-page-with-imap-folder-rename
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 22-01-01 | 01 | 1 | — | — | N/A | unit | `npx vitest run src/imap/__tests__/client-rename.test.ts` | ❌ W0 | ⬜ pending |
| 22-01-02 | 01 | 1 | — | — | N/A | unit | `npx vitest run src/web/__tests__/folders-rename.test.ts` | ❌ W0 | ⬜ pending |
| 22-01-03 | 01 | 1 | — | — | N/A | integration | `npx vitest run src/web/__tests__/settings-rename-ui.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/imap/__tests__/client-rename.test.ts` — stubs for ImapClient.renameFolder
- [ ] `src/web/__tests__/folders-rename.test.ts` — stubs for POST /api/folders/rename route
- [ ] `src/web/__tests__/settings-rename-ui.test.ts` — stubs for settings page rename card UI

*Existing vitest infrastructure covers framework installation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Folder tree picker visual selection | D-01 | Requires visual browser rendering | Open settings, click a folder in tree, verify highlight and name field appear |
| Toast notification display | D-06 | Requires browser DOM and CSS | Trigger a rename, verify toast appears with correct message |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
