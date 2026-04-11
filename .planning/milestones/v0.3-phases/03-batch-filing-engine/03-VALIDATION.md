---
phase: 3
slug: batch-filing-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/batch` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/batch`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | BATC-01 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts -t "evaluates all messages"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | BATC-02 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts -t "first match wins"` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | BATC-03 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts -t "chunked"` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | BATC-05 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts -t "cancel"` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | BATC-06 | — | N/A | unit | `npx vitest run test/unit/batch/engine.test.ts -t "dry-run"` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | BATC-01 | — | N/A | unit | `npx vitest run test/unit/web/batch.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 1 | BATC-14 | — | N/A | unit | `npx vitest run test/unit/log/activity.test.ts -t "batch"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/batch/` directory — needs creation
- [ ] `test/unit/batch/engine.test.ts` — stubs for BATC-01, BATC-02, BATC-03, BATC-05, BATC-06
- [ ] `test/unit/web/batch.test.ts` — stubs for batch API routes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dry-run preview matches actual batch results | BATC-06 | Requires live IMAP server with messages | Run dry-run, verify counts, then execute and compare moved counts |
| Cancel stops after current chunk | BATC-05 | Timing-dependent with real IMAP | Start batch on large folder, cancel mid-run, verify partial results |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
