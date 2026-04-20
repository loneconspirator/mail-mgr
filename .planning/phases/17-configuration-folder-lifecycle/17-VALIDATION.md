---
phase: 17
slug: configuration-folder-lifecycle
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
verified: 2026-04-20
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
| **Estimated runtime** | ~240ms |

---

## Sampling Rate

- **After every task commit:** Run `vitest run test/unit/config/action-folders.test.ts test/unit/action-folders/folders.test.ts`
- **After every plan wave:** Run `vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** <1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | CONF-01 | T-17-01 | Zod min(1) on strings, int().positive() on pollInterval | unit | `vitest run test/unit/config/action-folders.test.ts -t "defaults"` | ✅ | ✅ green |
| 17-01-02 | 01 | 1 | CONF-02 | — | N/A | unit | `vitest run test/unit/config/action-folders.test.ts -t "enabled"` | ✅ | ✅ green |
| 17-01-03 | 01 | 1 | CONF-03 | T-17-03 | z.number().int().positive() prevents 0/negative | unit | `vitest run test/unit/config/action-folders.test.ts -t "pollInterval"` | ✅ | ✅ green |
| 17-02-01 | 02 | 1 | FOLD-01 | T-17-04, T-17-05 | Array-form paths prevent injection; graceful degradation on failure | unit | `vitest run test/unit/action-folders/folders.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test File Summary

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/config/action-folders.test.ts` | 15 | Schema defaults, validation (reject empty/zero/negative/float), backward compat, ConfigRepository get/update/callback |
| `test/unit/action-folders/folders.test.ts` | 6 | Folder existence check, creation, array-form paths, graceful degradation, selective creation, custom prefix |

---

## Wave 0 Requirements

- [x] `test/unit/config/action-folders.test.ts` — 15 tests for CONF-01, CONF-02, CONF-03
- [x] `test/unit/action-folders/folders.test.ts` — 6 tests for FOLD-01

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Emoji folder names display correctly in Fastmail | FOLD-01 | Requires live IMAP server and mail client | 1. Run app with defaults 2. Check Fastmail sidebar for ⭐/🚫/↩️/✅ prefixed folders |

---

## Validation Audit 2026-04-20

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Total tests | 21 |
| All green | ✅ |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 1s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-04-20
