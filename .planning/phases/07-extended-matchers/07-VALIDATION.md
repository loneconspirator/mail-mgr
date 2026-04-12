---
phase: 07
slug: extended-matchers
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-11
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | MATCH-03 | T-07-01 | Zod enum + picomatch (no regex injection) | unit | `npx vitest run test/unit/config/schema.test.ts` | Needs new file (W0) | pending |
| 07-01-02 | 01 | 1 | MATCH-03, MATCH-04, MATCH-05 | T-07-01, T-07-02 | Zod enum restricts values; picomatch for globs | unit | `npx vitest run test/unit/rules/matcher.test.ts` | Exists (extend) | pending |
| 07-02-01 | 02 | 2 | MATCH-03, MATCH-04, MATCH-05 (D-08, D-09) | T-07-04, T-07-05 | Skip logic uses system-parsed IMAP data | unit | `npx vitest run test/unit/rules/evaluator.test.ts` | Exists (extend) | pending |
| 07-02-02 | 02 | 2 | MATCH-03, MATCH-04, MATCH-05 | — | N/A | regression | `npx vitest run --reporter=verbose` | Exists | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- Create `test/unit/config/schema.test.ts` for emailMatchSchema validation tests (Plan 01 Task 1 creates this via TDD)
- Extend `test/unit/rules/matcher.test.ts` with describe blocks for deliveredTo, visibility, readStatus (Plan 01 Task 2 creates this via TDD)
- Extend `test/unit/rules/evaluator.test.ts` with envelope-unavailable skip logic tests (Plan 02 Task 1 creates this via TDD)

All Wave 0 gaps are covered by TDD tasks that write tests before implementation (RED phase).

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
