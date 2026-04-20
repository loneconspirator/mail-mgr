# Milestones

## v0.5 Sender Disposition Views (Shipped: 2026-04-20)

**Phases completed:** 4 phases, 5 plans, 10 tasks
**Timeline:** 1 day (2026-04-19 → 2026-04-20)
**Commits:** 66 | **Files changed:** 10 | **LOC delta:** +802 / -13

**Key accomplishments:**

- Disposition query API with isSenderOnly predicate filtering all 6 EmailMatch fields
- Priority & Blocked sender views via shared renderDispositionView function
- Reviewed & Archived folder-grouped accordion views with shared renderFolderGroupedView
- Inline sender add/remove from any disposition view without opening rule editor
- Tab navigation integrating disposition views alongside existing rule list
- Folder picker integration for adding senders to Archived view

---

## v0.4 Extended Matchers & Behavioral Learning (Shipped: 2026-04-20)

**Phases completed:** 7 phases (6-12), 23 plans
**Timeline:** 9 days (2026-04-11 → 2026-04-19)
**Commits:** 214 | **Files changed:** 197 | **LOC delta:** +18,695 / -15,134

**Key accomplishments:**

- Envelope recipient auto-discovery and matching (Delivered-To, X-Original-To) with glob syntax and +tag support
- Header visibility (direct/cc/bcc/list) and read status (read/unread) matchers in first-match-wins evaluator
- Full v0.3 feature restoration after catastrophic Phase 7 clobber (10 modules, 8 test files recovered)
- Move tracking with UID snapshot diffing detects user-initiated moves and logs structured signals
- Pattern detection engine identifies repeating move patterns and surfaces proposed rules
- Proposed rules UI with approve/modify/dismiss workflow, conflict detection, and duplicate prevention
- Retroactive verification of all orphaned phase requirements with line-level evidence

**Known Gaps:**

- MATCH-01 through MATCH-06 checkboxes were not ticked in REQUIREMENTS.md because orphaned phases 6-9 didn't run through normal completion — all 6 verified by Phase 12 retroactive verification
- Review config change does not rebuild MoveTracker (requires IMAP config save or restart)
- Pattern detection thresholds hardcoded (user explicitly delegated to Claude's discretion)
- 5 human verification items pending for Phase 11 (browser DOM, live IMAP interaction)

**Tech Debt:**

- MoveTracker config hot-reload gap (scanInterval/enabled changes need restart)
- Hardcoded pattern thresholds (not externally configurable)

---
