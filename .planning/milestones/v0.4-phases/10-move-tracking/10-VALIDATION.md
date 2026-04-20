---
phase: 10
slug: move-tracking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/unit/tracking` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/tracking`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | LEARN-01 | — | N/A | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "detects disappeared"` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | LEARN-01 | — | N/A | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "excludes system"` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | LEARN-01 | — | N/A | unit | `npx vitest run test/unit/tracking/tracker.test.ts -t "scan interval"` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | LEARN-02 | T-10-01 | Parameterized queries for all signal writes | unit | `npx vitest run test/unit/log/migrations.test.ts -t "move_signals"` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | LEARN-02 | T-10-01 | Parameterized queries for all signal writes | unit | `npx vitest run test/unit/tracking/signals.test.ts -t "stores signal"` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 1 | LEARN-02 | — | N/A | unit | `npx vitest run test/unit/tracking/signals.test.ts -t "prune"` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 1 | LEARN-02 | — | N/A | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "fast pass"` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 1 | LEARN-02 | — | N/A | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "deep scan"` | ❌ W0 | ⬜ pending |
| 10-03-03 | 03 | 1 | LEARN-02 | — | N/A | unit | `npx vitest run test/unit/tracking/destinations.test.ts -t "drops unresolvable"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/tracking/tracker.test.ts` — stubs for LEARN-01 (snapshot diffing, cross-reference, lifecycle)
- [ ] `test/unit/tracking/signals.test.ts` — stubs for LEARN-02 signal storage and pruning
- [ ] `test/unit/tracking/destinations.test.ts` — stubs for destination resolution (fast pass, deep scan, drop)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Move tracking runs alongside Monitor without interference | LEARN-01 | Requires live IMAP server and concurrent processes | Start system, manually move message from Inbox, verify signal logged without Monitor disruption |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
