# Mail Manager

## What This Is

An automated email organization system that monitors IMAP mailboxes, routes messages using pattern-matching rules, and manages a two-stream intake model (Inbox for action items, Review for batch processing). Includes retroactive batch filing to reorganize existing messages with dry-run preview. Sender disposition views surface filtered sender lists by routing action (Priority, Blocked, Reviewed, Archived) with inline add/remove management. Designed for individual use — one instance per mailbox, any IMAP provider. Web UI provides rule management with visual folder pickers, editable sweep settings, batch filing, activity logging, sender disposition views, and system status.

## Core Value

Dramatically reduce inbox volume without losing visibility — messages that need attention stay in Inbox, everything else is automatically routed, reviewed in batches, and archived.

## Requirements

### Validated

- ✓ IMAP monitoring with UID-based message tracking — v0.1
- ✓ Pattern-matching rules (sender/recipient/subject globs, first-match-wins) — v0.1
- ✓ Move-to-folder action with activity logging — v0.1
- ✓ SQLite-backed activity log and rule storage — v0.1
- ✓ Web UI for rule CRUD, activity viewing, settings management — v0.1
- ✓ Four routing dispositions: move, review, skip (displayed as "Leave in Place"), delete — v0.2
- ✓ Review folder with configurable name — v0.2
- ✓ Review lifecycle sweeps (read items >7 days, unread >14 days auto-archived) — v0.2
- ✓ Multi-folder monitoring (INBOX + Review) — v0.2
- ✓ Sweep destination resolution: re-evaluate against move/delete rules, then review rule's folder hint, then global default — v0.2
- ✓ Trash folder resolved via IMAP special-use attribute with config fallback — v0.2
- ✓ Review status API and UI panel — v0.2
- ✓ Per-message error isolation in processing loop — v0.2
- ✓ Folder taxonomy discovery from IMAP server with cached API — v0.3
- ✓ Tree picker UI for folder selection with expand/collapse and recent folders — v0.3
- ✓ Retroactive batch filing with dry-run preview, chunked execution, and cancellation — v0.3
- ✓ Sweep settings editable in UI with tree pickers for folder selection — v0.3
- ✓ Default archive folder configurable via sweep settings — v0.3
- ✓ Stale sweeper reference fixed on config reload — v0.3
- ✓ Cursor toggle for conditional UID persistence — v0.3
- ✓ Optional rule names with auto-generated behavior descriptions — v0.3
- ✓ Envelope recipient matching (Delivered-To/X-Original-To extraction, glob syntax, +tag support) — v0.4
- ✓ Header visibility matching (direct/cc/bcc/list single-select classification from To/CC/List-Id headers) — v0.4
- ✓ Read status matching (read/unread at evaluation time) — v0.4
- ✓ UI updates for new match fields (envelope recipient glob, header visibility select, read status toggle) — v0.4
- ✓ Move tracking on Inbox + Review (periodic folder scan, signal logging to SQLite) — v0.4
- ✓ Pattern detection (statistical analysis on logged moves, threshold-based candidate identification) — v0.4
- ✓ Proposed rules (UI for approving, modifying, or dismissing learned patterns) — v0.4
- ✓ Disposition query API filtering sender-only rules by type — v0.5
- ✓ Navigation tabs for disposition views alongside main rule list — v0.5
- ✓ Priority and Blocked sender views (flat list by disposition) — v0.5
- ✓ Reviewed and Archived sender views (folder-grouped accordion layout) — v0.5
- ✓ Inline sender add/remove from disposition views without rule editor — v0.5
- ✓ Folder picker for adding senders to Archived view — v0.5
- ✓ Action folder prefix and folder names configurable with sensible defaults — v0.6 Phase 17
- ✓ Action folders can be enabled/disabled via config — v0.6 Phase 17
- ✓ Poll interval is configurable — v0.6 Phase 17
- ✓ System creates Actions/ folder hierarchy on startup if folders don't exist — v0.6 Phase 17
- ✓ Action folder operations logged with source = 'action-folder' and isSystemMove recognition — v0.6 Phase 18
- ✓ Activity log includes rule_id/rule_name for action-folder entries — v0.6 Phase 18
- ✓ Action types defined in declarative registry pattern with reusable sender-rule utilities — v0.6 Phase 18
- ✓ Action folder processor creates/removes sender rules and moves messages to destinations — v0.6 Phase 19
- ✓ Sender extraction from From header with lowercase bare email normalization — v0.6 Phase 19
- ✓ Conflicting sender-only rules detected and replaced with activity logging — v0.6 Phase 19
- ✓ More specific multi-field rules preserved during action folder processing — v0.6 Phase 19
- ✓ Action folder monitoring via poll-based STATUS checks alongside INBOX/Review — v0.6 Phase 20
- ✓ Startup pre-scan processes pending action folder messages before normal monitoring — v0.6 Phase 20
- ✓ Action folders always empty after processing (always-empty invariant) — v0.6 Phase 20
- ✓ Idempotent action folder processing (duplicate rule prevention via check-before-create) — v0.6 Phase 21
- ✓ Undo operations with no matching rule still move message to destination without error — v0.6 Phase 21
- ✓ Duplicate-rule detection path emits activity log entry for audit trail completeness — v0.6 Phase 23
- ✓ Action folder config exposed via web API (GET/PUT /api/config/action-folders) — v0.6 Phase 25
- ✓ Frontend rename guard reads action folder prefix from config API instead of hardcoding — v0.6 Phase 25
- ✓ Config changes via API trigger poller rebuild with updated folder paths — v0.6 Phase 25
- ✓ All message processors (action folder, monitor, sweeper, batch, tracker) skip sentinel messages — v0.7 Phase 29
- ✓ Sentinel detection via shared isSentinel() utility checking X-Mail-Mgr-Sentinel header — v0.7 Phase 29
- ✓ IMAP fetch always includes sentinel header for detection regardless of envelopeHeader config — v0.7 Phase 29
- ✓ Periodic scan checks sentinel locations via IMAP SEARCH with configurable interval (default 5 min) — v0.7 Phase 30
- ✓ Deep scan searches all IMAP folders when sentinel not found in expected location — v0.7 Phase 30
- ✓ Scan reports old-path to new-path mapping when sentinel found in different folder (rename detection) — v0.7 Phase 30
- ✓ Auto-healing folder references when sentinel found in different folder — v0.7 Phase 31
- ✓ Re-planting sentinels when deleted but folder still exists — v0.7 Phase 31
- ✓ Failure notification to INBOX when both sentinel and folder are gone — v0.7 Phase 31
- ✓ All healing events recorded in activity log with sentinel source — v0.7 Phase 31
- ✓ Folder rename card removed from settings page (superseded by sentinel auto-healing) — v0.7 Phase 32
- ✓ Folder rename API endpoint removed — v0.7 Phase 32

