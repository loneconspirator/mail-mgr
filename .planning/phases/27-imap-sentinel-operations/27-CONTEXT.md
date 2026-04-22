# Phase 27: IMAP Sentinel Operations - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

The system can plant, find, and remove sentinel messages on the IMAP server. This phase adds APPEND, SEARCH-by-header, and DELETE capabilities to the IMAP layer, plus a startup self-test that confirms the server supports SEARCH by custom header before any planting occurs. No lifecycle management (that's Phase 28) — just the raw IMAP operations and the self-test gate.

</domain>

<decisions>
## Implementation Decisions

### IMAP Interface Extension
- **D-01:** Extend `ImapFlowLike` interface with `append()`, `search()`, and `messageDelete()` methods to match ImapFlow's native API surface
- **D-02:** Add corresponding high-level methods to `ImapClient`: `appendMessage()`, `searchByHeader()`, `deleteMessage()` — follows established patterns like `moveMessage()`, `createMailbox()`
- **D-03:** SEARCH by custom header uses standard IMAP `SEARCH HEADER X-Mail-Mgr-Sentinel <message-id>` — supported by all major IMAP servers including Fastmail

### Startup Self-Test
- **D-04:** Self-test performs a full round-trip: APPEND a test sentinel to a known folder, SEARCH for it by custom header, DELETE it. This proves SEARCH HEADER works end-to-end.
- **D-05:** If self-test fails (SEARCH doesn't find the appended message), log a warning and disable the sentinel system gracefully — do not crash the app. Sentinel operations become no-ops until next restart.
- **D-06:** Self-test runs once at startup, before any sentinel planting occurs (Phase 28 will gate on this)

### Error Handling
- **D-07:** IMAP operation failures (APPEND/SEARCH/DELETE) throw errors up to callers — Phase 27 is the low-level operations layer; retry and recovery logic belongs in Phase 28+ lifecycle code
- **D-08:** All operations validate inputs (e.g., refuse INBOX for APPEND sentinel) but delegate IMAP-level errors to the caller

### Module Placement
- **D-09:** New file `src/sentinel/imap-ops.ts` for IMAP sentinel operations — keeps IMAP-dependent code separate from pure format/storage concerns
- **D-10:** Re-export from `src/sentinel/index.ts` following existing barrel pattern

### Claude's Discretion
- Internal type names for search results and operation responses
- Whether self-test uses a dedicated test folder or an existing tracked folder
- Exact logging format for self-test results
- Test file organization and mocking strategy for ImapFlow operations

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SENT-06 (startup self-test), SENT-04 (sentinel body text - carried from Phase 26)

### Phase 26 Foundation
- `.planning/phases/26-sentinel-store-message-format/26-CONTEXT.md` — All sentinel format and store decisions this phase builds on
- `src/sentinel/format.ts` — buildSentinelMessage() produces the raw RFC 2822 message for APPEND
- `src/sentinel/store.ts` — SentinelStore for persisting Message-ID to folder mappings
- `src/sentinel/index.ts` — Barrel exports to extend

### IMAP Layer
- `src/imap/client.ts` — ImapClient class and ImapFlowLike interface to extend with APPEND/SEARCH/DELETE
- `src/imap/index.ts` — Barrel exports for IMAP module

### Established Patterns
- `src/imap/client.ts:withMailboxLock()` — Pattern for mailbox-scoped IMAP operations with lock management
- `src/imap/client.ts:withMailboxSwitch()` — Pattern for operations that need to switch away from INBOX

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildSentinelMessage()` in `src/sentinel/format.ts` — produces `{ raw, messageId, flags }` ready for IMAP APPEND
- `ImapClient.withMailboxLock()` — mailbox lock pattern for safe IMAP operations
- `ImapClient.withMailboxSwitch()` — switches to target folder, runs operation, reopens INBOX
- `SentinelStore` — already has `upsert()`, `getByFolder()`, `getByMessageId()` for tracking

### Established Patterns
- `ImapFlowLike` interface abstracts ImapFlow for testability — new methods must be added here first
- All IMAP operations go through `ImapClient` methods, not direct flow access
- Operations that touch non-INBOX folders use `withMailboxSwitch()` or `withMailboxLock()`
- ImapFlow factory pattern enables test mocking via `ImapFlowFactory` type

### Integration Points
- `ImapClient` needs new methods: `appendMessage()`, `searchByHeader()`, `deleteMessage()`
- `ImapFlowLike` interface needs: `append()`, `search()`, `messageDelete()`
- `src/sentinel/index.ts` re-exports need to include new `imap-ops.ts` exports
- Self-test function will be called from startup code (Phase 28 wires this in)

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

*Phase: 27-imap-sentinel-operations*
*Context gathered: 2026-04-21*
