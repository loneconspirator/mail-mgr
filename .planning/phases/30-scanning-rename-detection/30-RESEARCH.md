# Phase 30: Scanning & Rename Detection - Research

**Researched:** 2026-04-22
**Domain:** IMAP sentinel scanning, periodic timer workers, rename detection
**Confidence:** HIGH

## Summary

Phase 30 builds a `SentinelScanner` class that periodically checks whether each planted sentinel message is still in its expected folder. When a sentinel is missing from its expected folder, a deep scan searches all IMAP folders to locate it. The scanner produces a scan report with three possible outcomes per sentinel (found-in-place, found-in-different-folder, not-found) and does NOT act on results -- Phase 31 consumes them.

The codebase already has everything this phase needs: `findSentinel()` for IMAP SEARCH by header, `SentinelStore.getAll()` for iterating sentinels, `ImapClient.listMailboxes()` for enumerating all folders, and `MoveTracker` as a complete timer pattern template. This is a straightforward assembly phase with no new dependencies, no new libraries, and no architectural unknowns.

**Primary recommendation:** Follow the MoveTracker pattern exactly -- same start/stop/getState lifecycle, same running guard, same transient error handling. The only new logic is the two-tier scan (fast path + deep scan) and the scan result types.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Three scan outcomes: `found-in-place`, `found-in-different-folder` (with new folder path), `not-found`
- **D-02:** Scanner returns a complete scan report (array of per-sentinel results) for Phase 31 bulk processing
- **D-03:** Detection only -- scanner does NOT update SentinelStore or config
- **D-04:** Two-tier scan: fast path checks expected folder via `findSentinel()`, deep scan only on miss
- **D-05:** Deep scan iterates all folders from IMAP namespace via folder listing
- **D-06:** Short-circuit on first match during deep scan
- **D-07:** No caching -- results returned immediately, scan runs periodically
- **D-08:** Standalone `SentinelScanner` class following MoveTracker pattern: start/stop/getState, running guard
- **D-09:** `start()` fires initial scan immediately (fire-and-forget), then setInterval
- **D-10:** Configurable scan interval, 5-minute default, config field alongside existing intervals
- **D-11:** Transient IMAP errors caught at scan level, logged debug, retried next interval
- **D-12:** Independent timer, no coordination with INBOX monitor; IMAP serialization via `withMailboxLock()`
- **D-13:** Scanner respects `sentinelEnabled` runtime flag -- if self-test failed, start() is a no-op
- **D-14:** New file `src/sentinel/scanner.ts`
- **D-15:** Exports added to `src/sentinel/index.ts` barrel

### Claude's Discretion
- Internal type names for scan results (e.g., `ScanResult`, `ScanReport`)
- Whether to expose `runScanForTest()` method (MoveTracker does this -- recommend yes)
- How to list all IMAP folders (client method reuse vs. new helper)
- Error handling granularity for individual folder search failures within deep scan
- Test file organization

### Deferred Ideas (OUT OF SCOPE)
None

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCAN-01 | Periodic scan checks each sentinel's expected folder via IMAP SEARCH by Message-ID | `findSentinel()` already does SEARCH HEADER by Message-ID. `SentinelStore.getAll()` provides the iteration list. Timer pattern from MoveTracker. |
| SCAN-02 | When sentinel not found in expected folder, deep scan searches all IMAP folders | `ImapClient.listMailboxes()` returns all folders. Deep scan iterates them calling `findSentinel()` with short-circuit on match (D-06). |
| SCAN-03 | Scan runs on own timer (configurable, default 5 min), independent of mail processing poll | Config schema needs new `sentinel.scanIntervalMs` field. Independent `setInterval` in SentinelScanner, no coupling to monitor/sweeper timers. |
| SCAN-04 | Scanning does not block or significantly delay INBOX monitoring | Independent timer (D-12). IMAP connection serialization handled by `withMailboxLock()` -- scans wait their turn but don't hold locks during INBOX IDLE. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | (existing) | IMAP protocol operations | Already used project-wide via ImapClient wrapper [VERIFIED: codebase] |
| better-sqlite3 | (existing) | SentinelStore persistence | Already used for sentinel records [VERIFIED: codebase] |
| zod | (existing) | Config schema validation | Already used for all config schemas [VERIFIED: codebase] |
| pino | (existing) | Logging | Already used project-wide [VERIFIED: codebase] |
| vitest | ^4.0.18 | Test framework | Already configured in project [VERIFIED: package.json] |

