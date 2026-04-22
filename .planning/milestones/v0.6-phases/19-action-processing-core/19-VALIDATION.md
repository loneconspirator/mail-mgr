---
phase: 19
slug: action-processing-core
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
verified: 2026-04-21
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose test/unit/action-folders/` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose test/unit/action-folders/`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | PROC-05 | — | Sender normalized to lowercase bare email | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "extractSender"` | ✅ | ✅ green |
| 19-01-02 | 01 | 1 | PROC-06 | — | Unparseable From moves to INBOX with error logged | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "unparseable"` | ✅ | ✅ green |
| 19-01-03 | 01 | 1 | PROC-01 | — | VIP creates sender-only skip rule, returns to INBOX | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "VIP"` | ✅ | ✅ green |
| 19-01-04 | 01 | 1 | PROC-02 | — | Block creates sender-only delete rule, moves to Trash | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "Block"` | ✅ | ✅ green |
| 19-01-05 | 01 | 1 | PROC-03 | — | Undo VIP removes matching skip rule | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "Undo VIP"` | ✅ | ✅ green |
| 19-01-06 | 01 | 1 | PROC-04 | — | Unblock removes matching delete rule | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "Unblock"` | ✅ | ✅ green |
| 19-01-07 | 01 | 1 | PROC-09 | — | Conflicting rule removed before new rule created | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "conflict"` | ✅ | ✅ green |
| 19-01-08 | 01 | 1 | PROC-10 | — | More specific rule preserved, action rule appended after | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "multi-field"` | ✅ | ✅ green |
| 19-01-09 | 01 | 1 | RULE-01 | — | Created rules pass Zod validation | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "Zod"` | ✅ | ✅ green |
| 19-01-10 | 01 | 1 | RULE-02 | — | Rules have UUID + descriptive name | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "correct name"` | ✅ | ✅ green |
| 19-01-11 | 01 | 1 | RULE-03 | — | Rules appended at end of list | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "order"` | ✅ | ✅ green |
| 19-01-12 | 01 | 1 | RULE-04 | — | Rules indistinguishable from web UI rules | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "web UI"` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test File Summary

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/action-folders/processor.test.ts` | 32 | extractSender, unparseable From, VIP/Block/Undo VIP/Unblock processing, conflict resolution, multi-field preservation, Zod validation, UUID naming, rule ordering, rule shape parity with web UI |

---

## Wave 0 Requirements

- [x] `test/unit/action-folders/processor.test.ts` — stubs for all PROC-* and RULE-* requirements
- [x] Test fixtures for mock EmailMessage, mock ConfigRepository, mock ImapClient, mock ActivityLog

*Existing vitest infrastructure covers framework needs — only test files needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Audit 2026-04-21

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |
| Total tests | 32 |
| All green | ✅ |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-04-21
