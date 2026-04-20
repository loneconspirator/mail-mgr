---
phase: 18
slug: safety-predicates-activity-log
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/log/ test/unit/action-folders/ test/unit/rules/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/log/ test/unit/action-folders/ test/unit/rules/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | LOG-01 | — | N/A | unit | `npx vitest run test/unit/log/activity.test.ts -t "action-folder"` | Extend existing | ⬜ pending |
| 18-01-02 | 01 | 1 | LOG-02 | — | N/A | unit | `npx vitest run test/unit/log/activity.test.ts -t "rule_id"` | Partially exists | ⬜ pending |
| 18-02-01 | 02 | 1 | EXT-01 | — | N/A | unit | `npx vitest run test/unit/action-folders/registry.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 1 | EXT-01 | — | Registry keys match config keys | unit | `npx vitest run test/unit/action-folders/registry.test.ts -t "config"` | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 1 | — | — | N/A | unit | `npx vitest run test/unit/rules/sender-utils.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 1 | — | — | Exact case-insensitive match only | unit | `npx vitest run test/unit/rules/sender-utils.test.ts -t "findSenderRule"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/action-folders/registry.test.ts` — covers EXT-01 (registry shape, completeness, config key alignment)
- [ ] `test/unit/rules/sender-utils.test.ts` — covers findSenderRule and isSenderOnly extraction

*Existing infrastructure covers LOG-01/LOG-02 via extending `test/unit/log/activity.test.ts`.*

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
