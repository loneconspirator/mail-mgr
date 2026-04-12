---
phase: 9
slug: restore-clobbered-features
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npm test && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | SC-05 | — | N/A | unit | `npx vitest run test/unit/log/migrations.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | SC-01 | — | N/A | type-check | `npm run build` | ✅ | ⬜ pending |
| 09-02-01 | 02 | 1 | SC-01 | — | N/A | unit | `npx vitest run test/unit/sweep/sweep.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 1 | SC-01 | — | N/A | integration | `npx vitest run test/integration/sweep.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-02 | 03 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/batch.test.ts` | ❌ W0 | ⬜ pending |
| 09-04-01 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/folders/cache.test.ts` | ❌ W0 | ⬜ pending |
| 09-04-02 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/folders.test.ts` | ❌ W0 | ⬜ pending |
| 09-04-03 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts` | ❌ W0 | ⬜ pending |
| 09-05-01 | 05 | 3 | SC-02-05 | — | N/A | build | `npm run build && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Restore `test/unit/log/migrations.test.ts` — DB migrations tests
- [ ] Restore `test/unit/sweep/sweep.test.ts` — ReviewSweeper unit tests
- [ ] Restore `test/integration/sweep.test.ts` — Sweep integration tests
- [ ] Restore `test/unit/batch/engine.test.ts` — BatchEngine tests
- [ ] Restore `test/unit/web/batch.test.ts` — Batch route tests
- [ ] Restore `test/unit/folders/cache.test.ts` — FolderCache tests
- [ ] Restore `test/unit/web/folders.test.ts` — Folder route tests
- [ ] Restore `test/unit/web/folder-picker.test.ts` — Folder picker tests

*Note: Test restoration is integral to this phase — tests are restored alongside their corresponding source modules in each plan.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Batch page renders correctly | SC-02 | Visual UI verification | Open web UI, navigate to Batch tab, verify form and results render |
| Folder picker tree expands/collapses | SC-02 | Interactive UI behavior | Open rule editor, click folder picker, expand/collapse nodes |
| Review status card shows sweep info | SC-02 | Visual UI verification | Check dashboard shows review folder stats and next sweep time |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