### Active

- Sentinel message format with unique headers planted in every tracked folder — partially validated v0.7 Phase 26 (format builder + SQLite store), Phase 27 (IMAP APPEND/SEARCH/DELETE operations + self-test), Phase 28 (lifecycle planting + cleanup on config changes)
- Message-ID based mapping stored alongside folder purpose — partially validated v0.7 Phase 26, Phase 27 (IMAP operations layer complete), Phase 28 (reconciliation logic + startup wiring)

## Current Milestone: v0.7 Sentinel Message System

**Goal:** Use IMAP messages as persistent, relocatable tracking beacons to detect folder renames/deletions and automatically maintain all folder references.

**Target features:**
- Sentinel message core (format, planting, discovery, Message-ID storage)
- Folder tracking integration (wire sentinels into action folders, rule targets, sweep targets)
- Rename detection and auto-healing (periodic scan, reference update)
- Failure detection and INBOX notification
- Settings UI cleanup (remove folder rename card)

### Out of Scope

- Folder creation/deletion from this app's UI — user manages folder structure in mail client
- Folder retirement (moving to zz_old/) — handled manually in mail client
- LLM classification — future milestone
- Review digest notifications — future milestone
- Multi-account support — future milestone
- Mobile-responsive UI — future milestone
- Auto-apply learned rules without user approval — anti-feature, system must never change routing without explicit confirmation
- CONDSTORE/QRESYNC for move detection — research confirmed these track flag changes only, not cross-folder moves

## Context

