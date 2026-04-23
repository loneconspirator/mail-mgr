# Phase 27: IMAP Sentinel Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 27-imap-sentinel-operations
**Areas discussed:** IMAP Interface Extension, Self-Test Strategy, Error Handling Policy, Module Placement
**Mode:** --auto (all decisions auto-selected)

---

## IMAP Interface Extension

| Option | Description | Selected |
|--------|-------------|----------|
| Extend ImapClient with new methods | Follow established pattern of moveMessage, createMailbox on ImapClient | ✓ |
| Standalone wrapper functions | Create functions that accept ImapFlowLike directly | |
| New ImapSentinelClient subclass | Subclass ImapClient for sentinel-specific operations | |

**User's choice:** [auto] Extend ImapClient with new methods (recommended default)
**Notes:** Follows established patterns. ImapFlowLike interface needs append(), search(), messageDelete().

| Option | Description | Selected |
|--------|-------------|----------|
| SEARCH HEADER criterion | Standard IMAP SEARCH HEADER X-Mail-Mgr-Sentinel <message-id> | ✓ |
| SEARCH with full text | Search message body/subject for identifier | |

**User's choice:** [auto] SEARCH HEADER criterion (recommended default)
**Notes:** Standard IMAP, supported by all major servers including Fastmail.

---

## Self-Test Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Full round-trip test | APPEND test sentinel, SEARCH for it, DELETE it | ✓ |
| CAPABILITY check only | Check if server advertises SEARCH support | |
| Skip self-test | Trust that SEARCH HEADER works on all servers | |

**User's choice:** [auto] Full round-trip test (recommended default)
**Notes:** Proves the entire pipeline works end-to-end before trusting it.

| Option | Description | Selected |
|--------|-------------|----------|
| Graceful disable on failure | Log warning, disable sentinel system, don't crash | ✓ |
| Hard failure | Throw error and prevent app startup | |
| Retry with backoff | Retry self-test N times before giving up | |

**User's choice:** [auto] Graceful disable on failure (recommended default)
**Notes:** App must remain functional even if IMAP server doesn't support custom header SEARCH.

---

## Error Handling Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Throw to callers | Let Phase 28+ lifecycle code handle retries | ✓ |
| Built-in retry | Retry IMAP operations with exponential backoff | |
| Silent failure | Log and swallow errors | |

**User's choice:** [auto] Throw to callers (recommended default)
**Notes:** Phase 27 is low-level operations. Retry/recovery is Phase 28+ concern.

---

## Module Placement

| Option | Description | Selected |
|--------|-------------|----------|
| src/sentinel/imap-ops.ts | New file in sentinel module, separate from format/store | ✓ |
| src/imap/sentinel.ts | New file in IMAP module | |
| Inline in ImapClient | Add methods directly to existing client.ts | |

**User's choice:** [auto] src/sentinel/imap-ops.ts (recommended default)
**Notes:** Keeps sentinel logic together while separating IMAP-dependent code from pure format/storage.

---

## Claude's Discretion

- Internal type names for search results and operation responses
- Whether self-test uses a dedicated test folder or existing tracked folder
- Exact logging format for self-test results
- Test file organization and mocking strategy

## Deferred Ideas

None — discussion stayed within phase scope
