---
phase: 12
slug: retroactive-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 12 — Validation Strategy

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
| 12-01-01 | 01 | 1 | MATCH-01 | — | N/A | integration | `npx vitest run test/unit/imap/discovery.test.ts` | ✅ | ⬜ pending |
| 12-01-02 | 01 | 1 | MATCH-02 | — | N/A | integration | `npx vitest run test/unit/imap/discovery.test.ts` | ✅ | ⬜ pending |
| 12-01-03 | 01 | 1 | MATCH-03 | — | N/A | unit | `npx vitest run test/unit/rules/matcher.test.ts` | ✅ | ⬜ pending |
| 12-01-04 | 01 | 1 | MATCH-04 | — | N/A | unit | `npx vitest run test/unit/rules/matcher.test.ts` | ✅ | ⬜ pending |
| 12-01-05 | 01 | 1 | MATCH-05 | — | N/A | unit | `npx vitest run test/unit/rules/matcher.test.ts` | ✅ | ⬜ pending |
| 12-01-06 | 01 | 1 | MATCH-06 | — | N/A | unit | `npx vitest run test/unit/rules/evaluator.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI "Run Discovery" button triggers POST /api/config/envelope/discover | MATCH-02 | Frontend interaction | Click button, verify network request fires and discovery runs |
| UI disables deliveredTo/visibility fields when envelope not configured | MATCH-06 | Frontend rendering | Remove envelope config, verify fields are disabled with info icon |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
