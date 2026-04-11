# Mail Manager

## What This Is

An automated email organization system that monitors IMAP mailboxes, routes messages using pattern-matching rules, and manages a two-stream intake model (Inbox for action items, Review for batch processing). Includes retroactive batch filing to reorganize existing messages with dry-run preview. Built for a single user with 20 years of email on Fastmail, accessed via Mac Mail. Web UI provides rule management with visual folder pickers, editable sweep settings, batch filing, activity logging, and system status.

## Core Value

Dramatically reduce inbox volume without losing visibility — messages that need attention stay in Inbox, everything else is automatically routed, reviewed in batches, and archived.

## Requirements

### Validated

- ✓ IMAP monitoring with UID-based message tracking — v0.1
- ✓ Pattern-matching rules (sender/recipient/subject globs, first-match-wins) — v0.1
- ✓ Move-to-folder action with activity logging — v0.1
- ✓ SQLite-backed activity log and rule storage — v0.1
- ✓ Web UI for rule CRUD, activity viewing, settings management — v0.1
- ✓ Four routing dispositions: move, review, skip, delete — v0.2
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

### Active

(None yet — define with `/gsd-new-milestone`)

### Out of Scope

- Folder creation/deletion from this app's UI — user manages folder structure in mail client
- Folder retirement (moving to zz_old/) — handled manually in mail client
- LLM classification — Tier 4, future milestone
- Learning from user behavior — Tier 5, future milestone
- Review digest notifications — Tier 6, future milestone
- Multi-account support — Tier 6, future milestone
- Mobile-responsive UI — Tier 6, future milestone

## Context

- **Runtime:** Node.js / TypeScript, compiled with tsc
- **IMAP server:** Fastmail (potential Gmail later)
- **Mail client:** Mac Mail (folders only, no tags/labels)
- **Database:** SQLite via better-sqlite3
- **Web UI:** Vanilla HTML/CSS/JS SPA served by Fastify
- **Testing:** Vitest with 347 tests (unit + integration)
- **Codebase:** ~5,500 LOC TypeScript across 44+ source files
- **Architecture:** Monitor loop polls IMAP, evaluates rules, executes actions, logs activity. Sweep runs periodically on Review folder. BatchEngine applies rules retroactively with chunked execution. Web server exposes REST API for UI.
- **Key insight:** Folder structure is owned by the mail client/IMAP server, not this application. The system discovers what folders exist and uses them — it does not create or manage them.
- **User's email history:** 20 years of accumulated mail with inconsistent organization. The folder taxonomy needs to work with what exists, not impose a new structure.

## Constraints

- **IMAP-only:** No message header modification, no flags beyond standard IMAP flags. Organization is folder placement only.
- **Mac Mail compatibility:** Must work within Mac Mail's folder-based model. No tags, labels, or virtual folders.
- **Single user:** No auth, no multi-tenancy. One instance per mailbox.
- **Batch filing scale:** Must handle applying rules to folders with thousands of messages. Needs progress reporting and the ability to cancel mid-run.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Folder taxonomy discovered from server, not managed in app | User manages folders in Mac Mail; app should reflect reality, not duplicate management | ✓ Good |
| Tree picker for folder selection | Current text input doesn't show available folders; visual hierarchy aids rule creation | ✓ Good |
| Retroactive batch filing included in Tier 3 | User needs to reorganize existing mail into taxonomy — critical for 20 years of accumulated email | ✓ Good |
| v0.2 cleanup folded into Tier 3 | Sweep settings UI and stale sweeper ref are small fixes that belong with the next milestone | ✓ Good |
| Apply full ruleset in batch (no per-rule selection) | Matches how Monitor works; "all rules" satisfies "one, multiple, or all" | ✓ Good |
| Narrowed CONF-02 to single archive folder | Inbox has no archive fallback; unmatched stay in INBOX; only review needs configurable archive | ✓ Good |
| First-match-wins rule evaluation | Simple, predictable, easy to reason about ordering | ✓ Good |
| SQLite for all persistence | Single-user system, no need for a database server | ✓ Good |
| Vanilla JS frontend | No build tooling needed, fast iteration, simple deployment | ✓ Good |
| Batch Progress UI phase dropped | SSE streaming, per-destination summaries, folder stats are gold plating — polling-based progress is sufficient | ✓ Good |

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
*Last updated: 2026-04-11 after v0.3 milestone — Folder Taxonomy & Batch Filing shipped*
