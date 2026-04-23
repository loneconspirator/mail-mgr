# Phase 29: Pipeline Guards - Research

**Researched:** 2026-04-21
**Domain:** IMAP message processing pipeline guard logic
**Confidence:** HIGH

## Summary

This phase adds sentinel message detection to five existing message processors so they never act on sentinel messages. The codebase already has the sentinel header constant defined in `src/sentinel/format.ts` (the `X-Mail-Mgr-Sentinel` header), but no detection utility exists yet. Each processor fetches messages differently and has different data shapes available, so the guard implementation must account for those differences.

The critical finding is that **IMAP fetch queries currently do NOT request the `X-Mail-Mgr-Sentinel` header**. The `getHeaderFields()` method in `src/imap/client.ts` only returns `[envelopeHeader, 'List-Id']` when an envelope header is configured, and returns `undefined` otherwise. For header-based detection to work, every fetch path must be updated to include the sentinel header. An alternative approach -- detecting sentinels by their `Message-ID` domain `@mail-manager.sentinel` -- avoids fetch changes entirely and is equally reliable since Mail Manager controls the Message-ID format.

**Primary recommendation:** Implement `isSentinel()` as a Message-ID pattern check (`messageId.endsWith('@mail-manager.sentinel>')`) to avoid modifying any IMAP fetch queries. This is simpler, requires zero fetch-layer changes, and is equally reliable since Mail Manager controls sentinel Message-ID generation. If the team prefers header-based detection per D-02, every fetch path needs `X-Mail-Mgr-Sentinel` added to its header request list.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Shared `isSentinel()` utility function in `src/sentinel/` that checks for the presence of the `X-Mail-Mgr-Sentinel` header. Single function reused by all 5 processors.
- **D-02:** Detection is header-based only -- checking for header existence, not validating the Message-ID value. Simple and fast.
- **D-03:** Early-exit at per-message level in each processor's message loop. Check immediately after receiving/fetching the message, before any processing logic runs.
- **D-04:** Pattern: `if (isSentinel(msg)) { logger.debug(...); continue; }` -- skip with debug log, no errors, no special handling.
- **D-05:** Each processor accesses message headers through its existing message type (EmailMessage, ReviewMessage, etc.). The `isSentinel()` function accepts the headers object that each processor already has available.
- **D-06:** If any FETCH request doesn't already include headers sufficient for detection, extend the fetch to include the `X-Mail-Mgr-Sentinel` header. Minimal fetch changes -- most processors already fetch full headers.
- **D-07:** Action folder processor (`src/action-folders/processor.ts`) -- guard in `processMessage()` before sender extraction
- **D-08:** Monitor rule engine (`src/monitor/index.ts`) -- guard in `processMessage()` before `evaluateRules()`
- **D-09:** Review sweeper (`src/sweep/index.ts`) -- guard in the sweep message loop before eligibility check
- **D-10:** Batch filing engine (`src/batch/index.ts`) -- guard in both dry-run and execute message loops
- **D-11:** Move tracker (`src/tracking/index.ts`) -- guard in `fetchFolderState()` to exclude sentinels from UID snapshots, preventing false move detection

### Claude's Discretion
- Exact function signature for `isSentinel()` (whether it takes full message, headers object, or envelope)
- Whether to add a `SENTINEL_HEADER` constant export from sentinel module or inline the header name
- Test organization (one test file per processor guard vs. consolidated)
- Whether `isSentinel()` lives in `format.ts`, a new `detect.ts`, or `index.ts`

### Deferred Ideas (OUT OF SCOPE)
None

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GUARD-01 | Action folder processor ignores sentinel messages | Guard in `processMessage()` before `extractSender()` call; needs header access via fetch change |
| GUARD-02 | Monitor rule engine ignores sentinel messages | Guard in `processMessage()` before `evaluateRules()` call; needs header in `fetchNewMessages()` |
| GUARD-03 | Review sweeper ignores sentinel messages | Guard in `runSweep()` loop before `isEligibleForSweep()`; needs header in `fetchAllMessages()` |
| GUARD-04 | Batch filing engine ignores sentinel messages | Guard in both `dryRun()` and `execute()` message loops; uses same `fetchAllMessages()` as sweeper |
| GUARD-05 | Move tracker ignores sentinel messages | Guard in `fetchFolderState()` to exclude sentinels from snapshot Map; needs header in its own fetch query |

</phase_requirements>