### Supporting
No new libraries needed. This phase assembles existing primitives.

### Alternatives Considered
None -- all building blocks exist in the codebase.

## Architecture Patterns

### Recommended Project Structure
```
src/sentinel/
  scanner.ts       # NEW: SentinelScanner class
  imap-ops.ts      # EXISTING: findSentinel() used by scanner
  store.ts         # EXISTING: SentinelStore.getAll() used by scanner
  lifecycle.ts     # EXISTING: not modified (planting/cleanup, not scanning)
  detect.ts        # EXISTING: not modified
  format.ts        # EXISTING: not modified
  index.ts         # MODIFIED: add SentinelScanner export
src/config/
  schema.ts        # MODIFIED: add sentinel scan interval config
src/
  index.ts         # MODIFIED: instantiate and wire SentinelScanner
```

### Pattern 1: Timer Worker (MoveTracker Pattern)
**What:** start/stop/getState lifecycle with running guard and fire-and-forget initial execution
**When to use:** Any periodic background task
**Example:**
```typescript
// Source: src/tracking/index.ts (lines 53-158) [VERIFIED: codebase]
export class SentinelScanner {
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastScanAt: string | null = null;

  start(): void {
    if (!this.deps.enabled) return;  // D-13: respect sentinelEnabled flag
    this.stop();

    // D-09: fire-and-forget initial scan
    this.runScan().catch((err) => {
      this.deps.logger?.error({ err }, 'SentinelScanner initial scan failed');
    });

    this.scanTimer = setInterval(() => {
      this.runScan().catch((err) => {
        this.deps.logger?.error({ err }, 'SentinelScanner scan failed');
      });
    }, this.deps.scanIntervalMs);
  }

  stop(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }
}
```

### Pattern 2: Two-Tier Scan (Fast Path + Deep Scan)
**What:** Check expected folder first, only search all folders on miss
**When to use:** Sentinel location verification
**Example:**
```typescript
// Recommended approach [ASSUMED: based on D-04, D-05, D-06]
async function scanSentinel(
  client: ImapClient,
  sentinel: Sentinel,
  allFolders: string[],
): Promise<ScanResult> {
  // Fast path: check expected folder
  const uid = await findSentinel(client, sentinel.folderPath, sentinel.messageId);
  if (uid !== undefined) {
    return { messageId: sentinel.messageId, status: 'found-in-place', expectedFolder: sentinel.folderPath };
  }

  // Deep scan: iterate all folders, short-circuit on first match
  for (const folder of allFolders) {
    if (folder === sentinel.folderPath) continue; // Already checked
    try {
      const deepUid = await findSentinel(client, folder, sentinel.messageId);
      if (deepUid !== undefined) {
        return {
          messageId: sentinel.messageId,
          status: 'found-in-different-folder',
          expectedFolder: sentinel.folderPath,
          actualFolder: folder,
        };
      }
    } catch {
      // Per-folder errors: skip and continue searching
    }
  }

  return { messageId: sentinel.messageId, status: 'not-found', expectedFolder: sentinel.folderPath };
}
```

### Pattern 3: Transient IMAP Error Handling
**What:** Catch NoConnection/ETIMEOUT at scan level, log at debug, retry next interval
**When to use:** Any IMAP operation in periodic worker
**Example:**
```typescript
// Source: src/tracking/index.ts (lines 148-154) [VERIFIED: codebase]
catch (err) {
  const code = (err as { code?: string })?.code;
  if (code === 'NoConnection' || code === 'ETIMEOUT') {
    this.deps.logger?.debug({ err }, 'SentinelScanner scan skipped (transient IMAP error)');
  } else {
    throw err;
  }
}
```

### Anti-Patterns to Avoid
- **Caching scan results:** D-07 explicitly says no caching. Scans run periodically, stale cache adds complexity for no benefit.
- **Updating store from scanner:** D-03 locks this -- scanner is detection-only. Phase 31 owns all healing.
- **Coordinating with monitor timer:** D-12 says independent. IMAP serialization is already handled by `withMailboxLock()`.
- **Deep scanning on every run:** D-04 mandates fast-path first. Deep scan is expensive (iterates all folders).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP SEARCH by header | Raw IMAP commands | `findSentinel()` | Already handles header search, returns UID [VERIFIED: codebase] |
| Folder enumeration | Custom IMAP LIST parsing | `ImapClient.listMailboxes()` | Returns `{ path, flags }[]`, already used by DestinationResolver [VERIFIED: codebase] |
| Timer lifecycle | Custom setTimeout chains | MoveTracker start/stop/setInterval pattern | Battle-tested in production [VERIFIED: codebase] |
| Connection serialization | Manual lock management | `ImapClient.withMailboxLock()` | Already serializes IMAP access [VERIFIED: codebase] |

