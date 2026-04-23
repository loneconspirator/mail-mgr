# Phase 27: IMAP Sentinel Operations - Research

**Researched:** 2026-04-21
**Domain:** IMAP protocol operations (APPEND, SEARCH HEADER, DELETE) via ImapFlow
**Confidence:** HIGH

## Summary

This phase adds three IMAP operations to the existing `ImapClient` — append, search-by-header, and delete — plus a startup self-test that proves SEARCH HEADER works end-to-end. The codebase already has well-established patterns for IMAP operations (`withMailboxLock`, `withMailboxSwitch`, `ImapFlowLike` interface abstraction) and Phase 26 delivered `buildSentinelMessage()` which produces the exact `{ raw, messageId, flags }` tuple needed for APPEND.

ImapFlow (v1.2.8 installed, v1.3.2 latest on npm) provides `append()`, `search()`, and `messageDelete()` natively. The `search()` method accepts a `header` object for IMAP `SEARCH HEADER` queries. The search compiler in ImapFlow translates `{ header: { 'X-Mail-Mgr-Sentinel': messageId } }` to the standard IMAP command `SEARCH HEADER X-MAIL-MGR-SENTINEL <messageId>`. This is a standard IMAP4rev1 command (RFC 3501 Section 6.4.4) supported by all compliant servers including Fastmail.

