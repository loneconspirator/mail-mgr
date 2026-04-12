# Phase 6: Extended Message Data - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

EmailMessage carries envelope recipient and header visibility data, fetched efficiently from IMAP, with auto-discovery of the correct envelope header and versioned schema migrations for all future database changes. This phase delivers the data layer only — matching logic (Phase 7), UI (Phase 8), and move tracking (Phase 9) are separate.

</domain>

<decisions>
## Implementation Decisions

### Auto-Discovery Strategy
- **D-01:** Auto-discovery triggers when the user submits IMAP server config in the UI, regardless of whether config values changed. Not on every automatic reconnect — only on explicit user action.
- **D-02:** Discovery probes 10 most recent messages in INBOX immediately after IMAP connection is established post-config-submit. Candidate headers: Delivered-To, X-Delivered-To, X-Original-To, X-Resolved-To, Envelope-To.
- **D-03:** Monitor pauses until discovery completes. No messages process with incomplete data. If discovery finds no usable envelope header, Monitor starts with MATCH-06 behavior (envelope/visibility fields unavailable, rules using them skipped).
- **D-04:** Discovered header name persisted in config.yml as `imap.envelopeHeader` (e.g., `envelopeHeader: "Delivered-To"`).

### Header Fetch Approach
- **D-05:** After discovery, only the identified envelope header plus List-Id are fetched on subsequent messages. No fetching all candidate headers on every message.
- **D-06:** Header fetching centralized in ImapClient. Fetch methods (fetchNewMessages, fetchAllMessages, fetchMessagesRaw) add the header fields to the IMAP FETCH command. parseMessage() in messages.ts extracts values into EmailMessage. Single fetch site, single parse site.

### Visibility Classification
- **D-07:** Each message gets a single visibility value using priority order: list (List-Id present) > direct (envelope recipient in To) > cc (envelope recipient in CC) > bcc (fallback — envelope recipient not found in To or CC).
- **D-08:** When envelope recipient is unavailable (no header discovered), visibility field is null/undefined. Rules matching on visibility are skipped per MATCH-06.

### Migration System
- **D-09:** New versioned migration system: schema_version table tracks applied migrations by timestamp. Migration functions run in timestamp order, each wrapped in a transaction.
- **D-10:** Bootstrap approach for existing schema: detect current state (columns/indexes present), mark existing migrations as applied, start fresh with new system. Existing try/catch ALTER TABLE code removed.

### Claude's Discretion
- Header probing order and consensus logic (how many of 10 messages need to have the header)
- EmailMessage type extension (field names for envelope recipient and visibility)
- ImapFlow-specific fetch query syntax for BODY[HEADER.FIELDS ...]
- Migration timestamp format and naming convention

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — MATCH-01 (auto-discovery), MATCH-02 (trigger conditions), MATCH-06 (unavailable behavior)

### Existing Code
- `src/imap/messages.ts` — EmailMessage and ReviewMessage types, parseMessage() function to extend
- `src/imap/client.ts` — ImapClient fetch methods (fetchNewMessages, fetchAllMessages, fetchMessagesRaw) to modify
- `src/log/index.ts` — Current try/catch migration pattern to replace
- `src/config/schema.ts` — imapConfigSchema to extend with envelopeHeader field
- `src/rules/matcher.ts` — matchRule() for context on how fields are consumed (Phase 7 will modify this)
- `src/monitor/index.ts` — Monitor lifecycle to understand pause/resume integration point

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseMessage()` and `parseAddress()` in messages.ts — extend to handle raw header extraction
- `ImapClient.fetchMessagesRaw()` — generic fetch method that accepts arbitrary query params, can be reused for header probing
- `configSchema` and Zod validation — extend imapConfigSchema for envelopeHeader field
- `ActivityLog.migrate()` — pattern to replace with versioned system, but the bootstrap needs to detect its existing columns

### Established Patterns
- EventEmitter-based lifecycle in ImapClient (connected, error events) — discovery completion could use similar pattern
- Config hot-reload via repository.ts change listeners — envelopeHeader changes should trigger re-discovery
- `withMailboxLock()` pattern in ImapClient for folder operations — discovery probe should use this

### Integration Points
- Monitor.start() — needs discovery gate before processing begins
- ImapClient fetch methods — need conditional header fields based on envelopeHeader config
- Config repository — needs to expose envelopeHeader to ImapClient and Monitor
- Web API routes (IMAP config) — manual discovery trigger endpoint for Phase 8 UI button

</code_context>

<specifics>
## Specific Ideas

- User explicitly wants discovery triggered by UI config submission, not automatic reconnects — this is a deliberate UX choice about when the system "learns" about the server
- Timestamped migrations (not sequential numbers) — avoids conflicts in parallel development branches
- Bootstrap approach preserves existing databases without requiring a manual migration step

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-extended-message-data*
*Context gathered: 2026-04-11*