## Architecture Patterns

### Header Availability Analysis (CRITICAL)

Per D-02, detection is header-based. Here is the current header fetch situation for each processor: [VERIFIED: codebase grep]

| Processor | Fetch Method | Headers Currently Fetched | Sentinel Header Available? |
|-----------|-------------|--------------------------|---------------------------|
| Action folder poller | `client.fetchAllMessages()` -> `parseRawToReviewMessage()` | `[envelopeHeader, 'List-Id']` only if `envelopeHeader` configured | **NO** |
| Monitor | `client.fetchNewMessages()` -> `parseMessage()` | `[envelopeHeader, 'List-Id']` only if `envelopeHeader` configured | **NO** |
| Review sweeper | `client.fetchAllMessages()` -> same as above | Same as action folder | **NO** |
| Batch engine | `client.fetchAllMessages()` -> same as above | Same as action folder | **NO** |
| Move tracker | Own `fetchFolderState()` with inline `flow.fetch()` | `[envelopeHeader, 'List-Id']` only if `envelopeHeader` configured | **NO** |

**Conclusion:** The `X-Mail-Mgr-Sentinel` header is NOT available in ANY processor's current fetch results. Per D-06, all fetch paths must be extended to include it.

### Fetch Change Strategy

There are two fetch paths that need updating:

1. **`ImapClient.getHeaderFields()`** (line 266 of `src/imap/client.ts`) -- used by `fetchNewMessages()` and `fetchAllMessages()`. Currently returns `undefined` when no `envelopeHeader` is configured. Must always include `X-Mail-Mgr-Sentinel` regardless of envelope config.

2. **`MoveTracker.fetchFolderState()`** (line 321 of `src/tracking/index.ts`) -- builds its own query object. Has the same conditional pattern: only requests headers if `envelopeHeader` is set. Must always include `X-Mail-Mgr-Sentinel`.

**After fetch changes**, the parsed headers Buffer will contain the sentinel header value when present, detectable via `parseHeaderLines()`.

### Message Type to Header Access Path

| Message Type | How Headers Are Accessed | Where `isSentinel()` Checks |
|-------------|-------------------------|----------------------------|
| `EmailMessage` (Monitor, Action folder processor) | No direct header map -- parsed from `ImapFetchResult.headers` Buffer via `parseMessage()` | Must expose headers or check before parsing |
| `ReviewMessage` (Sweeper, Batch) | No direct header map -- parsed inside `parseRawToReviewMessage()` | Must expose headers or check at raw message level |
| Raw fetch result (Move tracker) | `msg.headers` Buffer available directly | Parse and check within `fetchFolderState()` loop |

**Key problem:** Neither `EmailMessage` nor `ReviewMessage` types currently carry raw headers or a parsed header map. The `isSentinel()` function needs access to the sentinel header, but it is discarded during parsing.

### Recommended Approach

**Option A (Recommended): Extend message types to carry parsed headers**
Add an optional `headers?: Map<string, string>` field to both `EmailMessage` and `ReviewMessage`. Populate it during parsing. Then `isSentinel()` checks `msg.headers?.has('x-mail-mgr-sentinel')`.

**Option B: Check at raw fetch level before parsing**
Pass the raw Buffer to `isSentinel()` before message parsing. This works but couples the guard to the IMAP layer rather than the message abstraction.

**Option C: Accept raw headers Buffer**
`isSentinel()` accepts a `Buffer | undefined` and calls `parseHeaderLines()` internally. Each call site passes the raw headers buffer. Avoids type changes but requires each processor to have access to raw data.

**Recommended: Option A** -- it's the cleanest integration with D-05 ("accepts the headers object that each processor already has available") and makes the detection work at the message type level. The `headers` field is useful beyond sentinel detection.

### Recommended `isSentinel()` Implementation

```typescript
// src/sentinel/detect.ts
import { parseHeaderLines } from '../imap/messages.js';

/** Header name used to mark sentinel messages. */
export const SENTINEL_HEADER = 'x-mail-mgr-sentinel';

/**
 * Check whether a message is a sentinel by looking for the
 * X-Mail-Mgr-Sentinel header in its parsed header map.
 */
export function isSentinel(headers: Map<string, string> | undefined): boolean {
  if (!headers) return false;
  return headers.has(SENTINEL_HEADER);
}

/**
 * Check whether raw IMAP headers Buffer contains the sentinel header.
 * Use when parsed header map is not available.
 */
export function isSentinelRaw(headersBuffer: Buffer | undefined): boolean {
  if (!headersBuffer) return false;
  const parsed = parseHeaderLines(headersBuffer);
  return parsed.has(SENTINEL_HEADER);
}
```

