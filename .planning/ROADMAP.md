# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- ✅ **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-12 (shipped 2026-04-20)
- ✅ **v0.5 Sender Disposition Views** — Phases 13-16 (shipped 2026-04-20)
- ✅ **v0.6 Action Folders** — Phases 17-25 (shipped 2026-04-22)

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

<details>
<summary>✅ v0.6 Action Folders (Phases 17-25) — SHIPPED 2026-04-22</summary>

- [x] Phase 17: Configuration & Folder Lifecycle (2/2 plans) — Schema, config validation, IMAP folder auto-creation
- [x] Phase 18: Safety Predicates & Activity Log (2/2 plans) — MoveTracker exclusions, action registry, logging extension
- [x] Phase 19: Action Processing Core (1/1 plan) — Sender extraction, rule CRUD, conflict resolution, message routing
- [x] Phase 20: Monitoring & Startup Recovery (2/2 plans) — Poll integration, startup pre-scan, always-empty invariant
- [x] Phase 21: Idempotency & Edge Cases (1/1 plan) — Duplicate prevention, undo-with-no-match, crash recovery
- [x] Phase 22: Folder Rename UI (2/2 plans) — IMAP folder rename on settings page with validation
- [x] Phase 23: Duplicate Path Audit Logging (1/1 plan) — Activity log for duplicate-rule detection path
- [x] Phase 24: Nyquist Validation Backfill (2/2 plans) — Phases 18-21 brought to Nyquist compliance
- [x] Phase 25: Action Folder Config API & Frontend Fix (3/4 plans) — Config API, dynamic prefix, 1 plan skipped (superseded by v0.7)

Full details: [milestones/v0.6-ROADMAP.md](milestones/v0.6-ROADMAP.md)

</details>

### v0.7 Sentinel Message System (In Progress)

**Milestone Goal:** Use IMAP messages as persistent, relocatable tracking beacons to detect folder renames/deletions and automatically maintain all folder references.

- [x] **Phase 26: Sentinel Store & Message Format** - SQLite persistence and message construction for sentinel tracking beacons (completed 2026-04-22)
- [x] **Phase 27: IMAP Sentinel Operations** - APPEND, SEARCH-by-header, DELETE capabilities and startup self-test (completed 2026-04-22)
- [ ] **Phase 28: Sentinel Planting & Lifecycle** - Plant sentinels on startup/rule-create/config-change, clean up on untrack
- [ ] **Phase 29: Pipeline Guards** - Every message processor skips sentinel messages
- [ ] **Phase 30: Scanning & Rename Detection** - Periodic scan locates sentinels across folders to detect renames
- [ ] **Phase 31: Auto-Healing & Failure Handling** - Update references on rename, re-plant on deletion, notify on folder loss
- [ ] **Phase 32: UI Cleanup** - Remove folder rename card and API from settings page

## Phase Details

### Phase 26: Sentinel Store & Message Format
**Goal**: Sentinel identity and persistence exist so that planting and scanning have a foundation to work with
**Depends on**: Nothing (first phase of v0.7)
**Requirements**: SENT-02, SENT-03, SENT-05
**Success Criteria** (what must be TRUE):
  1. A sentinel message can be constructed with unique Message-ID, X-Mail-Mgr-Sentinel header, Seen flag, and descriptive subject/body
  2. Sentinel-to-folder mappings (Message-ID, folder path, folder purpose) can be persisted and queried in SQLite
  3. The sentinel format builder refuses to create a sentinel for INBOX
  4. Sentinel body text explains the message's purpose to the user (including action folder descriptions)
**Plans:** 2/2 plans complete
Plans:
- [x] 26-01-PLAN.md — TDD sentinel message format builder (format.ts)
- [x] 26-02-PLAN.md — TDD SentinelStore with migration and barrel export (store.ts, migrations, index.ts)

### Phase 27: IMAP Sentinel Operations
**Goal**: The system can plant, find, and remove sentinel messages on the IMAP server
**Depends on**: Phase 26
**Requirements**: SENT-06, SENT-04
**Success Criteria** (what must be TRUE):
  1. Startup self-test confirms the IMAP server supports SEARCH by custom header before any planting occurs
  2. A sentinel message can be APPENDed to a specified folder with correct headers and Seen flag
  3. A sentinel can be located in a folder by searching for its Message-ID header
  4. A sentinel can be deleted from a folder by UID
**Plans:** 2/2 plans complete
Plans:
- [x] 27-01-PLAN.md — TDD ImapClient APPEND/SEARCH/DELETE extensions
- [x] 27-02-PLAN.md — TDD sentinel IMAP operations (imap-ops.ts) and startup self-test

