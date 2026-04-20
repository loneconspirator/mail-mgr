# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- ✅ **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-12 (shipped 2026-04-20)
- 🚧 **v0.5 Sender Disposition Views** — Phases 13-16 (in progress)

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

### v0.5 Sender Disposition Views (In Progress)

**Milestone Goal:** Surface sender-centric filtered views of routing rules organized by disposition, with inline add/remove management.

- [x] **Phase 13: Disposition Query API** - Backend endpoint to filter sender-only rules by disposition type (gap closure in progress) (completed 2026-04-20)
- [ ] **Phase 14: Navigation Shell & Simple Views** - Tab navigation and Priority/Blocked sender views
- [ ] **Phase 15: Folder-Grouped Views** - Reviewed and Archived senders, both grouped by destination folder
- [ ] **Phase 16: Inline Sender Management** - Add/remove senders from views, folder picker for archived, link to rule editor

## Phase Details

### Phase 13: Disposition Query API
**Goal**: Backend serves filtered lists of sender-only rules grouped by disposition type
**Depends on**: Nothing (first phase in v0.5; builds on existing rules API)
**Requirements**: VIEW-05
**Success Criteria** (what must be TRUE):
  1. API endpoint returns rules filtered to sender-only (single sender match criterion, no other matchers)
  2. API can filter by disposition type (skip, delete, review, move) and returns only matching rules
  3. Rules with multiple match criteria (recipient, visibility, subject, etc.) are excluded from results
**Plans**: 2 plans
Plans:
- [x] 13-01-PLAN.md — TDD isSenderOnly predicate, GET /api/dispositions route, server registration
- [x] 13-02-PLAN.md — Gap closure: complete isSenderOnly for all 6 match fields, code review fixes

### Phase 14: Navigation Shell & Simple Views
**Goal**: Users can navigate to disposition views and see their Priority and Blocked sender lists
**Depends on**: Phase 13
**Requirements**: VIEW-01, VIEW-02, NAV-01, NAV-02
**Success Criteria** (what must be TRUE):
  1. User sees tabs or sections for each disposition view alongside the main rule list
  2. Main rule list continues to show all rules including sender-only ones
  3. Priority Senders view shows all sender-only rules with "leave in inbox" action
  4. Blocked Senders view shows all sender-only rules with "delete" action
**Plans**: 1 plan
Plans:
- [ ] 14-01-PLAN.md — Dispositions API client, Priority/Blocked nav tabs, sender list views with empty/error states
**UI hint**: yes

### Phase 15: Folder-Grouped Views
**Goal**: Users can see their Reviewed and Archived senders, both organized by destination folder
**Depends on**: Phase 14
**Requirements**: VIEW-03, VIEW-04
**Success Criteria** (what must be TRUE):
  1. Reviewed Senders view shows all sender-only rules with "route to Review" action, grouped by destination folder
  2. Archived Senders view shows all sender-only rules with "move to folder" action, grouped by destination folder
  3. Each entry displays the sender pattern and its target folder
  4. Reviewed Senders uses default Review folder when rule doesn't specify explicit destination
  5. Both views share the same folder-grouped display pattern
**Plans**: TBD
**UI hint**: yes

### Phase 16: Inline Sender Management
**Goal**: Users can add and remove senders directly from disposition views without opening the rule editor
**Depends on**: Phase 15
**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04
**Success Criteria** (what must be TRUE):
  1. User can add a sender to any disposition view, which creates a sender-only rule with the correct action
  2. User can remove a sender from any disposition view, which deletes the underlying rule
  3. When adding to Archived Senders, user can select a destination folder via the existing tree picker
  4. Each entry in a disposition view has a link/button to open its full rule in the rule editor
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 13 → 14 → 15 → 16

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
| 13. Disposition Query API | v0.5 | 2/2 | Complete    | 2026-04-20 |
| 14. Navigation Shell & Simple Views | v0.5 | 0/1 | Planning | - |
| 15. Archived Senders View | v0.5 | 0/? | Not started | - |
| 16. Inline Sender Management | v0.5 | 0/? | Not started | - |
