# Roadmap: Mail Manager v0.3 — Folder Taxonomy & Batch Filing

## Overview

This milestone transforms Mail Manager from a real-time routing engine into a full email organization system. The work follows a strict dependency chain: discover the folder hierarchy from IMAP, give users a visual picker for those folders, build a batch filing engine that can reorganize thousands of existing messages, and clean up configuration gaps carried over from v0.2. The folder taxonomy layer is the foundation — everything downstream consumes it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Folder Discovery** - IMAP folder hierarchy exposed via cached API with validation
- [ ] **Phase 2: Tree Picker** - Visual folder selector replaces text input in rule editor
- [ ] **Phase 3: Batch Filing Engine** - Core engine for retroactive rule application with dry-run and cancellation
- [ ] **Phase 4: Config & Cleanup** - Editable sweep settings, per-stream archive defaults, and v0.2 bug fixes
- [ ] **Phase 5: Frontend Polish** - Fix no-match display bug, replace raw fetch with api wrapper, eliminate catch(e: any)

## Phase Details

### Phase 1: Folder Discovery
**Goal**: Users can see their IMAP folder hierarchy and get validation when selecting folders for rules
**Depends on**: Nothing (first phase)
**Requirements**: FOLD-01, FOLD-02, FOLD-03
**Success Criteria** (what must be TRUE):
  1. GET /api/folders returns the full IMAP folder hierarchy with nested structure
  2. Folder list is served from cache on repeated requests and refreshes on demand or after TTL expires
  3. Saving a rule with a nonexistent destination folder shows a warning to the user
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — FolderCache, ImapClient listFolders, folder API route (FOLD-01, FOLD-02)
- [x] 01-02-PLAN.md — Rule save folder validation warnings (FOLD-03)

### Phase 2: Tree Picker
**Goal**: Users select destination folders from a visual tree instead of typing paths by hand
**Depends on**: Phase 1
**Requirements**: PICK-01, PICK-02, PICK-03
**Success Criteria** (what must be TRUE):
  1. Rule editor modal shows an interactive folder tree instead of a text input for destination
  2. Nested folders expand and collapse to navigate the hierarchy
  3. Recently-used folders appear at the top of the picker for quick access
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Recent-folders backend endpoint and frontend API client (PICK-03)
- [x] 02-02-PLAN.md — Folder picker component, modal integration, and CSS (PICK-01, PICK-02, PICK-03)

### Phase 3: Batch Filing Engine
**Goal**: Users can apply rules retroactively to existing messages in any folder, with dry-run preview and cancellation
**Depends on**: Phase 1
**Requirements**: BATC-01, BATC-02, BATC-03, BATC-05, BATC-06
**Success Criteria** (what must be TRUE):
  1. User can select a source folder and one or more rules, then batch-file matching messages to their destinations
  2. Dry-run mode shows what would be moved without executing any IMAP operations
  3. Batch processing moves messages in chunks with per-message error isolation (one failure does not abort the job)
  4. User can cancel a running batch and it stops after the current chunk completes
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — BatchEngine core class with TDD: dry-run, chunked execution, cancellation, error isolation (BATC-01, BATC-02, BATC-03, BATC-05, BATC-06)
- [x] 03-02-PLAN.md — API routes, activity log source update, database indexing, ServerDeps wiring (BATC-01, BATC-03, BATC-05, BATC-06)
- [x] 03-03-PLAN.md — Frontend batch page: folder selection, dry-run preview, execution progress, results summary (BATC-01, BATC-05, BATC-06)

### Phase 4: Config & Cleanup
**Goal**: Users can edit sweep settings and archive defaults from the UI, and v0.2 bugs are resolved
**Depends on**: Nothing (independent of Phases 1-3)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05
**Success Criteria** (what must be TRUE):
  1. Sweep settings (intervals, age thresholds, folder names) are editable in the web UI
  2. Default archive destination is configurable separately for inbox-sourced and review-sourced messages
  3. Config reload no longer leaves a stale sweeper reference in ServerDeps
  4. User can toggle message cursor persistence on/off in settings
  5. Rules with blank names auto-generate a description from their match criteria and action
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Optional rule name schema change, behavior description generator, rule table display update (CONF-05)
- [x] 04-02-PLAN.md — Editable sweep settings card with tree pickers, stale sweeper fix, cursor toggle (CONF-01, CONF-02, CONF-03, CONF-04)

### Phase 5: Frontend Polish
**Goal**: Fix no-match group display bug in batch dry-run preview, replace raw fetch with api wrapper for cursor toggle, eliminate remaining catch(e: any) blocks
**Depends on**: Phase 3, Phase 4
**Requirements**: BATC-06 (integration fix)
**Gap Closure**: Closes tech debt from v0.3 milestone audit
**Success Criteria** (what must be TRUE):
  1. No-match group in dry-run preview renders with muted styling and "No match (stay in folder)" label, separated from match groups
  2. Cursor toggle API calls use the api wrapper object, not raw fetch()
  3. All catch blocks in app.ts use catch(e: unknown) with instanceof Error check
**Plans**: 0 plans (pending /gsd-plan-phase 5)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4
Note: Phase 4 has no dependency on Phases 2-3 and could run in parallel if inserted earlier.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Folder Discovery | 0/2 | Planning complete | - |
| 2. Tree Picker | 0/2 | Planning complete | - |
| 3. Batch Filing Engine | 0/3 | Planning complete | - |
| 4. Config & Cleanup | 0/2 | Planning complete | - |
| 5. Frontend Polish | 0/0 | Not started | - |