**Key insight:** Every building block exists. The scanner's value is in the composition and the scan result types, not in new IMAP primitives.

## Common Pitfalls

### Pitfall 1: INBOX in folder listing
**What goes wrong:** `listMailboxes()` returns INBOX in the folder list, but INBOX never has a sentinel (SENT-05). Scanning INBOX wastes time.
**Why it happens:** `listMailboxes()` returns ALL folders including INBOX.
**How to avoid:** Filter INBOX from the deep scan folder list.
**Warning signs:** Unnecessary IMAP SEARCH on INBOX during every deep scan.

### Pitfall 2: withMailboxLock during deep scan
**What goes wrong:** `findSentinel()` uses `searchByHeader()` which calls `withMailboxLock()` internally. During deep scan, this means acquiring the lock for each folder in sequence, potentially blocking monitor IDLE.
**Why it happens:** IMAP protocol is inherently single-connection, single-mailbox.
**How to avoid:** This is expected behavior per D-12 -- the lock ensures correctness. Deep scan only triggers on missing sentinels (rare). The lock is released between folders, allowing monitor to interleave.
**Warning signs:** If deep scans take extremely long (100+ folders), monitor latency could spike.

### Pitfall 3: Forgetting to check sentinelEnabled
**What goes wrong:** Scanner starts even when sentinel self-test failed, causing SEARCH errors on servers that don't support header search.
**Why it happens:** Missing the guard in start().
**How to avoid:** D-13 explicitly requires checking the flag. Pass `enabled` as a deps parameter.
**Warning signs:** SEARCH errors in logs on servers without header search support.

### Pitfall 4: Deep scan folder exclusion
**What goes wrong:** Deep scan searches the expected folder again (already checked in fast path).
**Why it happens:** Not filtering the expected folder from the folder list.
**How to avoid:** Skip `sentinel.folderPath` in the deep scan loop.
**Warning signs:** Redundant IMAP SEARCH operations.

### Pitfall 5: NostrstrSpecial-use folders (Trash, Junk)
**What goes wrong:** Sentinel moved to Trash might be found by deep scan, reporting a "rename" when really the user deleted it.
**Why it happens:** Deep scan searches all folders indiscriminately.
**How to avoid:** This is actually correct behavior per the decisions -- scanner reports location, Phase 31 interprets the meaning. Scanner should NOT filter special-use folders.
**Warning signs:** N/A -- this is expected.

## Code Examples

### ScanResult Types (Recommended)
```typescript
// Discretion area: type names [ASSUMED: recommendation]
export type ScanStatus = 'found-in-place' | 'found-in-different-folder' | 'not-found';

export interface ScanResultBase {
  messageId: string;
  expectedFolder: string;
  folderPurpose: string;
}

export interface FoundInPlace extends ScanResultBase {
  status: 'found-in-place';
}

export interface FoundInDifferentFolder extends ScanResultBase {
  status: 'found-in-different-folder';
  actualFolder: string;
}

export interface NotFound extends ScanResultBase {
  status: 'not-found';
}

export type ScanResult = FoundInPlace | FoundInDifferentFolder | NotFound;

export interface ScanReport {
  scannedAt: string;
  results: ScanResult[];
  deepScansTriggered: number;
  errors: number;
}
```

### SentinelScanner Dependencies Interface
```typescript
// Following MoveTracker deps pattern [VERIFIED: codebase]
export interface SentinelScannerDeps {
  client: ImapClient;
  sentinelStore: SentinelStore;
  scanIntervalMs: number;
  enabled: boolean;
  logger?: pino.Logger;
  onScanComplete?: (report: ScanReport) => void;  // Optional callback for Phase 31
}
```

### Config Schema Addition
```typescript
// Add to src/config/schema.ts alongside existing config [VERIFIED: codebase pattern]
export const sentinelConfigSchema = z.object({
  scanIntervalMs: z.number().int().positive().default(300_000), // 5 minutes
});

// Add to configSchema:
// sentinel: sentinelConfigSchema.default({ scanIntervalMs: 300_000 }),
```

