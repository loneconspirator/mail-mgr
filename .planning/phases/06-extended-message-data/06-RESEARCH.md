# Phase 6: Extended Message Data - Research

**Researched:** 2026-04-11
**Domain:** IMAP header fetching, message type extension, SQLite schema migration
**Confidence:** HIGH

## Summary

This phase extends EmailMessage with envelope recipient and header visibility fields, adds auto-discovery of the correct envelope recipient header for the IMAP provider, and replaces the ad-hoc try/catch migration pattern with a versioned migration system. The existing codebase has clean separation points that make this tractable: `parseMessage()` and `parseRawToReviewMessage()` are the sole message construction sites, `fetchNewMessages()` and `fetchAllMessages()` are the sole IMAP fetch sites, and `ActivityLog.migrate()` is the sole migration site to replace.

ImapFlow 1.2.8 natively supports fetching specific headers via `headers: ['Header-Name']` in the fetch query, returning them as a Buffer. The response comes back on `result.headers` as raw RFC 2822 header lines. This is the correct mechanism for both discovery probing and ongoing header fetching -- no bodyParts workaround needed.

**Primary recommendation:** Build a `HeaderDiscovery` module that probes INBOX for candidate headers, persist the result in config.yml via `imap.envelopeHeader`, then conditionally add `headers: [envelopeHeader, 'List-Id']` to all fetch queries in ImapClient. Use a `schema_version` table with timestamped migration functions for all future DB changes.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Auto-discovery triggers when the user submits IMAP server config in the UI, regardless of whether config values changed. Not on every automatic reconnect -- only on explicit user action.
- **D-02:** Discovery probes 10 most recent messages in INBOX immediately after IMAP connection is established post-config-submit. Candidate headers: Delivered-To, X-Delivered-To, X-Original-To, X-Resolved-To, Envelope-To.
- **D-03:** Monitor pauses until discovery completes. No messages process with incomplete data. If discovery finds no usable envelope header, Monitor starts with MATCH-06 behavior (envelope/visibility fields unavailable, rules using them skipped).
- **D-04:** Discovered header name persisted in config.yml as `imap.envelopeHeader` (e.g., `envelopeHeader: "Delivered-To"`).
- **D-05:** After discovery, only the identified envelope header plus List-Id are fetched on subsequent messages. No fetching all candidate headers on every message.
- **D-06:** Header fetching centralized in ImapClient. Fetch methods (fetchNewMessages, fetchAllMessages, fetchMessagesRaw) add the header fields to the IMAP FETCH command. parseMessage() in messages.ts extracts values into EmailMessage. Single fetch site, single parse site.
- **D-07:** Each message gets a single visibility value using priority order: list (List-Id present) > direct (envelope recipient in To) > cc (envelope recipient in CC) > bcc (fallback -- envelope recipient not found in To or CC).
- **D-08:** When envelope recipient is unavailable (no header discovered), visibility field is null/undefined. Rules matching on visibility are skipped per MATCH-06.
- **D-09:** New versioned migration system: schema_version table tracks applied migrations by timestamp. Migration functions run in timestamp order, each wrapped in a transaction.
- **D-10:** Bootstrap approach for existing schema: detect current state (columns/indexes present), mark existing migrations as applied, start fresh with new system. Existing try/catch ALTER TABLE code removed.

### Claude's Discretion
- Header probing order and consensus logic (how many of 10 messages need to have the header)
- EmailMessage type extension (field names for envelope recipient and visibility)
- ImapFlow-specific fetch query syntax for BODY[HEADER.FIELDS ...]
- Migration timestamp format and naming convention

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MATCH-01 | System auto-discovers the envelope recipient header by probing common headers on a sample of recent messages, storing the found header name in config | ImapFlow `headers` fetch query option, consensus algorithm, config schema extension |
| MATCH-02 | Auto-discovery triggers automatically on successful IMAP connect when server details change, and can be manually invoked from the UI | D-01 constrains this: triggers on UI config submit only, not auto-reconnect. IMAP config route already has PUT handler. |
| MATCH-06 | When envelope recipient header is not configured, envelope recipient and header visibility match fields are disabled and rules using them are skipped | Nullable fields on EmailMessage, visibility classification logic |

