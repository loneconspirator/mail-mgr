# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- ✅ **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-12 (shipped 2026-04-20)
- ✅ **v0.5 Sender Disposition Views** — Phases 13-16 (shipped 2026-04-20)

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