**Primary recommendation:** Extend `ImapFlowLike` with `append()`, `search()`, and `messageDelete()` method signatures, add three high-level methods to `ImapClient`, create `src/sentinel/imap-ops.ts` with sentinel-specific wrappers and self-test function, and test with the existing mock-flow pattern from `client.test.ts`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Extend `ImapFlowLike` interface with `append()`, `search()`, and `messageDelete()` methods to match ImapFlow's native API surface
- D-02: Add corresponding high-level methods to `ImapClient`: `appendMessage()`, `searchByHeader()`, `deleteMessage()` — follows established patterns like `moveMessage()`, `createMailbox()`
- D-03: SEARCH by custom header uses standard IMAP `SEARCH HEADER X-Mail-Mgr-Sentinel <message-id>` — supported by all major IMAP servers including Fastmail
- D-04: Self-test performs a full round-trip: APPEND a test sentinel to a known folder, SEARCH for it by custom header, DELETE it. This proves SEARCH HEADER works end-to-end.
- D-05: If self-test fails (SEARCH doesn't find the appended message), log a warning and disable the sentinel system gracefully — do not crash the app. Sentinel operations become no-ops until next restart.
- D-06: Self-test runs once at startup, before any sentinel planting occurs (Phase 28 will gate on this)
- D-07: IMAP operation failures (APPEND/SEARCH/DELETE) throw errors up to callers — Phase 27 is the low-level operations layer; retry and recovery logic belongs in Phase 28+ lifecycle code
- D-08: All operations validate inputs (e.g., refuse INBOX for APPEND sentinel) but delegate IMAP-level errors to the caller
- D-09: New file `src/sentinel/imap-ops.ts` for IMAP sentinel operations — keeps IMAP-dependent code separate from pure format/storage concerns
- D-10: Re-export from `src/sentinel/index.ts` following existing barrel pattern

### Claude's Discretion
- Internal type names for search results and operation responses
- Whether self-test uses a dedicated test folder or an existing tracked folder
- Exact logging format for self-test results
- Test file organization and mocking strategy for ImapFlow operations

### Deferred Ideas (OUT OF SCOPE)
None

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SENT-06 | Startup self-test verifies the IMAP server supports SEARCH by custom header before planting | Self-test round-trip pattern: APPEND test sentinel, SEARCH by header, DELETE. ImapFlow's `search({ header: {...} })` compiles to IMAP `SEARCH HEADER` command. Return boolean indicating support. |
| SENT-04 | Sentinel body text explains the message's purpose to the user | Already implemented in Phase 26 via `purposeBody()` in `src/sentinel/format.ts`. Phase 27 uses `buildSentinelMessage()` output directly for APPEND — no additional work needed for this requirement. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.8 (installed) | IMAP client with APPEND/SEARCH/DELETE support | Already in use; provides `append()`, `search()`, `messageDelete()` natively [VERIFIED: node_modules inspection] |
| vitest | 4.0.18 (installed) | Unit testing | Project standard, `vitest run` for tests [VERIFIED: package.json] |
| pino | 10.3.0 (installed) | Logging for self-test results | Project standard logging library [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | 12.6.2 (installed) | SentinelStore for test fixtures | Already used; store.test.ts shows in-memory DB pattern [VERIFIED: test/unit/sentinel/store.test.ts] |

No new packages needed. Everything required is already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/sentinel/
  format.ts          # (Phase 26) buildSentinelMessage, purposeBody
  store.ts           # (Phase 26) SentinelStore SQLite persistence
  imap-ops.ts        # (Phase 27 - NEW) appendSentinel, findSentinel, deleteSentinel, runSelfTest
  index.ts           # barrel re-exports (extend with imap-ops exports)

src/imap/
  client.ts          # ImapClient + ImapFlowLike (extend with append/search/delete)
  index.ts           # barrel re-exports (extend type exports)

test/unit/sentinel/
  format.test.ts     # (Phase 26) existing
  store.test.ts      # (Phase 26) existing
  imap-ops.test.ts   # (Phase 27 - NEW) tests for sentinel IMAP operations + self-test
```

### Pattern 1: ImapFlowLike Interface Extension
**What:** Add method signatures to the `ImapFlowLike` interface so mocks and real ImapFlow both satisfy the contract.
**When to use:** Any time a new ImapFlow method is needed by the application.
**Example:**
```typescript
// Source: existing pattern in src/imap/client.ts line 20-36
export interface ImapFlowLike {
  // ... existing methods ...
  append(path: string, content: string | Buffer, flags?: string[], idate?: Date): Promise<AppendResponse>;
  search(query: SearchQuery, options?: { uid?: boolean }): Promise<number[]>;
  messageDelete(range: number[] | string, options?: { uid?: boolean }): Promise<boolean>;
}
```
[VERIFIED: src/imap/client.ts]

### Pattern 2: High-Level ImapClient Methods
**What:** Thin wrappers on ImapClient that handle connection checks and mailbox locking.
**When to use:** Every public IMAP operation exposed to the rest of the app.
**Example:**
```typescript
// Source: existing pattern — ImapClient.moveMessage() at line 153
async appendMessage(folder: string, raw: string, flags: string[]): Promise<AppendResponse> {
  if (!this.flow) throw new Error('Not connected');
  // append() does NOT require a mailbox to be selected — it takes path as arg
  return await this.flow.append(folder, raw, flags);
}
```
[VERIFIED: ImapFlow source shows append takes path as first arg, does not require mailboxOpen]

### Pattern 3: Sentinel-Specific Wrappers in imap-ops.ts
**What:** Functions in `src/sentinel/imap-ops.ts` that compose ImapClient methods with sentinel format/store concerns.
**When to use:** Callers (Phase 28 lifecycle) should use these, not raw ImapClient methods.
**Example:**
```typescript
// appendSentinel: builds message + appends + records in store
// findSentinel: searches by X-Mail-Mgr-Sentinel header in a folder
// deleteSentinel: deletes by UID + removes from store
// runSelfTest: full round-trip APPEND/SEARCH/DELETE
```

### Pattern 4: Mock Flow in Tests
**What:** Use `createMockFlow()` helper from client.test.ts pattern — add `append`, `search`, `messageDelete` to mocks.
**When to use:** All unit tests for sentinel IMAP operations.
**Example:**
```typescript
// Source: test/unit/imap/client.test.ts line 14-41
function createMockFlow(overrides: Partial<ImapFlowLike> = {}): ImapFlowLike {
  return {
    // ... existing defaults ...
    append: vi.fn(async () => ({ destination: 'TestFolder', uid: 1 })),
    search: vi.fn(async () => []),
    messageDelete: vi.fn(async () => true),
    ...overrides,
  } as ImapFlowLike;
}
```
[VERIFIED: test/unit/imap/client.test.ts]

### Anti-Patterns to Avoid
- **Direct flow access from sentinel code:** Always go through ImapClient methods, never access the private `flow` field
- **Using `withMailboxSwitch` for APPEND:** ImapFlow's `append()` takes a path argument and does NOT require the mailbox to be selected/locked. Using `withMailboxSwitch` would unnecessarily pause IDLE.
- **Using `withMailboxLock` for SEARCH/DELETE without releasing:** SEARCH and DELETE DO require a mailbox to be open. Use `withMailboxLock` (or `withMailboxSwitch` if INBOX needs to be reopened after).
- **Storing UIDs as persistent identifiers:** UIDs change on UIDVALIDITY changes. The MessageID is the persistent identifier (confirmed in STATE.md decisions).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP SEARCH HEADER query | Custom IMAP command strings | ImapFlow's `search({ header: { key: value } })` | ImapFlow's search compiler handles quoting, unicode, and protocol encoding [VERIFIED: node_modules/imapflow/lib/search-compiler.js] |
| RFC 2822 message formatting | String concatenation for headers | `buildSentinelMessage()` from Phase 26 | Already handles CRLF, header injection prevention, Message-ID generation [VERIFIED: src/sentinel/format.ts] |
| IMAP STORE+EXPUNGE for delete | Manual flag-then-expunge | ImapFlow's `messageDelete()` | Handles the STORE \Deleted + EXPUNGE sequence (or MOVE to Trash on servers that need it) [VERIFIED: node_modules/imapflow/lib/imap-flow.js line 2383] |

## Common Pitfalls

### Pitfall 1: APPEND Does Not Need Mailbox Selection
**What goes wrong:** Developer wraps `append()` in `withMailboxLock()` or `withMailboxSwitch()`, causing unnecessary IDLE interruption and potential deadlocks.
**Why it happens:** Most IMAP operations require a mailbox to be selected. APPEND is the exception — it takes a path as its first argument.
**How to avoid:** Call `flow.append(path, content, flags)` directly without mailbox selection. Only `search()` and `messageDelete()` need a selected mailbox.
**Warning signs:** IDLE pausing during append operations, or tests requiring `mailboxOpen` mock for append.
[VERIFIED: ImapFlow source line 2413 — append takes path arg, runs APPEND command directly]

### Pitfall 2: SEARCH and DELETE Require Selected Mailbox
**What goes wrong:** Calling `search()` or `messageDelete()` without first opening/locking the target mailbox returns empty results or errors.
**Why it happens:** IMAP SEARCH and EXPUNGE operate on the currently selected mailbox. ImapFlow's `search()` returns undefined if no mailbox is open (line 2502-2504).
**How to avoid:** Use `withMailboxSwitch(folder, fn)` for search/delete operations that target non-INBOX folders. This handles lock acquisition, INBOX reopen, and IDLE restart.
**Warning signs:** `search()` returning `undefined` or `false` instead of an array.
[VERIFIED: ImapFlow source line 2501-2514]

### Pitfall 3: Search Returns UIDs Only When Requested
**What goes wrong:** Developer searches and gets sequence numbers instead of UIDs, then uses them for delete-by-UID.
**Why it happens:** ImapFlow `search()` returns sequence numbers by default. Must pass `{ uid: true }` option to get UIDs.
**How to avoid:** Always pass `{ uid: true }` to search, and `{ uid: true }` to messageDelete.
**Warning signs:** Delete operations targeting wrong messages.
[VERIFIED: ImapFlow source line 2485-2486]

### Pitfall 4: Header Name Case in ImapFlow Search Compiler
**What goes wrong:** Header name case mismatch between what was stored and what is searched.
**Why it happens:** ImapFlow's search compiler uppercases header names before sending to the server (line 320: `header.toUpperCase().trim()`). The IMAP protocol's SEARCH HEADER is case-insensitive for header names (RFC 3501), but the value match is case-insensitive substring match.
**How to avoid:** Use the exact header name `X-Mail-Mgr-Sentinel` (ImapFlow will uppercase it). For the value, use the full Message-ID string. IMAP SEARCH HEADER does substring matching, so the angle brackets in the Message-ID help ensure unique matches.
**Warning signs:** Self-test SEARCH finding zero results despite successful APPEND.
[VERIFIED: node_modules/imapflow/lib/search-compiler.js line 320]

### Pitfall 5: Self-Test Folder Cleanup on Failure
**What goes wrong:** Self-test APPENDs a message, SEARCH fails, and the test sentinel is left orphaned in the folder.
**Why it happens:** Error handling skips the DELETE step when SEARCH fails.
**How to avoid:** Use try/finally to attempt DELETE regardless of SEARCH outcome. If DELETE also fails, log but don't throw — the orphaned message is harmless (it has \Seen flag and sentinel headers).
**Warning signs:** Accumulating test sentinel messages in the folder after repeated startup failures.

## Code Examples

### ImapFlowLike Interface Extensions
```typescript
// Source: ImapFlow JSDoc at node_modules/imapflow/lib/imap-flow.js
export interface AppendResponse {
  destination: string;
  uidValidity?: bigint;
  uid?: number;
  seq?: number;
}

export interface SearchQuery {
  header?: Record<string, string | boolean>;
  seen?: boolean;
  all?: boolean;
  uid?: string;
  [key: string]: unknown;
}

// Add to ImapFlowLike interface:
append(path: string, content: string | Buffer, flags?: string[], idate?: Date): Promise<AppendResponse | false>;
search(query: SearchQuery, options?: { uid?: boolean }): Promise<number[] | false | undefined>;
messageDelete(range: number[] | string | SearchQuery, options?: { uid?: boolean }): Promise<boolean>;
```
[VERIFIED: ImapFlow source inspection]

### ImapClient.appendMessage()
```typescript
// APPEND does not require mailbox selection
async appendMessage(folder: string, raw: string, flags: string[]): Promise<AppendResponse> {
  if (!this.flow) throw new Error('Not connected');
  const result = await this.flow.append(folder, raw, flags);
  if (!result) throw new Error(`APPEND to ${folder} failed`);
  return result as AppendResponse;
}
```
[VERIFIED: ImapFlow append at line 2413 takes path as first arg]

### ImapClient.searchByHeader()
```typescript
// SEARCH requires mailbox to be selected — use withMailboxSwitch for non-INBOX folders
async searchByHeader(folder: string, headerName: string, headerValue: string): Promise<number[]> {
  return this.withMailboxSwitch(folder, async (flow) => {
    const result = await flow.search(
      { header: { [headerName]: headerValue } },
      { uid: true }
    );
    return Array.isArray(result) ? result : [];
  });
}
```
[VERIFIED: ImapFlow search with header object at line 2200, search-compiler.js line 301-321]

### ImapClient.deleteMessage()
```typescript
// DELETE requires mailbox to be selected
async deleteMessage(folder: string, uid: number): Promise<boolean> {
  return this.withMailboxSwitch(folder, async (flow) => {
    return await flow.messageDelete([uid], { uid: true });
  });
}
```
[VERIFIED: ImapFlow messageDelete at line 2383]

### Self-Test Round-Trip (src/sentinel/imap-ops.ts)
```typescript
// Conceptual — exact implementation at Claude's discretion
export async function runSentinelSelfTest(
  client: ImapClient,
  testFolder: string,
  logger: Logger
): Promise<boolean> {
  const testMessage = buildSentinelMessage({
    folderPath: testFolder,
    folderPurpose: 'rule-target',
    bodyText: 'Self-test sentinel — safe to delete',
  });

  let appendedUid: number | undefined;
  try {
    // Step 1: APPEND test sentinel
    const appendResult = await client.appendMessage(testFolder, testMessage.raw, testMessage.flags);
    appendedUid = appendResult.uid;

    // Step 2: SEARCH for it by custom header
    const uids = await client.searchByHeader(
      testFolder,
      'X-Mail-Mgr-Sentinel',
      testMessage.messageId
    );

    if (uids.length === 0) {
      logger.warn('Sentinel self-test: SEARCH HEADER not supported or failed');
      return false;
    }

    logger.info('Sentinel self-test: SEARCH HEADER supported');
    return true;
  } catch (err) {
    logger.warn({ err }, 'Sentinel self-test failed');
    return false;
  } finally {
    // Step 3: Clean up test sentinel
    if (appendedUid !== undefined) {
      try {
        await client.deleteMessage(testFolder, appendedUid);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual IMAP commands for SEARCH | ImapFlow `search()` with typed query objects | ImapFlow 1.0+ | Type-safe, handles encoding |
| STORE \Deleted + EXPUNGE | ImapFlow `messageDelete()` | ImapFlow 1.0+ | Single call, handles both steps |

**Note on ImapFlow version:** Project uses 1.2.8, latest is 1.3.2. No breaking changes between these versions for the methods we need. Upgrading is optional and not required for this phase. [VERIFIED: npm registry]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fastmail supports SEARCH HEADER for custom headers (X-Mail-Mgr-Sentinel) | User Constraints D-03 | Self-test would fail on real server; entire sentinel system blocked. Mitigated by self-test design (D-04/D-05). |
| A2 | ImapFlow append returns UID when server supports UIDPLUS | Code Examples | If no UIDPLUS, cleanup delete in self-test may need to search for the message instead. Low risk — Fastmail supports UIDPLUS. |

## Open Questions

1. **Self-test folder choice**
   - What we know: Self-test needs a folder to APPEND/SEARCH/DELETE a test sentinel. Any tracked folder works. A dedicated test folder would be cleaner but adds creation/deletion overhead.
   - What's unclear: User preference on folder choice.
   - Recommendation: Use an existing tracked folder if any exist, or create a temporary `Mail-Manager-Test` folder. Claude's discretion per CONTEXT.md.

2. **UIDPLUS fallback for self-test cleanup**
   - What we know: If server doesn't support UIDPLUS, `append()` won't return the UID. We'd need to SEARCH for the test sentinel to get its UID before deleting.
   - What's unclear: Whether to add UIDPLUS detection.
   - Recommendation: Search for the test sentinel by header to get its UID regardless — this also exercises the SEARCH path (which is the whole point of the self-test).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration) |
| Quick run command | `npx vitest run test/unit/sentinel/imap-ops.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SENT-06 | Self-test APPEND/SEARCH/DELETE round-trip succeeds | unit | `npx vitest run test/unit/sentinel/imap-ops.test.ts -t "self-test"` | Wave 0 |
| SENT-06 | Self-test gracefully disables on SEARCH failure | unit | `npx vitest run test/unit/sentinel/imap-ops.test.ts -t "self-test.*fail"` | Wave 0 |
| SENT-06 | Self-test cleans up test sentinel even on failure | unit | `npx vitest run test/unit/sentinel/imap-ops.test.ts -t "cleanup"` | Wave 0 |
| SENT-04 | Sentinel body text included in appended message | unit | `npx vitest run test/unit/sentinel/format.test.ts` | Exists (Phase 26) |
| — | appendMessage calls flow.append with correct args | unit | `npx vitest run test/unit/imap/client.test.ts -t "append"` | Wave 0 |
| — | searchByHeader uses withMailboxSwitch + header query | unit | `npx vitest run test/unit/imap/client.test.ts -t "searchByHeader"` | Wave 0 |
| — | deleteMessage uses withMailboxSwitch + messageDelete | unit | `npx vitest run test/unit/imap/client.test.ts -t "deleteMessage"` | Wave 0 |
| — | INBOX rejected for appendSentinel | unit | `npx vitest run test/unit/sentinel/imap-ops.test.ts -t "INBOX"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/sentinel/ test/unit/imap/client.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/sentinel/imap-ops.test.ts` -- covers SENT-06 self-test + sentinel IMAP wrappers
- [ ] Update `test/unit/imap/client.test.ts` -- add appendMessage, searchByHeader, deleteMessage tests
- [ ] Update `createMockFlow()` in client.test.ts -- add append, search, messageDelete mock defaults

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | IMAP auth handled by existing ImapClient/ImapFlow |
| V3 Session Management | no | IMAP session handled by existing ImapClient |
| V4 Access Control | no | Operations use authenticated IMAP connection |
| V5 Input Validation | yes | `buildSentinelMessage()` already validates folderPath (CRLF injection, INBOX guard) |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Header injection via folder path | Tampering | `buildSentinelMessage()` rejects CR/LF in folderPath [VERIFIED: src/sentinel/format.ts line 33-35] |
| INBOX sentinel bypass | Tampering | Guard in `buildSentinelMessage()` + guard in imap-ops wrappers [VERIFIED: src/sentinel/format.ts line 28-30] |

## Sources

### Primary (HIGH confidence)
- ImapFlow source code at `node_modules/imapflow/lib/imap-flow.js` — append (line 2413), search (line 2501), messageDelete (line 2383), SearchObject typedef (line 2167-2203)
- ImapFlow search compiler at `node_modules/imapflow/lib/search-compiler.js` — header search compilation (line 301-321)
- `src/imap/client.ts` — existing ImapClient patterns, ImapFlowLike interface
- `src/sentinel/format.ts` — buildSentinelMessage API
- `src/sentinel/store.ts` — SentinelStore API
- `test/unit/imap/client.test.ts` — mock flow pattern, test structure
- `test/unit/sentinel/format.test.ts` — sentinel test patterns

### Secondary (MEDIUM confidence)
- npm registry: imapflow latest version 1.3.2 [VERIFIED: npm view]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and in use, APIs verified from source
- Architecture: HIGH - follows existing patterns exactly, interface extension is mechanical
- Pitfalls: HIGH - verified from ImapFlow source code (mailbox selection requirements, UID options, header case handling)

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable domain, no fast-moving dependencies)