### Guard Placement Per Processor

**GUARD-01: Action Folder Processor** (`src/action-folders/processor.ts`)
- Guard location: Top of `processMessage()` method, before `extractSender()`
- Message type: `EmailMessage` -- needs `headers` field added
- Pattern: `if (isSentinel(message.headers)) { this.logger.debug({ uid: message.uid }, 'Skipping sentinel message'); return { ok: true, action: actionType, sender: 'sentinel' }; }`
- Note: Return type is `ProcessResult` -- need to decide sentinel return shape (suggest early return with `ok: true` to avoid error logging)

**GUARD-02: Monitor** (`src/monitor/index.ts`)
- Guard location: Top of `processMessage()` private method (line 147), before `evaluateRules()`
- Message type: `EmailMessage` -- needs `headers` field added
- Pattern: `if (isSentinel(message.headers)) { this.logger.debug({ uid: message.uid }, 'Skipping sentinel message'); return; }`
- Note: Void return, just skip processing

**GUARD-03: Review Sweeper** (`src/sweep/index.ts`)
- Guard location: In `runSweep()` loop (line 243), before `isEligibleForSweep()`
- Message type: `ReviewMessage` -- needs `headers` field added
- Pattern: `if (isSentinel(msg.headers)) { continue; }`
- Also guard in `processSweepMessage()` for safety, since batch calls it too

**GUARD-04: Batch Engine** (`src/batch/index.ts`)
- Guard location: In `dryRun()` loop (line 94) and `execute()` loop (line 188), before processing
- Message type: `ReviewMessage` (raw from `fetchAllMessages()`)
- Pattern: `if (isSentinel(raw.headers)) { continue; }`
- Two guard points needed (dry-run + execute)

**GUARD-05: Move Tracker** (`src/tracking/index.ts`)
- Guard location: In `fetchFolderState()` loop (line 327), after parsing headers, before adding to messages Map
- Access: Raw `msg.headers` Buffer available directly
- Pattern: `if (isSentinelRaw(msg.headers)) { continue; }` -- or parse headers and use `isSentinel()`
- Effect: Sentinel UIDs excluded from snapshot, so they never appear as "disappeared" or "appeared"

### Recommended Project Structure Changes

```
src/sentinel/
  detect.ts          # NEW: isSentinel(), isSentinelRaw(), SENTINEL_HEADER constant
  format.ts          # EXISTING: buildSentinelMessage() -- no changes
  index.ts           # MODIFY: add detect.ts exports
  store.ts           # EXISTING: no changes
  imap-ops.ts        # EXISTING: no changes
  lifecycle.ts       # EXISTING: no changes

src/imap/
  client.ts          # MODIFY: getHeaderFields() always includes X-Mail-Mgr-Sentinel
  messages.ts        # MODIFY: add headers field to EmailMessage, ReviewMessage; populate in parsers

src/action-folders/
  processor.ts       # MODIFY: add guard in processMessage()

src/monitor/
  index.ts           # MODIFY: add guard in processMessage()

src/sweep/
  index.ts           # MODIFY: add guard in runSweep() loop

src/batch/
  index.ts           # MODIFY: add guard in dryRun() and execute() loops

src/tracking/
  index.ts           # MODIFY: add guard in fetchFolderState() loop, add header to fetch query
```

### Anti-Patterns to Avoid

- **Checking Message-ID pattern instead of header:** D-02 explicitly says header-based detection. While Message-ID `@mail-manager.sentinel` domain would work, it contradicts the locked decision.
- **Adding guard at the fetch layer:** Guards belong at the per-message processing level (D-03), not as a filter in the IMAP client. Other consumers may legitimately need to see sentinel messages.
- **Throwing errors on sentinel detection:** D-04 specifies debug log + skip, not errors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Header parsing | Custom string splitting | `parseHeaderLines()` from `src/imap/messages.ts` | Already handles folded headers, case normalization |
| Sentinel header name | Hardcoded strings in each processor | `SENTINEL_HEADER` constant from `src/sentinel/detect.ts` | Single source of truth |

## Common Pitfalls

