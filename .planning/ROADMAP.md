# Roadmap: Mail Manager

## Milestones

- ✅ **v0.1 MVP** — IMAP monitoring, pattern-matching rules, move actions, web UI
- ✅ **v0.2 Review System** — Review folder, sweep lifecycle, multi-folder monitoring
- ✅ **v0.3 Folder Taxonomy & Batch Filing** — Phases 1-5 (shipped 2026-04-11)
- 🚧 **v0.4 Extended Matchers & Behavioral Learning** — Phases 6-10 (in progress)

## Phases

<details>
<summary>v0.3 Folder Taxonomy & Batch Filing (Phases 1-5) — SHIPPED 2026-04-11</summary>

- [x] Phase 1: Folder Discovery (2/2 plans) — IMAP folder hierarchy, cached API, validation warnings
- [x] Phase 2: Tree Picker (2/2 plans) — Visual folder selector, expand/collapse, recent folders
- [x] Phase 3: Batch Filing Engine (3/3 plans) — Dry-run preview, chunked execution, cancellation
- [x] Phase 4: Config & Cleanup (2/2 plans) — Sweep settings UI, cursor toggle, optional rule names
- [x] Phase 5: Frontend Polish (1/1 plan) — No-match fix, api wrapper migration, type-safe catches

Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md)

</details>

### v0.4 Extended Matchers & Behavioral Learning

- [ ] **Phase 6: Extended Message Data** - Foundation: envelope recipient extraction, header visibility classification, auto-discovery, versioned migrations
- [ ] **Phase 7: Extended Matchers** - Wire envelope recipient, header visibility, and read status into matchRule() and config schema
- [ ] **Phase 8: Extended Matchers UI** - Rule editor updates for new match fields and IMAP settings auto-discovery controls
- [ ] **Phase 9: Move Tracking** - UID snapshot diffing to detect user-initiated moves and log signals to SQLite
- [ ] **Phase 10: Pattern Detection & Proposed Rules** - Statistical analysis on move signals, proposed rules API and UI, approve/modify/dismiss workflow

## Phase Details

### Phase 6: Extended Message Data
**Goal**: EmailMessage carries envelope recipient and header visibility data, fetched efficiently from IMAP, with auto-discovery of the correct envelope header and versioned schema migrations for all future database changes
**Depends on**: Nothing (first phase of v0.4)
**Requirements**: MATCH-01, MATCH-02, MATCH-06
**Success Criteria** (what must be TRUE):
  1. System probes a sample of recent messages on IMAP connect and identifies the correct envelope recipient header (e.g., X-Delivered-To on Fastmail), persisting the result in config
  2. When auto-discovery finds no usable envelope header, envelope recipient and header visibility fields are marked unavailable and rules using them are skipped during evaluation
  3. Auto-discovery re-runs automatically when IMAP server details change and can be triggered manually
  4. EmailMessage instances populated by Monitor, Sweep, and Batch consumers include envelope recipient and visibility fields derived from fetched headers
  5. Database schema changes use versioned transactional migrations instead of try/catch ALTER TABLE
**Plans:** 4 plans
Plans:
- [x] 06-01-PLAN.md — Versioned migration system replacing try/catch ALTER TABLE
- [x] 06-02-PLAN.md — Extended message types, header parsing, visibility classification, conditional fetch
- [x] 06-03-PLAN.md — Auto-discovery module and lifecycle integration
- [x] 06-04-PLAN.md — Gap closure: wire envelopeHeader into Monitor parseMessage call

### Phase 7: Extended Matchers
**Goal**: Users can write rules that match on envelope recipient, header visibility, and read status, with all three fields integrated into the existing first-match-wins evaluation pipeline
**Depends on**: Phase 6
**Requirements**: MATCH-03, MATCH-04, MATCH-05
**Success Criteria** (what must be TRUE):
  1. User can create a rule with an envelope recipient glob pattern (including +tag variants) and it matches messages delivered to that address
  2. User can create a rule that matches on header visibility (direct, cc, bcc, list) as a multi-select condition
  3. User can create a rule that matches on read/unread status at evaluation time
  4. Rules using new match fields work identically in Monitor (live), Sweep (review), and Batch (retroactive) contexts
