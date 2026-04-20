---
phase: 16
slug: inline-sender-management
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run test/unit/web/dispositions.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~1 second (targeted), ~5 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/unit/web/dispositions.test.ts test/unit/web/api.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | MGMT-01 | T-16-02, T-16-04 | Backend validates rule payload via Zod; frontend renders sender via createTextNode | unit | `npx vitest run test/unit/web/api.test.ts -t "POST /api/rules"` | ✅ | ✅ green |
| 16-01-01 | 01 | 1 | MGMT-01 | T-16-01 | Disposition filtering returns only sender-only rules | unit | `npx vitest run test/unit/web/dispositions.test.ts` | ✅ | ✅ green |
| 16-01-01 | 01 | 1 | MGMT-02 | — | Rule deletion via API returns 200 or 404 | unit | `npx vitest run test/unit/web/api.test.ts -t "DELETE /api/rules"` | ✅ | ✅ green |
| 16-01-02 | 01 | 1 | MGMT-03 | T-16-04 | Move action requires folder; schema validates action shape | unit | `npx vitest run test/unit/config/config.test.ts -t "move"` | ✅ | ✅ green |
| 16-01-02 | 01 | 1 | MGMT-03 | — | Folder picker component tested | unit | `npx vitest run test/unit/web/folder-picker.test.ts` | ✅ | ✅ green |
| 16-01-01 | 01 | 1 | MGMT-04 | — | N/A (pure frontend wiring) | manual | See Manual-Only | — | ✅ verified |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Add Sender modal renders with correct title and creates rule | MGMT-01 | Modal DOM rendering + form interaction require browser | Navigate to Priority Senders → click "+ Add Sender" → enter pattern → submit → verify toast + row appears |
| Remove button shows confirm dialog and deletes rule | MGMT-02 | browser confirm() not testable programmatically | Click "Remove" on any sender → confirm dialog → verify row disappears |
| Archived Add Sender requires folder selection | MGMT-03 | Folder picker tree + two-condition submit guard require browser | Navigate to Archived → click "+ Add Sender" → verify submit disabled → select folder → verify submit enables |
| Edit Rule opens modal and refreshes disposition view on save | MGMT-04 | Multi-step modal interaction requires browser observation | Click "Edit Rule" → modify rule → save → verify disposition view refreshes (not Rules page) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-04-20