### Pitfall 1: Missing Fetch Header in Some Code Paths
**What goes wrong:** Guard check always returns `false` because the header was never fetched from IMAP.
**Why it happens:** `getHeaderFields()` returns `undefined` when no `envelopeHeader` is configured, meaning no headers at all are fetched. The sentinel header request must be unconditional.
**How to avoid:** Modify `getHeaderFields()` to always return at least `['X-Mail-Mgr-Sentinel']`, adding envelope/list headers on top when configured.
**Warning signs:** Tests pass with mocked data but sentinels are processed in production.

### Pitfall 2: Sentinel Counted in Sweep/Batch Stats
**What goes wrong:** Sweep reports `totalMessages: 5` when only 4 are real, because sentinel is counted before the guard check.
**Why it happens:** The sweeper counts messages before iterating for eligibility. If sentinel is skipped during iteration but counted in the total, stats are off.
**How to avoid:** Either filter sentinels from the message list before counting, or adjust counts after iteration.
**Warning signs:** UI shows message counts that don't match actual user messages.

### Pitfall 3: Action Folder Processor Return Type
**What goes wrong:** `processMessage()` returns `ProcessResult` which is a union of `{ ok: true, ... }` and `{ ok: false, ... }`. A sentinel skip needs a clean return that doesn't confuse callers.
**Why it happens:** The method wasn't designed for "skip" scenarios.
**How to avoid:** Return early with a shape that the poller doesn't treat as an error. Suggest adding a sentinel-specific return or having the guard in the poller (before calling processMessage). Actually, per D-07, the guard goes in `processMessage()` -- so it needs a valid `ProcessResult` return. Use `{ ok: true, action: actionType, sender: 'sentinel' }`.
**Warning signs:** Activity log entries for sentinel "processing" or error counts increasing.

### Pitfall 4: Move Tracker Header Fetch Independence
**What goes wrong:** Move tracker's `fetchFolderState()` builds its own fetch query independently of `ImapClient.getHeaderFields()`. Fixing only the client doesn't fix the tracker.
**Why it happens:** The tracker uses `withMailboxLock()` and `flow.fetch()` directly, bypassing the client's fetch methods.
**How to avoid:** Must separately update the tracker's query at line 321-325 to always include `X-Mail-Mgr-Sentinel` in the headers array.
**Warning signs:** Sentinels appear in tracker snapshots, triggering false "disappeared" signals when sentinels are re-planted.

### Pitfall 5: Headers Map Case Sensitivity
**What goes wrong:** `headers.has('X-Mail-Mgr-Sentinel')` returns false because `parseHeaderLines()` lowercases all header names.
**Why it happens:** The parser normalizes to lowercase (line 105 of messages.ts: `headers.set(currentKey.toLowerCase(), ...)`).
**How to avoid:** Always check for `'x-mail-mgr-sentinel'` (lowercase) in the `isSentinel()` function.
**Warning signs:** Tests fail when using mixed-case header name in the check.

## Code Examples

### getHeaderFields() Fix
```typescript
// src/imap/client.ts - BEFORE
private getHeaderFields(): string[] | undefined {
  if (!this.config.envelopeHeader) return undefined;
  return [this.config.envelopeHeader, 'List-Id'];
}

// src/imap/client.ts - AFTER
private getHeaderFields(): string[] {
  const fields = ['X-Mail-Mgr-Sentinel'];
  if (this.config.envelopeHeader) {
    fields.push(this.config.envelopeHeader, 'List-Id');
  }
  return fields;
}
```
[VERIFIED: codebase inspection of src/imap/client.ts lines 266-269]

**Note:** Return type changes from `string[] | undefined` to `string[]`. All call sites (`fetchNewMessages` line 279, `fetchAllMessages` line 302) currently check `if (headerFields)` before adding to query -- this still works since a non-empty array is truthy. No call-site changes needed.

### EmailMessage Type Extension
```typescript
// src/imap/messages.ts - add to EmailMessage interface
export interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
  envelopeRecipient?: string;
  visibility?: Visibility;
  headers?: Map<string, string>;  // NEW: parsed header map for sentinel detection
}
```
[VERIFIED: current interface at src/imap/messages.ts lines 8-19]

### ReviewMessage Type Extension
```typescript
// src/imap/messages.ts - add to ReviewMessage interface
export interface ReviewMessage {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  envelope: { /* ... existing ... */ };
  envelopeRecipient?: string;
  visibility?: Visibility;
  headers?: Map<string, string>;  // NEW: parsed header map
}
```
[VERIFIED: current interface at src/imap/messages.ts lines 54-67]

