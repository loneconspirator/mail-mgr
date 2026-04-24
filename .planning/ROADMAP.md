# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- ✅ **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-12 (shipped 2026-04-20)
- ✅ **v0.5 Sender Disposition Views** — Phases 13-16 (shipped 2026-04-20)
- ✅ **v0.6 Action Folders** — Phases 17-25 (shipped 2026-04-22)
- ✅ **v0.7 Sentinel Message System** — Phases 26-32 (shipped 2026-04-23)
- 🔨 **v0.8 Action Folder Safety Hardening** — Phase 33 (active)

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

<details>
<summary>✅ v0.7 Sentinel Message System (Phases 26-32) — SHIPPED 2026-04-23</summary>

- [x] Phase 26: Sentinel Store & Message Format (2/2 plans) — RFC 2822 message builder, SQLite persistence
- [x] Phase 27: IMAP Sentinel Operations (2/2 plans) — APPEND/SEARCH/DELETE extensions, startup self-test
- [x] Phase 28: Sentinel Planting & Lifecycle (2/2 plans) — Auto-planting on startup/rule-create/config-change, cleanup on untrack
- [x] Phase 29: Pipeline Guards (2/2 plans) — All 5 message processors skip sentinel messages
- [x] Phase 30: Scanning & Rename Detection (2/2 plans) — Two-tier periodic scan, rename mapping
- [x] Phase 31: Auto-Healing & Failure Handling (2/2 plans) — Rename reference updates, re-planting, INBOX notifications
- [x] Phase 32: UI Cleanup (1/1 plan) — Removed folder rename card/API (superseded by auto-healing)

Full details: [milestones/v0.7-ROADMAP.md](milestones/v0.7-ROADMAP.md)

</details>

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
| 26. Sentinel Store & Message Format | v0.7 | 2/2 | Complete | 2026-04-22 |
| 27. IMAP Sentinel Operations | v0.7 | 2/2 | Complete | 2026-04-22 |
| 28. Sentinel Planting & Lifecycle | v0.7 | 2/2 | Complete | 2026-04-22 |
| 29. Pipeline Guards | v0.7 | 2/2 | Complete | 2026-04-22 |
| 30. Scanning & Rename Detection | v0.7 | 2/2 | Complete | 2026-04-22 |
| 31. Auto-Healing & Failure Handling | v0.7 | 2/2 | Complete | 2026-04-22 |
| 32. UI Cleanup | v0.7 | 1/1 | Complete | 2026-04-22 |

## Current Milestone: v0.8 Action Folder Safety Hardening

Incident-driven hardening of the action-folder pipeline to prevent mass erroneous rule creation (Block and VIP floods) and eliminate wasteful sentinel-only polling.

### Phase 33: Action Folder Safety Hardening

**Goal:** Fix processor bugs (pre-move logging, duplicate fall-through), add sentinel-aware polling skip, and diagnostic logging
**Depends on:** v0.7 Sentinel Message System
**Plans:** 2/2 plans complete

Plans:
- [x] 33-01-PLAN.md — Fix processor bugs (D-05 post-move logging, D-06 duplicate early return) and add diagnostic logging (D-07)
- [x] 33-02-PLAN.md — Add sentinel-aware skip to poller (D-01 skip on messages=1, D-02 skip on messages=0)
