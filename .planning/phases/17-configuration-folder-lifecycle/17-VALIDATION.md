---
phase: 17
slug: configuration-folder-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `vitest run test/unit/config/action-folders.test.ts test/unit/action-folders/folders.test.ts` |
| **Full suite command** | `vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `vitest run test/unit/config/action-folders.test.ts test/unit/action-folders/folders.test.ts`
- **After every plan wave:** Run `vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | CONF-01 | — | N/A | unit | `vitest run test/unit/config/action-folders.test.ts -t "defaults"` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | CONF-02 | — | N/A | unit | `vitest run test/unit/config/action-folders.test.ts -t "enabled"` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | CONF-03 | — | N/A | unit | `vitest run test/unit/config/action-folders.test.ts -t "pollInterval"` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | FOLD-01 | — | N/A | unit | `vitest run test/unit/action-folders/folders.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/config/action-folders.test.ts` — stubs for CONF-01, CONF-02, CONF-03
- [ ] `test/unit/action-folders/folders.test.ts` — stubs for FOLD-01

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Emoji folder names display correctly in Fastmail | FOLD-01 | Requires live IMAP server and mail client | 1. Run app with defaults 2. Check Fastmail sidebar for ⭐/🚫/↩️/✅ prefixed folders |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
