---
phase: 20
slug: monitoring-startup-recovery
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
verified: 2026-04-21
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/action-folders/poller.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~162ms |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/action-folders/poller.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** <1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | MON-01 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "status checks"` | ✅ | ✅ green |
| 20-01-02 | 01 | 1 | MON-02 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "fetch and process"` | ✅ | ✅ green |
| 20-01-03 | 01 | 1 | FOLD-03 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "start/stop"` | ✅ | ✅ green |
| 20-01-04 | 01 | 1 | FOLD-02 | — | N/A | unit | `npx vitest run test/unit/action-folders/poller.test.ts -t "always-empty"` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test File Summary

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/action-folders/poller.test.ts` | 20 | STATUS checks for all 4 action folder paths, priority processing with fetch and process, startup pre-scan via start/stop lifecycle, always-empty invariant with retry and warning |

---

## Wave 0 Requirements

- [x] `test/unit/action-folders/poller.test.ts` — 20 tests for MON-01, MON-02, FOLD-02, FOLD-03
- [x] Test fixtures for mock IMAP status responses and action folder messages

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Action folders monitored alongside INBOX in real IMAP | MON-01 | Requires live IMAP connection | Start app, move message to action folder, verify processing within poll interval |
| Startup pre-scan before Monitor.start() | FOLD-03 | Startup sequence timing | Stop app, place message in action folder, start app, verify message processed before INBOX scan |

---

## Validation Audit 2026-04-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Total tests | 20 |
| All green | ✅ |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 1s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-04-21
