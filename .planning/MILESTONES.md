# Milestones

## v0.8 Action Folder Safety Hardening & FM-002 Generalization (Shipped: 2026-05-06)

**Phases completed:** 2 phases (33-34), 5 plans, 11 tasks
**Timeline:** 12 days (2026-04-24 → 2026-05-05)
**Audit:** PASSED (12/12 requirements, 4/4 integration flows, 4/4 E2E flows, both phases Nyquist-compliant)

**Key accomplishments:**

- Action-folder processor: post-move activity logging via `pendingActivities` accumulator, duplicate-path early return, structured diagnostic logging (D-05/D-06/D-07)
- Sentinel-aware poller skip eliminates ~4 wasteful `fetchAllMessages` IMAP round-trips per poll cycle when folders contain only their sentinel (D-01/D-02)
- `guardedOp` chokepoint wraps every public ImapClient operation with per-op timeout buckets (CONNECT/LOCK/WRITE/BULK_FETCH); single-sourced wedge detection (R2)
- `cleanupFlow` drains in-flight imapflow promises via `flow.close()`; `flow.connect()`/initial `mailboxOpen`/`flow.logout()` all bounded (R3, R4)
- `idleTimeout` default lowered 300s→90s (3.3× faster wedge detection); 22 test fixtures swept (R5)
- FM-002 spec retitled to bind every ImapClient op; MOD-0002 Notes mirrors; 42 FM-002 it.each matrix tests (≥30 acceptance bar) (R1, R6)

**Tech Debt:**

- Pre-existing private `poll()` fallback (non-IDLE servers) lacks NOOP timeout wrapper — not introduced by v0.8, deferred to backlog
- Wedge detection latency is up to 120s (90s idleTimeout + 30s NOOP timeout), not 90s — R5 satisfied as written

---

## v0.7 Sentinel Message System (Shipped: 2026-04-23)

**Phases completed:** 7 phases, 13 plans, 16 tasks

**Key accomplishments:**

- Pure-function RFC 2822 sentinel message builder with INBOX guard, header injection prevention, and purpose-specific body text
- SQLite persistence layer for sentinel-to-folder mappings with full CRUD, migration, and barrel export
- ImapClient extended with appendMessage, searchByHeader, deleteMessage methods via TDD for sentinel IMAP transport layer
- RED phase
- 1. [Rule 2 - Missing] Barrel export for lifecycle functions
- 1. [Rule 2 - Missing] Restructured onActionFolderConfigChange to avoid early returns
- TDD sentinel healer with rename auto-healing, sentinel replanting, and folder-loss notification via INBOX append with dedup tracking
- Sentinel healer wired into both startup and IMAP reconnect SentinelScanner instantiations via onScanComplete callback
- Removed manual folder rename UI card, API endpoint, and CSS -- ~400 lines of dead code eliminated after sentinel auto-healing made it unnecessary

---

## v0.6 Action Folders (Shipped: 2026-04-22)

**Phases completed:** 9 phases (17-25), 16/17 plans executed, 22 tasks
**Timeline:** 2 days (2026-04-20 → 2026-04-21)
**Files changed:** 35 | **LOC delta:** +3,055 / -26

**Key accomplishments:**

- Action folder system — VIP, Block, Undo VIP, Unblock senders via drag-and-drop to special IMAP folders
- Poll-based monitoring with startup pre-scan and crash recovery (always-empty invariant)
- Conflict resolution & idempotency for action folder processing (duplicate prevention, undo-with-no-match)
- IMAP folder rename UI in settings with validation and special-use warnings
- Action folder config API (GET/PUT) with Zod validation and dynamic prefix support
- Activity logging extended with source='action-folder' and rule_id/rule_name fields

**Known Gaps:**

- Plan 25-04 (folder rename → config propagation) deliberately skipped — superseded by v0.7 Sentinel Message System

---

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
