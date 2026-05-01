---
gsd_state_version: 1.0
milestone: v0.8
milestone_name: Action Folder Safety Hardening
status: planning
last_updated: "2026-05-01T18:39:00.000Z"
last_activity: 2026-05-01
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23)

**Core value:** Dramatically reduce inbox volume without losing visibility
**Current focus:** Planning next milestone

## Current Position

Milestone: v0.8 Action Folder Safety Hardening — Active
Status: Planning
Last activity: 2026-05-01 - Completed quick task 260501-fo4: Implement HTTP BASIC auth on web app and API

Progress: [░░░░░░░░░░] 0% (0/0 plans, 0/1 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 15 (v0.7)
- Average duration: —
- Total execution time: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v0.7]: Message-ID is the persistent identifier (not UID — UIDVALIDITY changes invalidate UIDs)
- [v0.7]: Two-tier scan: fast-path checks expected folders, deep scan only on missing sentinels
- [v0.7]: Auto-healing must NOT trigger full pipeline rebuilds
- [v0.7]: INBOX never gets a sentinel (cannot be renamed/deleted)
- [v0.7]: Sentinel cleanup on untrack (rule deleted, config changed)
- [v0.7]: Config mutations via saveConfig() bypass ConfigRepository listeners to prevent pipeline rebuilds
- [v0.7]: Dedup folder-loss notifications by removing sentinel mapping after first notification
- [Phase 31]: Barrel exports already present from 31-01; only src/index.ts needed wiring changes

### Pending Todos

1. **Prevent redundant proposed rules and handle rule ordering conflicts** — Block approval of rules that duplicate existing criteria; warn when shadowed by higher-priority rules with reorder option
2. **Populate delivered-to field in proposed rules and modify form** — Include delivered-to as matcher in proposals, prepopulate in Modify modal
3. **Generalize FM-002 — harden ImapClient against wedged-connection silent failures** — Extend the FM-002 trip-wire from IDLE+listFolders to the entire ImapClient public surface; bound flow.connect(); verify in-flight rejection on handleClose; consider lowering idleTimeout default. Likely root of much of the app's silent flakiness.

### Roadmap Evolution

- v0.8 milestone created: Action Folder Safety Hardening (incident-driven, 2026-04-24)
- Phase 33 added: Action Folder Safety Hardening — sentinel-aware skip, circuit breaker, diagnostic logging
- Phase 34 added: Generalize FM-002 — harden ImapClient against wedged-connection silent failures

### Blockers/Concerns

(None)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260420-did | Add optional folder finder to New Rule modal | 2026-04-20 | a31a7ce | [260420-did-add-optional-folder-finder-to-new-rule-m](./quick/260420-did-add-optional-folder-finder-to-new-rule-m/) |
| 260420-dsq | Rename skip rule display to leave in place | 2026-04-20 | 7422b67 | [260420-dsq-rename-skip-rule-display-to-leave-in-pla](./quick/260420-dsq-rename-skip-rule-display-to-leave-in-pla/) |
| Phase 31 P02 | 1min | 1 tasks | 1 files |
| 260428-x6c | Populate architecture covers-* frontmatter, clear back-link warnings | 2026-04-29 | 68e20c6 | [260428-x6c-populate-covers-modules-and-covers-integ](./quick/260428-x6c-populate-covers-modules-and-covers-integ/) |
| 260429-d4a | Wire IX-003 integration test | 2026-04-29 | 2089921 | [260429-d4a-wire-ix-003-integration-test](./quick/260429-d4a-wire-ix-003-integration-test/) |
| 260430-msg | Fix INBOX-destination bug in proposed rules | 2026-05-01 | 54000ff | [260430-msg-fix-inbox-destination-bug-in-proposed-ru](./quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/) |
| 260501-ej8 | Document INV-002 (INBOX never proposed) and add IX-003.8 integration test | 2026-05-01 | c31d478 | [260501-ej8-document-inv-002-inbox-never-proposed-an](./quick/260501-ej8-document-inv-002-inbox-never-proposed-an/) |
| 260501-ewi | Wire IX-004 integration test | 2026-05-01 | 04e280b | [260501-ewi-wire-ix-004-integration-test](./quick/260501-ewi-wire-ix-004-integration-test/) |
| 260501-fo4 | Implement HTTP BASIC auth on web app and API | 2026-05-01 | 9cc1692 | [260501-fo4-implement-http-basic-auth-on-web-app-and](./quick/260501-fo4-implement-http-basic-auth-on-web-app-and/) |

## Session Continuity

Last session: 2026-04-24T22:58:45.334Z
Last activity: 2026-04-23 — v0.7 milestone shipped, archived to milestones/