</phase_requirements>

## Standard Stack

### Core

No new dependencies required. This phase uses existing libraries exclusively.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.8 | IMAP header fetching via `headers` query option | Already in project, native header field support [VERIFIED: node_modules/imapflow/package.json] |
| better-sqlite3 | 12.6.2 | Versioned migration system with transactions | Already in project, `db.transaction()` for atomic migrations [VERIFIED: project dependency] |
| zod | 4.3.6 | Schema extension for `envelopeHeader` config field | Already in project [VERIFIED: project dependency] |

### Supporting

No additional supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw header Buffer parsing | mailparser library | Overkill -- we only need 1-2 header values from simple key:value lines, not full MIME parsing |
| Custom migration system | knex/umzug migration library | Overkill -- we have one SQLite file with 2 tables. A simple array of migration functions is sufficient |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

```
src/
  imap/
    messages.ts          # Extended EmailMessage type + header parsing
    client.ts            # fetchNewMessages/fetchAllMessages with conditional headers query
    discovery.ts         # NEW: HeaderDiscovery module
  config/
    schema.ts            # imapConfigSchema with envelopeHeader field
  log/
    index.ts             # ActivityLog with versioned migration system
    migrations.ts        # NEW: Migration definitions array
```

### Pattern 1: ImapFlow Header Fetch Query

**What:** ImapFlow's `fetch()` accepts a `headers` property that can be an array of header names. This generates `BODY.PEEK[HEADER.FIELDS (Header1 Header2)]` in the IMAP command. The response includes `result.headers` as a Buffer containing the raw header lines.

**When to use:** Every fetch call when `envelopeHeader` is configured.

**Example:**
```typescript
// Source: Verified from node_modules/imapflow/lib/commands/fetch.js line 105-111
// and node_modules/imapflow/lib/imap-flow.js line 2530

// Fetch query with specific headers
const query = {
  uid: true,
  envelope: true,
  flags: true,
  headers: ['Delivered-To', 'List-Id'],  // generates BODY.PEEK[HEADER.FIELDS (...)]
};

for await (const msg of flow.fetch(range, query, { uid: true })) {
  // msg.headers is a Buffer containing raw header lines like:
  // "Delivered-To: user@example.com\r\nList-Id: <list.example.com>\r\n"
  const headerText = msg.headers?.toString('utf-8') ?? '';
}
```
[VERIFIED: imapflow source code at node_modules/imapflow/lib/commands/fetch.js:105-111]

### Pattern 2: Raw Header Line Parsing

**What:** Parse Buffer header response into key-value pairs. RFC 2822 headers are `Key: Value\r\n` format with possible continuation lines (lines starting with whitespace).

**When to use:** After receiving `result.headers` from ImapFlow fetch.

**Example:**
```typescript
// Source: RFC 2822 header format [ASSUMED - standard RFC parsing]
function parseHeaderLines(buf: Buffer | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!buf) return headers;

  const text = buf.toString('utf-8');
  const lines = text.split(/\r?\n/);
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    if (line === '') continue;
    if (/^\s/.test(line)) {
      // Continuation line (folded header)
      currentValue += ' ' + line.trim();
    } else {
      if (currentKey) {
        headers.set(currentKey.toLowerCase(), currentValue.trim());
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        currentKey = line.substring(0, colonIdx);
        currentValue = line.substring(colonIdx + 1);
      }
    }
  }
  if (currentKey) {
    headers.set(currentKey.toLowerCase(), currentValue.trim());
  }
  return headers;
}
```

### Pattern 3: Visibility Classification

**What:** Derive a single visibility value from envelope recipient + To/CC fields + List-Id header.

**When to use:** During message parsing after headers are extracted.

**Example:**
```typescript
// Priority: list > direct > cc > bcc
type Visibility = 'list' | 'direct' | 'cc' | 'bcc';

function classifyVisibility(
  envelopeRecipient: string | undefined,
  toAddresses: EmailAddress[],
  ccAddresses: EmailAddress[],
  listId: string | undefined,
): Visibility | undefined {
  if (!envelopeRecipient) return undefined;  // MATCH-06: unavailable

  if (listId) return 'list';

  const envLower = envelopeRecipient.toLowerCase();
  if (toAddresses.some(a => a.address.toLowerCase() === envLower)) return 'direct';
  if (ccAddresses.some(a => a.address.toLowerCase() === envLower)) return 'cc';

  return 'bcc';  // Envelope recipient not in To or CC
}
```

