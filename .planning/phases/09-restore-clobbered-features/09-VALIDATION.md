---
phase: 9
slug: restore-clobbered-features
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-12
validated: 2026-04-12
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
| 09-01-01 | 01 | 1 | SC-05 | — | N/A | unit | `npx vitest run test/unit/log/migrations.test.ts` | ✅ | ✅ green |
| 09-01-02 | 01 | 1 | SC-01 | — | N/A | type-check | `npm run build` | ✅ | ✅ green |
| 09-02-01 | 02 | 1 | SC-01 | — | N/A | unit | `npx vitest run test/unit/sweep/sweep.test.ts` | ✅ | ✅ green |
| 09-02-02 | 02 | 1 | SC-01 | — | N/A | integration | `npx vitest run test/integration/sweep.test.ts` | ✅ | ✅ green |
| 09-03-01 | 03 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts` | ✅ | ✅ green |
| 09-03-02 | 03 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/batch.test.ts` | ✅ | ✅ green |
| 09-04-01 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/folders/cache.test.ts` | ✅ | ✅ green |
| 09-04-02 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/folders.test.ts` | ✅ | ✅ green |
| 09-04-03 | 04 | 2 | SC-01 | — | N/A | unit | `npx vitest run test/unit/web/folder-picker.test.ts` | ✅ | ✅ green |
| 09-05-01 | 05 | 3 | SC-02-05 | — | N/A | build | `npm run build && npm test` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Restore `test/unit/log/migrations.test.ts` — DB migrations tests (7 tests, green)
- [x] Restore `test/unit/sweep/sweep.test.ts` — ReviewSweeper unit tests (27 tests, green)
- [x] Restore `test/integration/sweep.test.ts` — Sweep integration tests (green)
- [x] Restore `test/unit/batch/engine.test.ts` — BatchEngine tests (38 tests, green)
- [x] Restore `test/unit/web/batch.test.ts` — Batch route tests (9 tests, green)
- [x] Restore `test/unit/folders/cache.test.ts` — FolderCache tests (15 tests, green)
- [x] Restore `test/unit/web/folders.test.ts` — Folder route tests (5 tests, green)
- [x] Restore `test/unit/web/folder-picker.test.ts` — Folder picker tests (11 tests, green)

*All 8 Wave 0 test files restored during phase execution. 112 tests across these files, all passing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Batch page renders correctly | SC-02 | Visual UI verification | Open web UI, navigate to Batch tab, verify form and results render |
| Folder picker tree expands/collapses | SC-02 | Interactive UI behavior | Open rule editor, click folder picker, expand/collapse nodes |
| Review status card shows sweep info | SC-02 | Visual UI verification | Check dashboard shows review folder stats and next sweep time |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s (suite runs in ~1s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-12

---

## Validation Audit 2026-04-12

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 10 tasks have automated verification commands. All 8 Wave 0 test files exist and pass. Full suite: 21 files, 365 tests, 0 failures. Build passes clean. No gaps identified — phase is fully Nyquist-compliant.
