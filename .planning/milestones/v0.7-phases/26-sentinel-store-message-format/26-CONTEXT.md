# Phase 26: Sentinel Store & Message Format - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Sentinel identity and persistence: construct sentinel IMAP messages with unique headers and store their folder mappings in SQLite. This phase builds the foundation that planting (Phase 28) and scanning (Phase 30) depend on. No IMAP operations — just the message builder and the database layer.

</domain>

<decisions>
## Implementation Decisions

### Sentinel Message Content
- **D-01:** Subject line format: `[Mail Manager] Sentinel: {folder_path}` — clearly identifies purpose to users who see the message in their mail client
- **D-02:** From address: `mail-manager@localhost` — non-routable, identifies the system as the source
- **D-03:** Body text is descriptive and varies by folder purpose: for action folders, explain what the action does (per SENT-04); for rule targets, explain this is a tracking beacon for folder rename detection
- **D-04:** Custom header `X-Mail-Mgr-Sentinel: {message_id}` for fast IMAP SEARCH identification
- **D-05:** `\Seen` flag set on construction so sentinels don't appear as unread in mail clients

### Message-ID Generation
- **D-06:** Format: `<{uuid}@mail-manager.sentinel>` — UUID v4 provides uniqueness, `.sentinel` pseudo-domain makes identification trivial in logs and debugging

### SQLite Schema
- **D-07:** New `sentinels` table added via migration in existing activity DB (same `src/log/migrations.ts` pattern) — keeps all SQLite in one DB file
- **D-08:** Schema: `message_id TEXT PRIMARY KEY, folder_path TEXT NOT NULL, folder_purpose TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))` — folder_purpose captures why the folder is tracked (e.g., 'rule-target', 'action-folder', 'review', 'sweep-target')
- **D-09:** Index on `folder_path` for lookup-by-folder queries during scanning

### Module Structure
- **D-10:** New `src/sentinel/` directory — clean separation following established patterns (`src/action-folders/`, `src/tracking/`)
- **D-11:** Files: `format.ts` (message builder), `store.ts` (SQLite CRUD), `index.ts` (re-exports)

### INBOX Exclusion
- **D-12:** The message format builder refuses to create a sentinel when folder_path is 'INBOX' — throws an error, enforced at the builder level (SENT-05)

### Claude's Discretion
- Body text exact wording and formatting
- Internal naming conventions for types/interfaces
- Test file organization within the sentinel module

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SENT-02 (message format), SENT-03 (SQLite persistence), SENT-05 (INBOX exclusion)

### Existing Patterns
- `src/log/migrations.ts` — Versioned migration pattern for SQLite schema changes
- `src/log/index.ts` — Database initialization and better-sqlite3 usage patterns
- `src/action-folders/` — Module structure pattern (processor, registry, index re-exports)

### Architecture
- `.planning/research/SUMMARY.md` — v0.6 research summary with architecture decisions that inform v0.7 module layout

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/log/migrations.ts` — Migration runner with `schema_migrations` tracking table; new sentinel migration slots in here
- `src/log/index.ts` — better-sqlite3 Database initialization pattern; sentinel store can follow same pattern or share the DB instance
- `src/action-folders/registry.ts` — ActionRegistry pattern for mapping action types to behavior; sentinel store needs folder_purpose enum with similar design

### Established Patterns
- Versioned migrations with `{date}_{seq}` naming (e.g., `20260412_001`)
- Database singleton created at module level, exported for consumers
- TypeScript interfaces for all DB row types
- Zod schemas for config validation

### Integration Points
- Activity DB instance — sentinel store should use the same DB file and connection
- Migration runner — sentinel table migration added to the existing migrations array
- Action folder registry — folder purpose descriptions can be sourced from here for sentinel body text

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-sentinel-store-message-format*
*Context gathered: 2026-04-21*
