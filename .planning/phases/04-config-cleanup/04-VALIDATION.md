---
phase: 4
slug: config-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npx vitest run --config vitest.integration.config.ts` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && npx vitest run --config vitest.integration.config.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | CONF-05 | — | N/A | unit | `npx vitest run test/unit/config/config.test.ts` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | CONF-05 | — | N/A | unit | `npx vitest run test/unit/config/config.test.ts` | ✅ | ⬜ pending |
| 04-01-03 | 01 | 1 | CONF-05 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | CONF-01, CONF-02 | T-04-01 | Zod rejects invalid config | unit | `npx vitest run test/unit/config/repository.test.ts` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 1 | CONF-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | CONF-03 | — | N/A | unit | `npx vitest run test/unit/web/api.test.ts` | ✅ | ⬜ pending |
| 04-02-04 | 02 | 1 | CONF-04 | — | N/A | unit | `npx vitest run test/unit/monitor/monitor.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test for `updateReviewConfig` with partial sweep object (verifies shallow merge behavior)
- [ ] Test for Monitor with `cursorEnabled = 'false'` — verifies lastUid not loaded/persisted
- [ ] Test for rule schema accepting `name: undefined` (schema validation test)
- [ ] Test for behavior description generation function (new pure function)
- [ ] Test for stale sweeper scenario (config reload → getSweeper returns new instance)

*Existing infrastructure partially covers requirements — Wave 0 fills gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sweep settings card renders editable fields with tree pickers | CONF-01 | DOM rendering in vanilla TS SPA — no jsdom picker integration | Open settings page, verify all 6 fields are editable, folder fields show picker |
| Behavior description displays correctly in rule list | CONF-05 | Visual formatting verification | Create rule without name, verify behavior description shows as primary text |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
