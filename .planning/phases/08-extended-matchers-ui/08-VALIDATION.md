---
phase: 8
slug: extended-matchers-ui
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-12
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | UI-03 | — | N/A | unit | `npx vitest run test/unit/imap/discovery.test.ts && npx vitest run test/unit/config/config.test.ts` | Wave 0 (created by task) | pending |
| 8-01-02 | 01 | 1 | UI-03 | T-08-01 | Discovery DoS mitigation | unit | `npx vitest run test/unit/web/api.test.ts` | Wave 0 (created by task) | pending |
| 8-02-01 | 02 | 2 | UI-01, UI-03 | T-08-04 | Zod validates new fields | grep + unit | `npx vitest run test/unit/web/ && grep -q "m-deliveredTo" src/web/frontend/app.ts && grep -q "m-visibility" src/web/frontend/app.ts && grep -q "m-readStatus" src/web/frontend/app.ts && grep -q "generateBehaviorDescription" src/web/frontend/rule-display.ts` | existing | pending |
| 8-02-02 | 02 | 2 | UI-03 | T-08-05 | Button disabled during request | grep | `grep -q "discovery-divider" src/web/frontend/styles.css && grep -q "s-rediscover" src/web/frontend/app.ts && grep -q "discovery-warning" src/web/frontend/styles.css && grep -q "Envelope Discovery" src/web/frontend/app.ts && grep -q "triggerDiscovery" src/web/frontend/app.ts` | existing | pending |
| 8-02-03 | 02 | 2 | UI-01, UI-03 | T-08-03 | N/A (accepted risk) | manual | Visual verification (checkpoint:human-verify) | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Plan 01 tasks are TDD -- they create their own test files as part of the RED-GREEN cycle:
- `test/unit/imap/discovery.test.ts` -- created by Plan 01 Task 1
- `test/unit/web/api.test.ts` -- extended by Plan 01 Task 2 (file already exists, new describe blocks added)

No separate Wave 0 step needed -- test creation is embedded in the TDD task actions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Envelope recipient glob input renders and accepts input | UI-01 | UI rendering requires browser (innerHTML-based, no JSDOM compat) | Open rule editor, verify glob input field appears with placeholder |
| Header visibility dropdown shows direct/cc/bcc/list options | UI-01 | UI rendering requires browser | Open rule editor, verify single-select dropdown options |
| Read status dropdown renders with read/unread options | UI-01 | UI rendering requires browser | Open rule editor, verify dropdown; confirm always enabled |
| Disabled state with info tooltip when envelope unavailable | UI-01 | CSS + DOM disabled state requires browser | Open rule editor without envelope header; verify Delivered-To and Recipient Field disabled with tooltip |
| IMAP settings shows discovery status and re-run button | UI-03 | UI rendering requires browser | Open settings page, verify discovery section below IMAP form |
| Discovery button spinner animation during API call | UI-03 | CSS animation requires browser | Click discovery button, verify spinner + disabled state |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
