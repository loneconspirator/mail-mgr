# Requirements: Mail Manager v0.3 — Folder Taxonomy & Batch Filing

**Defined:** 2026-04-06
**Core Value:** Dramatically reduce inbox volume without losing visibility — messages that need attention stay in Inbox, everything else is automatically routed, reviewed in batches, and archived.

## v1 Requirements

### Folder Discovery

- [ ] **FOLD-01**: System discovers IMAP folder hierarchy via `listTree()` and exposes it at `GET /api/folders`
- [ ] **FOLD-02**: Folder list is cached server-side with configurable TTL and manual refresh endpoint
- [ ] **FOLD-03**: Rule save validates destination folder against cached folder list (warn, not block)
- [ ] **FOLD-04**: Folder statistics show message counts per folder (via IMAP STATUS)

### Tree Picker

- [ ] **PICK-01**: Tree picker component replaces text input for folder selection in rule editor
- [ ] **PICK-02**: Tree supports expand/collapse for nested folder hierarchy
- [ ] **PICK-03**: Recently-used folders surfaced at top of picker (derived from activity log)

### Batch Filing

- [ ] **BATC-01**: User can batch-file messages in a selected source folder against one, multiple, or all rules
- [ ] **BATC-02**: Batch evaluation uses sweep-style rule matching (first-match-wins across selected rules) without age constraints
- [ ] **BATC-03**: Batch processing uses chunked IMAP moves with per-message error isolation
- [ ] **BATC-04**: Real-time progress reported to UI via Server-Sent Events
- [ ] **BATC-05**: User can cancel a running batch (stops after current chunk completes)
- [ ] **BATC-06**: Dry-run mode previews what a batch would do without executing moves
- [ ] **BATC-07**: Batch summary report shown after completion (moved/skipped/errored counts by destination)

### Config & Cleanup

- [ ] **CONF-01**: Sweep settings editable in UI (intervals, age thresholds, folder names)
- [ ] **CONF-02**: Default archive destination configurable per-stream (inbox-sourced vs review-sourced)
- [ ] **CONF-03**: Fix stale sweeper reference in ServerDeps after config reload
- [ ] **CONF-04**: Message cursor toggle — settings option to disable lastUid persistence for full re-evaluation
- [ ] **CONF-05**: Rule name optional — auto-generate description from match criteria + action when name is blank

## v2 Requirements

### Tree Picker Enhancements

- **PICK-04**: Search/filter in folder picker (type to narrow visible folders)
- **PICK-05**: Visual distinction for special-use folders (Trash, Sent, Drafts) in picker

### Batch Filing Enhancements

- **BATC-08**: Batch filing undo (move messages back to source folder)
- **BATC-09**: Scheduled batch filing (run batch on a cron schedule)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Folder creation/deletion from app | Folder structure owned by mail client, not this app |
| Folder retirement automation | User handles manually in mail client |
| Drag-and-drop folder reorganization | Mail client feature, not rule engine feature |
| Real-time folder sync (IMAP NOTIFY) | Overkill for single-user tool with rare folder changes |
| Batch filing rollback/undo | IMAP MOVE is not transactional; dry-run is the safety valve |
| Concurrent batch operations | Single IMAP connection; one batch at a time |
| LLM classification | Tier 4, future milestone |
| Learning from behavior | Tier 5, future milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOLD-01 | Phase 1 | Pending |
| FOLD-02 | Phase 1 | Pending |
| FOLD-03 | Phase 1 | Pending |
| FOLD-04 | Phase 4 | Pending |
| PICK-01 | Phase 2 | Pending |
| PICK-02 | Phase 2 | Pending |
| PICK-03 | Phase 2 | Pending |
| BATC-01 | Phase 3 | Pending |
| BATC-02 | Phase 3 | Pending |
| BATC-03 | Phase 3 | Pending |
| BATC-04 | Phase 4 | Pending |
| BATC-05 | Phase 3 | Pending |
| BATC-06 | Phase 3 | Pending |
| BATC-07 | Phase 4 | Pending |
| CONF-01 | Phase 5 | Pending |
| CONF-02 | Phase 5 | Pending |
| CONF-03 | Phase 5 | Pending |
| CONF-04 | Phase 5 | Pending |
| CONF-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-04-06*
*Last updated: 2026-04-06 after roadmap creation*
