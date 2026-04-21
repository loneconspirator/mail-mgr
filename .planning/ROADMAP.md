# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- ✅ **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-12 (shipped 2026-04-20)
- ✅ **v0.5 Sender Disposition Views** — Phases 13-16 (shipped 2026-04-20)
- 🚧 **v0.6 Action Folders** — Phases 17-24 (in progress)

## Phases

<details>
<summary>✅ v0.3 Folder Taxonomy & Batch Filing (Phases 1-5) — SHIPPED 2026-04-11</summary>

- [x] Phase 1: Folder Discovery (2/2 plans) — IMAP folder hierarchy, cached API, validation warnings
- [x] Phase 2: Tree Picker (2/2 plans) — Visual folder selector, expand/collapse, recent folders
- [x] Phase 3: Batch Filing Engine (3/3 plans) — Dry-run preview, chunked execution, cancellation
- [x] Phase 4: Config & Cleanup (2/2 plans) — Sweep settings UI, cursor toggle, optional rule names
- [x] Phase 5: Frontend Polish (1/1 plan) — No-match fix, api wrapper migration, type-safe catches

Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md)

</details>

<details>
<summary>✅ v0.4 Extended Matchers & Behavioral Learning (Phases 6-12) — SHIPPED 2026-04-20</summary>

- [x] Phase 6: Extended Message Data (4 plans) — Envelope recipient extraction, header visibility, auto-discovery, versioned migrations
- [x] Phase 7: Extended Matchers (2 plans) — deliveredTo, visibility, readStatus in matchRule() and config schema
- [x] Phase 8: Extended Matchers UI (4 plans) — Rule editor new match fields, IMAP settings discovery controls
- [x] Phase 9: Restore Clobbered Features (5 plans) — Recover sweep, batch, folders, review config, UI from Phase 7 clobber
- [x] Phase 10: Move Tracking (4 plans) — UID snapshot diffing, signal logging to SQLite (completed 2026-04-13)
- [x] Phase 11: Pattern Detection & Proposed Rules (3 plans) — Statistical analysis, proposed rules API and UI (completed 2026-04-13)
- [x] Phase 12: Retroactive Verification (1 plan) — Formal verification of orphaned phases 6-9 (completed 2026-04-20)

Full details: [milestones/v0.4-ROADMAP.md](milestones/v0.4-ROADMAP.md)

</details>

<details>
<summary>✅ v0.5 Sender Disposition Views (Phases 13-16) — SHIPPED 2026-04-20</summary>

- [x] Phase 13: Disposition Query API (2/2 plans) — isSenderOnly predicate, GET /api/dispositions route
- [x] Phase 14: Navigation Shell & Simple Views (1/1 plan) — Priority/Blocked nav tabs, sender list views
- [x] Phase 15: Folder-Grouped Views (1/1 plan) — Reviewed/Archived accordion views, shared renderFolderGroupedView
- [x] Phase 16: Inline Sender Management (1/1 plan) — Add/remove sender, Edit Rule link, folder picker for Archived

Full details: [milestones/v0.5-ROADMAP.md](milestones/v0.5-ROADMAP.md)

</details>

### v0.6 Action Folders (In Progress)

**Milestone Goal:** Let users manage sender dispositions directly from their mail client by moving messages to special IMAP folders.

- [x] **Phase 17: Configuration & Folder Lifecycle** - Schema, config validation, and IMAP folder auto-creation (completed 2026-04-20)
- [x] **Phase 18: Safety Predicates & Activity Log** - MoveTracker exclusions, shared predicates, action registry, logging extension (completed 2026-04-20)
- [x] **Phase 19: Action Processing Core** - Sender extraction, rule CRUD, message routing for all four action types (completed 2026-04-20)
- [x] **Phase 20: Monitoring & Startup Recovery** - Poll integration, priority processing, startup pre-scan, always-empty invariant (completed 2026-04-21)
- [x] **Phase 21: Idempotency & Edge Cases** - Duplicate prevention, undo-with-no-match, crash recovery resilience (completed 2026-04-21)

## Phase Details

