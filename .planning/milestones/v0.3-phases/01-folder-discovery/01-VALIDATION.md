---
phase: 1
slug: folder-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 1 — Validation Strategy

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
| 1-01-01 | 01 | 1 | FOLD-01 | — | N/A | unit | `npx vitest run test/unit/imap/client.test.ts -x` | ✅ (needs new tests) | ⬜ pending |
| 1-01-02 | 01 | 1 | FOLD-01 | — | N/A | unit | `npx vitest run test/unit/web/folders.test.ts -x` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | FOLD-02 | — | N/A | unit | `npx vitest run test/unit/folders/cache.test.ts -x` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | FOLD-02 | — | N/A | unit | `npx vitest run test/unit/web/folders.test.ts -x` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | FOLD-03 | — | N/A | unit | `npx vitest run test/unit/web/api.test.ts -x` | ✅ (needs new tests) | ⬜ pending |
| 1-02-02 | 02 | 1 | FOLD-03 | — | N/A | unit | `npx vitest run test/unit/web/api.test.ts -x` | ✅ (needs new tests) | ⬜ pending |
| 1-02-03 | 02 | 1 | FOLD-03 | — | N/A | unit | `npx vitest run test/unit/web/api.test.ts -x` | ✅ (needs new tests) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/folders/cache.test.ts` — stubs for FOLD-02 (cache TTL, refresh, stale detection)
- [ ] `test/unit/web/folders.test.ts` — stubs for FOLD-01, FOLD-02 (route handler, response shape)
- [ ] New test cases in `test/unit/web/api.test.ts` — covers FOLD-03 (warning on rule save)
- [ ] New test cases in `test/unit/imap/client.test.ts` — covers FOLD-01 (listTree call)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