### Wiring in src/index.ts
```typescript
// After sentinel self-test, before monitor.start() [VERIFIED: codebase wiring pattern]
import { SentinelScanner } from './sentinel/index.js';

// In main():
let sentinelScanner: SentinelScanner | undefined;

// After sentinelEnabled is set:
if (sentinelEnabled) {
  sentinelScanner = new SentinelScanner({
    client: imapClient,
    sentinelStore,
    scanIntervalMs: config.sentinel?.scanIntervalMs ?? 300_000,
    enabled: sentinelEnabled,
    logger,
  });
  sentinelScanner.start();
}
```

### Folder Listing for Deep Scan
```typescript
// Reuse existing listMailboxes() [VERIFIED: codebase]
const allFolders = await this.deps.client.listMailboxes();
const folderPaths = allFolders
  .map(mb => mb.path)
  .filter(p => p.toUpperCase() !== 'INBOX'); // SENT-05: INBOX never has sentinel
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual folder rename via API (Plan 25-04) | Sentinel-based auto-detection | v0.7 | Eliminates manual rename UI entirely |
| UID-based tracking | Message-ID based search | v0.7 decision | Survives UIDVALIDITY changes |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `searchByHeader()` does not require `withMailboxLock()` wrapping by caller | Architecture Patterns | If it does require explicit lock, deep scan loop needs restructuring |
| A2 | `listMailboxes()` does not require an open mailbox lock | Code Examples | If it does, need to acquire lock on INBOX first |
| A3 | 5-minute default interval is appropriate for rename detection latency | Config Schema | Users may want faster detection -- but config is adjustable |

## Open Questions

1. **Should scanner emit events or use callbacks?**
   - What we know: MoveTracker doesn't emit events, just runs its own logic internally
   - What's unclear: Phase 31 needs to consume scan reports -- callback vs. event emitter vs. polling
   - Recommendation: Use an `onScanComplete` callback in deps (simple, testable, matches codebase style). Phase 31 can wire it up.

2. **Config schema location: top-level `sentinel` or nested under `review`?**
   - What we know: moveTracking is nested under `review`. Sentinel system is broader than review.
   - What's unclear: Whether to add top-level `sentinel` section or nest under review
   - Recommendation: Top-level `sentinel` config section -- sentinels track all folders, not just review-related ones. This is a discretion area.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/sentinel` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAN-01 | Fast-path scan checks expected folder by Message-ID | unit | `npx vitest run test/unit/sentinel/scanner.test.ts -t "fast path"` | Wave 0 |
| SCAN-02 | Deep scan searches all folders on miss | unit | `npx vitest run test/unit/sentinel/scanner.test.ts -t "deep scan"` | Wave 0 |
| SCAN-03 | Configurable scan interval, default 5 min | unit | `npx vitest run test/unit/sentinel/scanner.test.ts -t "interval"` | Wave 0 |
| SCAN-04 | Independent timer, does not block monitor | unit | `npx vitest run test/unit/sentinel/scanner.test.ts -t "independent"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/sentinel/scanner.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/sentinel/scanner.test.ts` -- covers SCAN-01 through SCAN-04
- [ ] `test/unit/sentinel/` directory -- needs creation
- [ ] Mock helpers for ImapClient, SentinelStore -- may need shared fixtures

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- uses existing IMAP auth |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | zod schema for config interval validation |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious scan interval (0 or negative) | Denial of Service | zod `.positive()` validation on interval config |
| IMAP credential exposure in logs | Information Disclosure | pino logger already redacts auth -- no new exposure |

No significant security surface -- this phase reads sentinel locations via existing authenticated IMAP connection.

## Sources

### Primary (HIGH confidence)
- `src/tracking/index.ts` -- MoveTracker timer pattern (lines 53-158) [VERIFIED: codebase read]
- `src/sentinel/imap-ops.ts` -- findSentinel() API [VERIFIED: codebase read]
- `src/sentinel/store.ts` -- SentinelStore.getAll() API [VERIFIED: codebase read]
- `src/imap/client.ts` -- listMailboxes() API (line 178) [VERIFIED: codebase read]
- `src/config/schema.ts` -- Config schema patterns [VERIFIED: codebase read]
- `src/index.ts` -- Application wiring patterns [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)
- None needed -- all findings verified against codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing [VERIFIED: codebase]
- Architecture: HIGH -- follows established MoveTracker pattern exactly [VERIFIED: codebase]
- Pitfalls: HIGH -- derived from codebase analysis of existing patterns [VERIFIED: codebase]

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (stable -- internal codebase patterns, no external dependency changes)