### Phase 28: Sentinel Planting & Lifecycle
**Goal**: Sentinels are automatically planted in every tracked folder and cleaned up when folders are no longer tracked
**Depends on**: Phase 27
**Requirements**: SENT-01, SENT-07
**Success Criteria** (what must be TRUE):
  1. On startup, every tracked folder (rule targets, action folders, sweep targets) has a sentinel planted if one does not already exist
  2. When a rule is created or config change adds a new folder reference, a sentinel is planted in that folder
  3. When a rule is deleted or config change removes a folder reference, the sentinel is deleted from IMAP and the mapping removed from SQLite
  4. INBOX never receives a sentinel regardless of how many rules reference it
**Plans:** 2 plans
Plans:
- [ ] 28-01-PLAN.md — TDD collectTrackedFolders and reconcileSentinels (lifecycle.ts)
- [ ] 28-02-PLAN.md — Wire lifecycle into startup sequence and config change handlers

### Phase 29: Pipeline Guards
**Goal**: No message processor in the system ever acts on a sentinel message
**Depends on**: Phase 26
**Requirements**: GUARD-01, GUARD-02, GUARD-03, GUARD-04, GUARD-05
**Success Criteria** (what must be TRUE):
  1. Action folder processor encounters a sentinel message and ignores it (does not extract sender or create rules)
  2. Monitor rule engine encounters a sentinel message and skips evaluation (does not move or categorize it)
  3. Review sweeper encounters a sentinel message and leaves it in place (does not archive or delete it)
  4. Batch filing engine encounters a sentinel message and excludes it from processing
  5. Move tracker encounters a sentinel message and does not log it as a user-initiated move
**Plans**: TBD

### Phase 30: Scanning & Rename Detection
**Goal**: The system periodically verifies sentinel locations and detects when folders have been renamed
**Depends on**: Phase 28, Phase 29
**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04
**Success Criteria** (what must be TRUE):
  1. A periodic scan (configurable interval, default 5 min) checks each sentinel's expected folder via IMAP SEARCH by Message-ID
  2. When a sentinel is not found in its expected folder, a deep scan searches all IMAP folders to find it
  3. Scanning runs on its own independent timer and does not block or significantly delay INBOX monitoring
  4. When a sentinel is found in a different folder than recorded, the scan reports the old-path to new-path mapping
**Plans**: TBD

### Phase 31: Auto-Healing & Failure Handling
**Goal**: When folder renames or deletions are detected, the system automatically repairs its configuration or notifies the user
**Depends on**: Phase 30
**Requirements**: HEAL-01, HEAL-02, HEAL-03, HEAL-04, FAIL-01, FAIL-02, FAIL-03
**Success Criteria** (what must be TRUE):
  1. When a sentinel is found in a renamed folder, all config and rule references to the old path are atomically updated to the new path without triggering full pipeline rebuilds
  2. When a sentinel is missing but its folder still exists, the sentinel is re-planted with a new Message-ID and the mapping updated
  3. When both sentinel and folder are gone, associated rules/behaviors are disabled and an explanatory notification is APPENDed to INBOX
  4. The system does not auto-recreate deleted folders
  5. All healing events (rename detected, references updated, sentinel re-planted, folder lost) are recorded in the activity log
**Plans**: TBD

### Phase 32: UI Cleanup
**Goal**: The settings page no longer offers manual folder rename since sentinel auto-healing replaces it
**Depends on**: Phase 31
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. The folder rename card is no longer visible on the settings page
  2. The folder rename API endpoint is removed or returns a deprecation error
**Plans**: TBD
**UI hint**: yes

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
| 17. Configuration & Folder Lifecycle | v0.6 | 2/2 | Complete | 2026-04-20 |
| 18. Safety Predicates & Activity Log | v0.6 | 2/2 | Complete | 2026-04-20 |
| 19. Action Processing Core | v0.6 | 1/1 | Complete | 2026-04-20 |
| 20. Monitoring & Startup Recovery | v0.6 | 2/2 | Complete | 2026-04-21 |
| 21. Idempotency & Edge Cases | v0.6 | 1/1 | Complete | 2026-04-21 |
| 22. Folder Rename UI | v0.6 | 2/2 | Complete | 2026-04-20 |
| 23. Duplicate Path Audit Logging | v0.6 | 1/1 | Complete | 2026-04-21 |
| 24. Nyquist Validation Backfill | v0.6 | 2/2 | Complete | 2026-04-21 |
| 25. Action Folder Config API & Frontend Fix | v0.6 | 3/4 | Complete | 2026-04-21 |
| 26. Sentinel Store & Message Format | v0.7 | 2/2 | Complete    | 2026-04-22 |
| 27. IMAP Sentinel Operations | v0.7 | 2/2 | Complete    | 2026-04-22 |
| 28. Sentinel Planting & Lifecycle | v0.7 | 0/0 | Not started | - |
| 29. Pipeline Guards | v0.7 | 0/0 | Not started | - |
| 30. Scanning & Rename Detection | v0.7 | 0/0 | Not started | - |
| 31. Auto-Healing & Failure Handling | v0.7 | 0/0 | Not started | - |
| 32. UI Cleanup | v0.7 | 0/0 | Not started | - |