### Phase 17: Configuration & Folder Lifecycle
**Goal**: System has a validated configuration for action folders and creates the folder hierarchy on startup
**Depends on**: Nothing (first phase of v0.6)
**Requirements**: CONF-01, CONF-02, CONF-03, FOLD-01
**Success Criteria** (what must be TRUE):
  1. Action folder prefix and individual folder names are configurable with sensible defaults
  2. Action folders feature can be enabled/disabled via config and poll interval is configurable
  3. System creates the full `Actions/` folder hierarchy on startup if folders do not already exist
  4. Folder creation uses array-form paths (separator-safe) and handles already-exists gracefully
**Plans**: 2 plans

Plans:
- [x] 17-01-PLAN.md — Zod config schema, ConfigRepository methods, default.yml
- [x] 17-02-PLAN.md — Folder creation logic, ImapClient update, startup wiring

### Phase 18: Safety Predicates & Activity Log
**Goal**: MoveTracker correctly ignores action folder moves and the system has reusable building blocks for action processing
**Depends on**: Phase 17
**Requirements**: LOG-01, LOG-02, EXT-01
**Success Criteria** (what must be TRUE):
  1. Action folder paths are excluded from MoveTracker's user-move detection (isSystemMove recognizes action-folder source)
  2. Activity log entries with source `action-folder` include rule_id and rule_name fields
  3. Action types are defined in a registry pattern where each entry specifies folder name, processing function, and message destination
  4. Shared `findSenderRule(sender, actionType)` predicate exists for reuse by processor
**Plans**: 2 plans

Plans:
- [x] 18-01-PLAN.md — Extend isSystemMove and logActivity source union for action-folder
- [x] 18-02-PLAN.md — Action type registry and sender-utils extraction

### Phase 19: Action Processing Core
**Goal**: Users can VIP, block, undo-VIP, and unblock senders by moving messages to action folders
**Depends on**: Phase 18
**Requirements**: PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-06, PROC-09, PROC-10, RULE-01, RULE-02, RULE-03, RULE-04
**Success Criteria** (what must be TRUE):
  1. Moving a message to VIP Sender creates a sender-only skip rule and returns message to INBOX
  2. Moving a message to Block Sender creates a sender-only delete rule and moves message to Trash
  3. Moving a message to Undo VIP or Unblock Sender removes the matching rule and returns message to INBOX
  4. Created rules pass Zod validation, have UUID + descriptive name, append at end of list, and appear in disposition views
  5. Messages with unparseable From address are moved to INBOX with an error logged
  6. If a conflicting sender-only rule exists, it is removed and replaced; both removal and creation are logged
  7. If a more specific rule exists for the same sender (multi-field match), it is preserved and the action folder rule is appended after it
**Plans**: 1 plan

Plans:
- [x] 19-01-PLAN.md — TDD: ActionFolderProcessor with sender extraction, rule CRUD, conflict resolution, message routing

### Phase 20: Monitoring & Startup Recovery
**Goal**: Action folders are continuously monitored and any pending messages are processed on startup before normal operation
**Depends on**: Phase 19
**Requirements**: MON-01, MON-02, FOLD-02, FOLD-03
**Success Criteria** (what must be TRUE):
  1. Action folders are polled via STATUS checks alongside INBOX/Review monitoring
  2. Action folder processing takes priority over regular arrival routing
  3. On startup, pending messages in action folders are processed before entering normal monitoring loop
  4. Action folders are always empty after processing completes (no messages left behind)
**Plans**: 2 plans

Plans:
- [x] 20-01-PLAN.md — TDD: ActionFolderPoller class with poll/scan/always-empty logic
- [x] 20-02-PLAN.md — Wire poller into index.ts lifecycle (startup, config, shutdown)



### Phase 21: Idempotency & Edge Cases
**Goal**: Processing is resilient to duplicates, missing rules, and crash recovery scenarios
**Depends on**: Phase 20
**Requirements**: PROC-07, PROC-08
**Success Criteria** (what must be TRUE):
  1. Processing the same message twice does not create duplicate rules (idempotent check-before-create)
  2. Undo operations with no matching rule still move the message to its destination without error
  3. Crash-recovery scenario (rule created but message not yet moved) is handled correctly on restart
**Plans**: 1 plan