- **Runtime:** Node.js / TypeScript, compiled with tsc
- **IMAP server:** Any standard IMAP provider (tested with Fastmail)
- **Mail client:** Any folder-based mail client (Mac Mail, Thunderbird, etc.)
- **Database:** SQLite via better-sqlite3
- **Web UI:** Vanilla HTML/CSS/JS SPA served by Fastify
- **Testing:** Vitest with 700+ tests (unit + integration)
- **Codebase:** ~10,000 LOC TypeScript across 50+ source files
- **Architecture:** Monitor loop polls IMAP, evaluates rules, executes actions, logs activity. Sweep runs periodically on Review folder. BatchEngine applies rules retroactively with chunked execution. Web server exposes REST API for UI.
- **Key insight:** Folder structure is primarily owned by the mail client/IMAP server. The system discovers what folders exist and uses them. Exception: Action Folders (v0.6) creates a dedicated `Actions/` hierarchy for drag-to-act functionality.
- **Design assumption:** Users may have years of accumulated mail with inconsistent organization. The folder taxonomy works with what exists, not imposing a new structure.

## Constraints

- **IMAP-only:** No message header modification, no flags beyond standard IMAP flags. Organization is folder placement only.
- **Folder-based clients:** Must work within folder-based mail clients (Mac Mail, Thunderbird, etc.). No tags, labels, or virtual folders.
- **Single instance:** No auth, no multi-tenancy. One instance per mailbox.
- **Batch filing scale:** Must handle applying rules to folders with thousands of messages. Needs progress reporting and the ability to cancel mid-run.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Folder taxonomy discovered from server, not managed in app | User manages folders in Mac Mail; app should reflect reality, not duplicate management | ✓ Good |
| Tree picker for folder selection | Current text input doesn't show available folders; visual hierarchy aids rule creation | ✓ Good |
| Retroactive batch filing included in Tier 3 | Users need to reorganize existing mail into taxonomy — critical for large accumulated mailboxes | ✓ Good |
| v0.2 cleanup folded into Tier 3 | Sweep settings UI and stale sweeper ref are small fixes that belong with the next milestone | ✓ Good |
| Apply full ruleset in batch (no per-rule selection) | Matches how Monitor works; "all rules" satisfies "one, multiple, or all" | ✓ Good |
| Narrowed CONF-02 to single archive folder | Inbox has no archive fallback; unmatched stay in INBOX; only review needs configurable archive | ✓ Good |
| First-match-wins rule evaluation | Simple, predictable, easy to reason about ordering | ✓ Good |
| SQLite for all persistence | Single-user system, no need for a database server | ✓ Good |
| Vanilla JS frontend | No build tooling needed, fast iteration, simple deployment | ✓ Good |
| Batch Progress UI phase dropped | SSE streaming, per-destination summaries, folder stats are gold plating — polling-based progress is sufficient | ✓ Good |
| Envelope header auto-discovery over user config | Probing common headers (Delivered-To, X-Original-To, etc.) eliminates manual setup | ✓ Good |
| Header visibility as single-select not multi-select | Simpler UX, one message can only be one visibility type | ✓ Good |
| Versioned migrations replacing try/catch ALTER TABLE | Reliable schema evolution, transactional safety | ✓ Good |
| UID snapshot diffing for move detection | Cross-references activity log to exclude system moves; no IMAP extension needed | ✓ Good |
| Separate mark-approved endpoint from approve | Prevents duplicate rule creation in Modify flow | ✓ Good |
| Read-modify-write transaction for proposal upsert | COALESCE in expression index proved unreliable | ✓ Good |
| Retroactive verification for orphaned phases | Phase 12 formally verified code that existed but lacked audit trail | ✓ Good |
| "Skip" displayed as "Leave in Place" in UI | "Skip" was ambiguous — "Leave in Place" clearly communicates the email stays untouched. Backend/API/storage retains `skip` as the canonical value; only UI display text changed. | ✓ Good |
| Disposition views are query-based filters, not separate storage | Views filter existing sender-only rules by action type — no new data model, no sync issues, zero storage overhead | ✓ Good |
| Shared render functions for disposition view types | renderDispositionView (flat) and renderFolderGroupedView (accordion) handle all 4 views via parameters, eliminating duplication | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-22 after Phase 32 completion (UI cleanup — removed folder rename card and API, superseded by sentinel auto-healing)*