**Plans:** 2 plans
Plans:
- [x] 07-01-PLAN.md — Schema + matcher extension: deliveredTo, visibility, readStatus fields
- [x] 07-02-PLAN.md — Evaluator skip logic for envelope-unavailable rules

### Phase 8: Extended Matchers UI
**Goal**: Rule editor exposes the new match fields with appropriate controls and the IMAP settings page shows auto-discovery status
**Depends on**: Phase 7
**Requirements**: UI-01, UI-03
**Success Criteria** (what must be TRUE):
  1. Rule editor shows an envelope recipient glob input field that behaves like the existing sender glob input
  2. Rule editor shows a header visibility multi-select with options for direct, cc, bcc, and list
  3. Rule editor shows a read status toggle for matching read or unread messages
  4. IMAP settings page displays the discovered envelope recipient header name and provides a button to re-run auto-discovery
**Plans:** 2 plans
Plans:
- [ ] 08-01-PLAN.md — Restore discovery backend, add envelopeHeader to config schema, create envelope API endpoints
- [ ] 08-02-PLAN.md — Rule editor new match fields, behavior descriptions, settings discovery section
**UI hint**: yes

### Phase 9: Move Tracking
**Goal**: System detects when the user manually moves messages out of Inbox or Review and logs structured signal data for pattern analysis
**Depends on**: Phase 6
**Requirements**: LEARN-01, LEARN-02
**Success Criteria** (what must be TRUE):
  1. System periodically scans Inbox and Review folders and detects messages that disappeared since the last scan
  2. Detected moves are cross-referenced against the activity log by Message-ID to exclude system-initiated moves (Monitor, Sweep, Batch)
  3. For each confirmed user move, sender, envelope recipient, list headers, subject, read status, visibility, source folder, and destination folder are logged to the move_signals table
  4. Move tracking runs continuously alongside Monitor without interfering with message processing
**Plans**: TBD

### Phase 10: Pattern Detection & Proposed Rules
**Goal**: System analyzes accumulated move signals, identifies repeating patterns, and surfaces them as proposed rules that the user can approve, modify, or dismiss
**Depends on**: Phase 9
**Requirements**: LEARN-03, LEARN-04, LEARN-05, UI-02
**Success Criteria** (what must be TRUE):
  1. System identifies repeating move patterns (same sender/domain to same destination) from move signals using configurable thresholds (minimum count, time span, burst suppression)
  2. Proposed rules appear in the UI with signal count, plain-language confidence description, and example messages
  3. User can approve a proposed rule (creating a real rule in the active ruleset), modify it before approving, or dismiss it
  4. Dismissed patterns are suppressed from future proposals
  5. Approved rules integrate with existing config hot-reload so they take effect immediately
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9 -> 10
Note: Phases 7-8 (matchers track) and Phase 9 (learning track) are independent after Phase 6. Execution is serial but either track could go first.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Folder Discovery | v0.3 | 2/2 | Complete | 2026-04-06 |
| 2. Tree Picker | v0.3 | 2/2 | Complete | 2026-04-07 |
| 3. Batch Filing Engine | v0.3 | 3/3 | Complete | 2026-04-08 |
| 4. Config & Cleanup | v0.3 | 2/2 | Complete | 2026-04-10 |
| 5. Frontend Polish | v0.3 | 1/1 | Complete | 2026-04-11 |
| 6. Extended Message Data | v0.4 | 3/4 | Gap closure | - |
| 7. Extended Matchers | v0.4 | 2/2 | Complete | - |
| 8. Extended Matchers UI | v0.4 | 0/2 | Planned | - |
| 9. Move Tracking | v0.4 | 0/? | Not started | - |
| 10. Pattern Detection & Proposed Rules | v0.4 | 0/? | Not started | - |