Plans:
- [x] 21-01-PLAN.md — TDD: Idempotency check-before-create and undo-no-match logging

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Folder Discovery | v0.3 | 2/2 | Complete | 2026-04-06 |
| 2. Tree Picker | v0.3 | 2/2 | Complete | 2026-04-07 |
| 3. Batch Filing Engine | v0.3 | 3/3 | Complete | 2026-04-08 |
| 4. Config & Cleanup | v0.3 | 2/2 | Complete | 2026-04-10 |
| 5. Frontend Polish | v0.3 | 1/1 | Complete | 2026-04-11 |
| 6. Extended Message Data | v0.4 | 4/4 | Complete | 2026-04-12 |
| 7. Extended Matchers | v0.4 | 2/2 | Complete | 2026-04-12 |
| 8. Extended Matchers UI | v0.4 | 4/4 | Complete | 2026-04-12 |
| 9. Restore Clobbered Features | v0.4 | 5/5 | Complete | 2026-04-13 |
| 10. Move Tracking | v0.4 | 4/4 | Complete | 2026-04-13 |
| 11. Pattern Detection & Proposed Rules | v0.4 | 3/3 | Complete | 2026-04-13 |
| 12. Retroactive Verification | v0.4 | 1/1 | Complete | 2026-04-20 |
| 13. Disposition Query API | v0.5 | 2/2 | Complete | 2026-04-20 |
| 14. Navigation Shell & Simple Views | v0.5 | 1/1 | Complete | 2026-04-20 |
| 15. Folder-Grouped Views | v0.5 | 1/1 | Complete | 2026-04-20 |
| 16. Inline Sender Management | v0.5 | 1/1 | Complete | 2026-04-20 |
| 17. Configuration & Folder Lifecycle | v0.6 | 2/2 | Complete    | 2026-04-20 |
| 18. Safety Predicates & Activity Log | v0.6 | 2/2 | Complete    | 2026-04-20 |
| 19. Action Processing Core | v0.6 | 1/1 | Complete    | 2026-04-20 |
| 20. Monitoring & Startup Recovery | v0.6 | 2/2 | Complete    | 2026-04-21 |
| 21. Idempotency & Edge Cases | v0.6 | 1/1 | Complete    | 2026-04-21 |
| 22. Folder Rename UI | v0.6 | 2/2 | Complete | 2026-04-20 |
| 23. Duplicate Path Audit Logging | v0.6 | 1/1 | Complete    | 2026-04-21 |
| 24. Nyquist Validation Backfill | v0.6 | 0/0 | Planned | — |

### Phase 22: Add folder rename UI to settings page with IMAP folder rename

**Goal:** Users can rename IMAP folders from the settings page with full validation and feedback
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08
**Depends on:** Phase 21
**Plans:** 2/2 plans complete

Plans:
- [x] 22-01-PLAN.md — Backend: ImapClient renameFolder, FolderCache delegation, POST /api/folders/rename with validation
- [x] 22-02-PLAN.md — Frontend: Folder Management settings card with tree picker and inline rename

### Phase 23: Duplicate Path Audit Logging

**Goal:** PROC-07 duplicate-rule path emits activity log entry for audit trail completeness
**Depends on:** Phase 21
**Requirements:** LOG-01, LOG-02
**Gap Closure:** Closes integration gap from audit (duplicate-rule path silent operation)
**Success Criteria** (what must be TRUE):
  1. When a duplicate rule is detected during action folder processing, a logActivity call is made with source 'action-folder' and appropriate rule_id/rule_name
  2. Test coverage confirms the duplicate path produces an activity log entry
**Plans:** 1/1 plans complete

Plans:
- [x] 23-01-PLAN.md — Add logActivity to duplicate branch and update idempotency tests

### Phase 24: Nyquist Validation Backfill

**Goal:** Bring phases 18-21 to Nyquist compliance with proper VALIDATION.md coverage
**Depends on:** Phase 23
**Requirements:** None (process compliance)
**Gap Closure:** Closes Nyquist tech debt from audit
**Success Criteria** (what must be TRUE):
  1. Phase 18 has nyquist_compliant: true in VALIDATION.md
  2. Phase 19 has nyquist_compliant: true in VALIDATION.md
  3. Phase 20 has nyquist_compliant: true in VALIDATION.md
  4. Phase 21 has nyquist_compliant: true in VALIDATION.md
**Plans:** 1 plan

Plans:
- [x] 23-01-PLAN.md — Add logActivity to duplicate branch and update idempotency tests