### Monitor Guard Example
```typescript
// src/monitor/index.ts - in processMessage()
import { isSentinel } from '../sentinel/index.js';

private async processMessage(message: EmailMessage): Promise<void> {
  if (isSentinel(message.headers)) {
    this.logger.debug({ uid: message.uid }, 'Skipping sentinel message');
    return;
  }
  // ... existing processing ...
}
```

### Move Tracker Guard Example
```typescript
// src/tracking/index.ts - in fetchFolderState() loop
import { isSentinelRaw } from '../sentinel/index.js';

// Inside the for-await loop, after parsing headers:
if (isSentinelRaw(msg.headers)) {
  continue;  // Exclude sentinel from snapshot
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-01 | Action folder processor skips sentinel messages | unit | `npx vitest run test/unit/action-folders/processor.test.ts -x` | Exists, needs sentinel test cases |
| GUARD-02 | Monitor skips sentinel messages | unit | `npx vitest run test/unit/monitor/monitor.test.ts -x` | Exists, needs sentinel test cases |
| GUARD-03 | Review sweeper skips sentinel messages | unit | `npx vitest run test/unit/sweep/sweep.test.ts -x` | Exists, needs sentinel test cases |
| GUARD-04 | Batch engine skips sentinel messages in dry-run and execute | unit | `npx vitest run test/unit/batch/engine.test.ts -x` | Exists, needs sentinel test cases |
| GUARD-05 | Move tracker excludes sentinels from snapshots | unit | `npx vitest run test/unit/tracking/tracker.test.ts -x` | Exists, needs sentinel test cases |
| detect | isSentinel() and isSentinelRaw() utility functions | unit | `npx vitest run test/unit/sentinel/detect.test.ts -x` | Wave 0 |
| fetch | getHeaderFields() always returns sentinel header | unit | `npx vitest run test/unit/imap/client.test.ts -x` | Exists, needs update |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/sentinel/detect.test.ts` -- covers isSentinel() and isSentinelRaw()
- [ ] Sentinel test cases in each existing processor test file

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `headers?: Map<string, string>` as optional to EmailMessage/ReviewMessage won't break existing consumers since it's optional | Architecture Patterns | Medium -- if any code destructures or spreads these types, extra field could cause issues. Grep for spread usage recommended. |
| A2 | ImapFlow fetches the specific headers listed in the `headers` array of the fetch query | Fetch Change Strategy | High -- if ImapFlow fetches ALL headers regardless, no fetch change needed. Verify with ImapFlow docs. |
| A3 | The `reviewMessageToEmailMessage()` conversion function will need updating to pass through the new `headers` field | Architecture Patterns | Low -- straightforward code change |

## Open Questions (RESOLVED)

1. **Action folder processor return type for sentinel skip**
   - What we know: `processMessage()` returns `ProcessResult` union type
   - What's unclear: What should the sentinel skip return look like? It's not really a success or failure.
   - RESOLVED: Return `{ ok: true, action: actionType, sender: 'sentinel' }` -- the poller doesn't do anything special with the return value beyond logging

2. **Should the guard be in the poller or processor for action folders?**
   - D-07 says processor, but the poller is where `fetchAllMessages()` results are iterated
   - The poller calls `reviewMessageToEmailMessage()` then passes to processor
   - Guard in processor is correct per decision, but the poller could also skip the conversion for sentinels
   - RESOLVED: Guard in processor as decided; the conversion is cheap

## Sources

### Primary (HIGH confidence)
- Codebase inspection of all 5 processor files, IMAP client, and message types
- `src/sentinel/format.ts` -- sentinel header name and message format
- `src/imap/client.ts` lines 266-309 -- fetch query construction and header field selection
- `src/imap/messages.ts` -- EmailMessage, ReviewMessage types, parseHeaderLines, parseMessage
- `src/tracking/index.ts` lines 310-370 -- independent fetch query in fetchFolderState

### Secondary (MEDIUM confidence)
- Existing test patterns from `test/unit/action-folders/processor.test.ts`, `test/unit/tracking/tracker.test.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, pure codebase modification
- Architecture: HIGH - all code paths inspected, header availability confirmed
- Pitfalls: HIGH - identified from actual code inspection, not hypothetical

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable internal codebase, no external dependencies)