### Pattern 4: Versioned Migration System

**What:** Replace try/catch ALTER TABLE with a `schema_version` table and ordered migration functions.

**When to use:** All database schema changes going forward.

**Example:**
```typescript
// Source: better-sqlite3 transaction API [VERIFIED: better-sqlite3 docs]
interface Migration {
  version: string;       // Timestamp like '20260411_001'
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: '20260411_001',
    description: 'Add source column and indexes (bootstrap existing schema)',
    up: (db) => {
      // Bootstrap: detect if column exists, add if not
      const cols = db.pragma('table_info(activity)') as Array<{ name: string }>;
      if (!cols.some(c => c.name === 'source')) {
        db.exec(`ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'`);
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_activity_source ON activity(source)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_activity_folder_success ON activity(folder, success)');
    },
  },
];

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: string }>)
      .map(r => r.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    });
    run();
  }
}
```

### Anti-Patterns to Avoid

- **Fetching all candidate headers on every message:** D-05 explicitly prohibits this. Only fetch the discovered header + List-Id after discovery.
- **Try/catch ALTER TABLE for migrations:** D-10 requires removing this pattern. The bootstrap migration detects state via `pragma table_info()`.
- **Modifying EmailMessage as a class:** EmailMessage is an interface with plain objects. Keep it that way -- just add optional fields.
- **Running discovery on every reconnect:** D-01 locks this to UI config submissions only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP header fetching | Custom BODY.PEEK command construction | ImapFlow `headers: [...]` query option | Already handles IMAP protocol encoding, response parsing [VERIFIED: imapflow source] |
| Database transactions | Manual BEGIN/COMMIT SQL | `better-sqlite3` `db.transaction()` | Handles rollback on error, nested transactions, proper locking [VERIFIED: better-sqlite3 docs] |
| Config persistence | Direct file writes | Existing `saveConfig()` in loader.ts | Handles env var preservation, atomic writes, Zod validation |

**Key insight:** ImapFlow already supports the exact header fetching pattern needed. The `headers: string[]` fetch query option generates `BODY.PEEK[HEADER.FIELDS (...)]` and returns the result as a Buffer on `result.headers`. No need to use bodyParts or any workaround.

## Common Pitfalls

### Pitfall 1: ImapFlow headers Buffer Parsing

**What goes wrong:** The `result.headers` from ImapFlow is a Buffer, not a parsed object. Developers might expect a Map or object.
**Why it happens:** ImapFlow returns raw header lines as-is from the IMAP server.
**How to avoid:** Write a dedicated `parseHeaderLines()` function that handles RFC 2822 line folding (continuation lines starting with whitespace) and case-insensitive key matching.
**Warning signs:** Missing header values when they span multiple lines.

### Pitfall 2: Discovery Consensus with Empty Headers

**What goes wrong:** Some messages may not have any of the candidate headers (e.g., messages sent directly to the primary address without routing through a provider alias).
**Why it happens:** Envelope headers like Delivered-To are added by the receiving MTA, not the sender. Some servers strip them, or they may be absent on very old messages.
**How to avoid:** Require a minimum threshold (e.g., 3 out of 10 messages) to have the header before accepting it. If multiple candidate headers appear, prefer the one with highest frequency. If none reach threshold, set envelopeHeader to null (MATCH-06 behavior).
**Warning signs:** Discovery succeeds but the chosen header is unreliable for newer messages.

### Pitfall 3: Config Schema Breaking Existing Configs

**What goes wrong:** Adding `envelopeHeader` as required to `imapConfigSchema` would break existing config.yml files that don't have it.
**Why it happens:** Zod validation on config load rejects unknown/missing fields.
**How to avoid:** Make `envelopeHeader` optional with `.optional()`: `envelopeHeader: z.string().optional()`. It starts undefined and gets populated by discovery.
**Warning signs:** Application crashes on startup after upgrade.

### Pitfall 4: Fetch Query Inconsistency Across Methods

**What goes wrong:** Adding headers to `fetchNewMessages()` but forgetting `fetchAllMessages()` or vice versa, causing messages to have different shapes depending on how they were fetched.
**Why it happens:** There are 3 fetch methods in ImapClient (fetchNewMessages, fetchAllMessages, fetchMessagesRaw) plus parseRawToReviewMessage as a separate parse site.
**How to avoid:** Centralize the headers list in a single method like `getHeaderFields(): string[]` on ImapClient, and have all fetch methods reference it. Both `parseMessage()` and `parseRawToReviewMessage()` must extract the same fields.
**Warning signs:** Visibility field is populated for Monitor-processed messages but undefined for Sweep-processed messages.

### Pitfall 5: Bootstrap Migration Ordering

**What goes wrong:** The bootstrap migration tries to add columns that the old try/catch code already added, or vice versa.
**Why it happens:** The bootstrap must handle both fresh databases AND databases with the old try/catch migrations already applied.
**How to avoid:** The first migration uses `pragma table_info()` to detect existing columns and `CREATE INDEX IF NOT EXISTS` for indexes. It's purely idempotent. Then it records itself in schema_version so it never runs again.
**Warning signs:** "duplicate column name" errors on startup for existing users.

### Pitfall 6: ReviewMessage Missing New Fields

**What goes wrong:** `ReviewMessage` interface and `reviewMessageToEmailMessage()` don't carry the new envelope/visibility fields, so sweep-processed messages lose this data.
**Why it happens:** ReviewMessage has its own interface separate from EmailMessage, and `reviewMessageToEmailMessage()` manually maps fields.
**How to avoid:** Extend both ReviewMessage and EmailMessage. Update `reviewMessageToEmailMessage()` to pass through the new fields. Update `parseRawToReviewMessage()` to extract headers the same way as `parseMessage()`.
**Warning signs:** Rules with visibility conditions work in Monitor but not in Sweep or Batch.

## Code Examples

### Extending EmailMessage Interface

```typescript
// Source: Existing pattern in src/imap/messages.ts [VERIFIED: codebase]
export type Visibility = 'list' | 'direct' | 'cc' | 'bcc';

export interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
  // New fields (Phase 6)
  envelopeRecipient?: string;    // Value from discovered envelope header
  visibility?: Visibility;        // Derived classification
}
```

### Extending ImapConfigSchema

```typescript
// Source: Existing pattern in src/config/schema.ts [VERIFIED: codebase]
export const imapConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(993),
  tls: z.boolean().default(true),
  auth: imapAuthSchema,
  idleTimeout: z.number().int().positive().default(300_000),
  pollInterval: z.number().int().positive().default(60_000),
  envelopeHeader: z.string().optional(),  // NEW: discovered header name
});
```

### Discovery Probe Using fetchMessagesRaw

```typescript
// Source: ImapClient.fetchMessagesRaw pattern [VERIFIED: codebase]
const CANDIDATE_HEADERS = [
  'Delivered-To',
  'X-Delivered-To',
  'X-Original-To',
  'X-Resolved-To',
  'Envelope-To',
];

async function probeEnvelopeHeaders(client: ImapClient): Promise<string | null> {
  // Fetch last 10 messages with all candidate headers
  const results = await client.withMailboxLock('INBOX', async (flow) => {
    const msgs: unknown[] = [];
    for await (const msg of flow.fetch('1:*', {
      uid: true,
      headers: CANDIDATE_HEADERS,
    }, { uid: true })) {
      msgs.push(msg);
    }
    // Take last 10 by UID
    return msgs.slice(-10);
  });

  // Count which headers appear
  const counts = new Map<string, number>();
  for (const raw of results) {
    const msg = raw as { headers?: Buffer };
    const parsed = parseHeaderLines(msg.headers);
    for (const candidate of CANDIDATE_HEADERS) {
      if (parsed.has(candidate.toLowerCase()) &&
          parsed.get(candidate.toLowerCase())!.includes('@')) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
  }

  // Find header with highest count, minimum threshold of 3
  let bestHeader: string | null = null;
  let bestCount = 0;
  for (const [header, count] of counts) {
    if (count >= 3 && count > bestCount) {
      bestHeader = header;
      bestCount = count;
    }
  }

  return bestHeader;
}
```

### Conditional Header Fetch in ImapClient

```typescript
// Source: Existing fetchNewMessages pattern [VERIFIED: codebase]
// ImapClient needs access to envelopeHeader config to build query

private getHeaderFields(): string[] | undefined {
  if (!this.config.envelopeHeader) return undefined;
  return [this.config.envelopeHeader, 'List-Id'];
}

async fetchNewMessages(sinceUid: number): Promise<unknown[]> {
  return this.withMailboxLock('INBOX', async (flow) => {
    const range = sinceUid > 0 ? `${sinceUid + 1}:*` : '1:*';
    const query: Record<string, unknown> = {
      uid: true,
      envelope: true,
      flags: true,
    };
    const headerFields = this.getHeaderFields();
    if (headerFields) {
      query.headers = headerFields;
    }
    const results: unknown[] = [];
    for await (const msg of flow.fetch(range, query, { uid: true })) {
      const m = msg as { uid?: number };
      if (m.uid !== undefined && m.uid > sinceUid) {
        results.push(msg);
      }
    }
    return results;
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Try/catch ALTER TABLE | Versioned migration table | This phase | All future schema changes are tracked, ordered, transactional |
| EmailMessage without routing info | EmailMessage with envelopeRecipient + visibility | This phase | Enables Phase 7 envelope/visibility matching |

**Deprecated/outdated:**
- `ActivityLog.migrate()` try/catch pattern: Replaced by versioned migration system in this phase

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RFC 2822 header parsing with line folding is sufficient (no MIME encoded-word decoding needed for envelope headers) | Pattern 2 | LOW -- envelope headers contain email addresses, not display names. If a provider MIME-encodes them, parsing would miss the value. Could add `libmime.decodeWords()` as safety measure. |
| A2 | Minimum threshold of 3/10 messages for discovery consensus is appropriate | Pitfall 2 | LOW -- user can re-run discovery. Too low a threshold risks false positives. |
| A3 | `envelopeHeader` as a simple string field in config.yml is sufficient (no need for per-folder or per-account variations) | Pattern, D-04 | LOW -- single-instance app, one mailbox. D-04 locks this decision. |

**If this table is empty:** N/A -- three assumptions identified above.

## Open Questions

1. **Should discovery fetch the last 10 by sequence number or UID?**
   - What we know: D-02 says "10 most recent messages in INBOX." Using sequence numbers (`*:*` with descending) or fetching all UIDs and taking last 10.
   - What's unclear: Whether to use `*` sequence range (which could be slow on huge mailboxes) or a targeted approach.
   - Recommendation: Fetch with sequence range `*:*` limited by ImapFlow, or use `(total-9):*` sequence range to get the last 10. The discovery runs once (not per-message), so efficiency is secondary to correctness. Use `fetchMessagesRaw` with a calculated sequence range.

2. **How should the IMAP config route trigger discovery?**
   - What we know: D-01 says discovery triggers on IMAP config UI submission. The existing `PUT /api/config/imap` handler calls `configRepo.updateImapConfig()` which fires `imapListeners`. The listener in `src/index.ts` already rebuilds ImapClient and Monitor.
   - What's unclear: Whether discovery should be part of the existing `onImapConfigChange` listener flow or a separate step.
   - Recommendation: Add discovery as a step in the `onImapConfigChange` handler in `src/index.ts`, after the new ImapClient connects but before Monitor starts processing. This keeps the existing trigger mechanism and avoids a new API endpoint (Phase 8 will add a dedicated re-run button if needed).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run && npx vitest run --config vitest.integration.config.ts` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MATCH-01 | Discovery probes headers, finds consensus, persists to config | unit | `npx vitest run test/unit/imap/discovery.test.ts -t "discovery"` | No -- Wave 0 |
| MATCH-01 | parseHeaderLines correctly parses Buffer to Map | unit | `npx vitest run test/unit/imap/messages.test.ts -t "header"` | Partially (file exists, tests don't) |
| MATCH-02 | Discovery triggers on IMAP config change (not reconnect) | unit | `npx vitest run test/unit/imap/discovery.test.ts -t "trigger"` | No -- Wave 0 |
| MATCH-06 | When no envelope header, fields are undefined, no crash | unit | `npx vitest run test/unit/imap/messages.test.ts -t "visibility"` | No -- Wave 0 |
| MATCH-06 | Visibility classification: list > direct > cc > bcc | unit | `npx vitest run test/unit/imap/messages.test.ts -t "classify"` | No -- Wave 0 |
| D-09 | Migrations run in order, skip already-applied, wrap in transaction | unit | `npx vitest run test/unit/log/migrations.test.ts` | No -- Wave 0 |
| D-10 | Bootstrap detects existing schema, marks migrations applied | unit | `npx vitest run test/unit/log/migrations.test.ts -t "bootstrap"` | No -- Wave 0 |
| D-06 | fetchNewMessages and fetchAllMessages include headers in query | unit | `npx vitest run test/unit/imap/client.test.ts -t "header"` | Partially (file exists) |

### Sampling Rate

- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run && npx vitest run --config vitest.integration.config.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/unit/imap/discovery.test.ts` -- covers MATCH-01, MATCH-02
- [ ] New test cases in `test/unit/imap/messages.test.ts` -- covers visibility classification, header parsing
- [ ] `test/unit/log/migrations.test.ts` -- covers D-09, D-10 migration system
- [ ] New test cases in `test/unit/imap/client.test.ts` -- covers conditional header fetch queries

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- no auth changes |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A -- single instance, no auth |
| V5 Input Validation | Yes | Zod schema validation for envelopeHeader config field |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed header injection via IMAP response | Tampering | Parse headers defensively, validate extracted email addresses against expected format |
| SQL injection via migration code | Tampering | Use parameterized queries (already used in better-sqlite3 prepared statements), no string interpolation in SQL |

## Project Constraints (from CLAUDE.md)

- TypeScript strict mode, explicit return types, no `any`
- camelCase functions/variables, PascalCase types
- `.js` extension on all local imports
- Relative import paths, barrel files via `index.ts`
- Error handling: `err instanceof Error ? err : new Error(String(err))`
- Pino logger with name and context objects
- Zod for all runtime validation
- Functions 10-50 lines, max 3-4 parameters (use objects)
- No default exports (except classes in rare cases)
- JSDoc blocks for public functions (plain description, no @param/@returns)
- Vitest for testing

## Sources

### Primary (HIGH confidence)
- ImapFlow source code at `node_modules/imapflow/lib/commands/fetch.js:105-111` -- headers query option generates BODY.PEEK[HEADER.FIELDS ...]
- ImapFlow source code at `node_modules/imapflow/lib/imap-flow.js:2530` -- headers property documentation
- ImapFlow source code at `node_modules/imapflow/lib/tools.js:377-383` -- response parsing maps HEADER.FIELDS to `result.headers` Buffer
- Codebase: `src/imap/client.ts` -- existing fetch methods, withMailboxLock pattern
- Codebase: `src/imap/messages.ts` -- EmailMessage interface, parseMessage(), parseRawToReviewMessage()
- Codebase: `src/log/index.ts` -- current migration pattern, ActivityLog constructor
- Codebase: `src/config/schema.ts` -- imapConfigSchema, Zod patterns
- Codebase: `src/config/repository.ts` -- onImapConfigChange listener pattern
- Codebase: `src/index.ts` -- main lifecycle, IMAP config change handler

### Secondary (MEDIUM confidence)
- better-sqlite3 `db.transaction()` API -- well-documented, standard pattern

### Tertiary (LOW confidence)
- RFC 2822 header parsing assumptions (A1) -- standard format but edge cases exist

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, fetch API verified in source
- Architecture: HIGH -- clear integration points identified, existing patterns to follow
- Pitfalls: HIGH -- enumerated from direct code analysis, verified fetch response format
- Discovery logic: MEDIUM -- consensus threshold is discretionary (A2)

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable -- no fast-moving dependencies)
