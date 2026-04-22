# Phase 26: Sentinel Store & Message Format - Research

**Researched:** 2026-04-21
**Domain:** IMAP message construction + SQLite persistence for sentinel tracking
**Confidence:** HIGH

## Summary

Phase 26 builds two foundational pieces for the v0.7 sentinel system: (1) a message format builder that constructs RFC 2822-compliant raw email strings suitable for IMAP APPEND, and (2) a SQLite store that persists sentinel-to-folder mappings. No IMAP operations occur in this phase -- that is Phase 28's job. The builder produces a raw string with custom headers; the store does CRUD against the existing activity database.

The codebase already establishes clear patterns for both concerns. `SignalStore` (in `src/tracking/signals.ts`) demonstrates the exact DB access pattern: a class that accepts a `Database.Database` instance, uses prepared statements, and maps snake_case rows to camelCase TypeScript interfaces. The migration system in `src/log/migrations.ts` uses versioned migrations tracked in `schema_migrations`. UUID generation uses Node's built-in `crypto.randomUUID()` (already used in `src/config/repository.ts`). No new npm dependencies are required.

**Primary recommendation:** Follow the SignalStore pattern exactly -- class with injected `Database.Database`, versioned migration for the `sentinels` table, and raw RFC 2822 string construction (no need for nodemailer/mailcomposer since the message is trivially simple).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Subject line format: `[Mail Manager] Sentinel: {folder_path}`
- **D-02:** From address: `mail-manager@localhost`
- **D-03:** Body text is descriptive and varies by folder purpose
- **D-04:** Custom header `X-Mail-Mgr-Sentinel: {message_id}` for fast IMAP SEARCH
- **D-05:** `\Seen` flag set on construction so sentinels don't appear as unread
- **D-06:** Message-ID format: `<{uuid}@mail-manager.sentinel>`
- **D-07:** New `sentinels` table via migration in existing activity DB
- **D-08:** Schema: `message_id TEXT PRIMARY KEY, folder_path TEXT NOT NULL, folder_purpose TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **D-09:** Index on `folder_path` for lookup-by-folder queries
- **D-10:** New `src/sentinel/` directory
- **D-11:** Files: `format.ts` (message builder), `store.ts` (SQLite CRUD), `index.ts` (re-exports)
- **D-12:** Builder refuses to create sentinel for INBOX (throws error)

### Claude's Discretion
- Body text exact wording and formatting
- Internal naming conventions for types/interfaces
- Test file organization within the sentinel module

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SENT-02 | Sentinel messages have unique Message-ID, X-Mail-Mgr-Sentinel header, \Seen flag, descriptive subject/body | Format builder in `format.ts` constructs RFC 2822 raw string with all required headers; \Seen flag returned as metadata for IMAP APPEND |
| SENT-03 | Sentinel Message-ID to folder purpose mappings persisted in SQLite | SentinelStore class in `store.ts` follows SignalStore pattern with versioned migration |
| SENT-05 | INBOX does not receive a sentinel | Builder-level validation throws on `INBOX` folder_path input |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 (latest 12.9.0) | SQLite persistence for sentinel mappings | Already in project, used by ActivityLog and SignalStore [VERIFIED: package.json] |
| node:crypto | built-in | UUID v4 generation via `crypto.randomUUID()` | Already used in `src/config/repository.ts` [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 (latest 4.1.5) | Unit testing | Test format builder and store [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw RFC 2822 string | nodemailer/mailcomposer | Overkill -- sentinel messages are trivial plain text with 5-6 headers; raw string is ~15 lines, fully controllable, zero dependencies |
| `uuid` npm package | `crypto.randomUUID()` | Built-in is already used in the project; no reason to add a dependency |

**Installation:**
```bash
# No new dependencies required
```

**Version verification:** better-sqlite3 latest is 12.9.0, project pins ^12.6.2. vitest latest is 4.1.5, project pins ^4.0.18. Both compatible. [VERIFIED: npm registry]

## Architecture Patterns

### Recommended Project Structure
```
src/
├── sentinel/
│   ├── format.ts       # buildSentinelMessage() -- returns raw RFC 2822 string + metadata
│   ├── store.ts        # SentinelStore class -- CRUD for sentinels table
│   └── index.ts        # Re-exports
test/
└── unit/
    └── sentinel/
        ├── format.test.ts
        └── store.test.ts
```

### Pattern 1: Raw RFC 2822 Message Construction
**What:** Build a plain text email string with headers and body, suitable for IMAP APPEND
**When to use:** When the message is simple (no attachments, no HTML, no MIME multipart)
**Example:**
```typescript
// Source: RFC 2822 + project decisions D-01 through D-06
interface SentinelMessage {
  /** Raw RFC 2822 message string for IMAP APPEND */
  raw: string;
  /** Message-ID for storage and SEARCH */
  messageId: string;
  /** Flags to set on APPEND ([\Seen]) */
  flags: string[];
}

function buildSentinelMessage(opts: {
  folderPath: string;
  folderPurpose: string;
  bodyText: string;
}): SentinelMessage {
  if (opts.folderPath === 'INBOX') {
    throw new Error('Cannot create sentinel for INBOX');
  }

  const uuid = crypto.randomUUID();
  const messageId = `<${uuid}@mail-manager.sentinel>`;
  const date = new Date().toUTCString();

  const raw = [
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `From: mail-manager@localhost`,
    `To: mail-manager@localhost`,
    `Subject: [Mail Manager] Sentinel: ${opts.folderPath}`,
    `X-Mail-Mgr-Sentinel: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    opts.bodyText,
  ].join('\r\n');

  return { raw, messageId, flags: ['\\Seen'] };
}
```

### Pattern 2: SQLite Store (SignalStore Pattern)
**What:** Class that accepts injected `Database.Database`, uses prepared statements for CRUD
**When to use:** All SQLite data access in this project
**Example:**
```typescript
// Source: src/tracking/signals.ts (established project pattern)
import type Database from 'better-sqlite3';

interface SentinelRow {
  message_id: string;
  folder_path: string;
  folder_purpose: string;
  created_at: string;
}

interface Sentinel {
  messageId: string;
  folderPath: string;
  folderPurpose: string;
  createdAt: string;
}

class SentinelStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsert(messageId: string, folderPath: string, folderPurpose: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO sentinels (message_id, folder_path, folder_purpose)
       VALUES (?, ?, ?)`
    ).run(messageId, folderPath, folderPurpose);
  }

  getByFolder(folderPath: string): Sentinel | null {
    const row = this.db.prepare(
      'SELECT * FROM sentinels WHERE folder_path = ?'
    ).get(folderPath) as SentinelRow | undefined;
    return row ? rowToSentinel(row) : null;
  }

  getByMessageId(messageId: string): Sentinel | null {
    const row = this.db.prepare(
      'SELECT * FROM sentinels WHERE message_id = ?'
    ).get(messageId) as SentinelRow | undefined;
    return row ? rowToSentinel(row) : null;
  }

  getAll(): Sentinel[] {
    const rows = this.db.prepare('SELECT * FROM sentinels').all() as SentinelRow[];
    return rows.map(rowToSentinel);
  }

  deleteByMessageId(messageId: string): boolean {
    const result = this.db.prepare('DELETE FROM sentinels WHERE message_id = ?').run(messageId);
    return result.changes > 0;
  }

  deleteByFolder(folderPath: string): boolean {
    const result = this.db.prepare('DELETE FROM sentinels WHERE folder_path = ?').run(folderPath);
    return result.changes > 0;
  }
}
```

### Pattern 3: Versioned Migration
**What:** Add sentinels table via the existing migration system
**When to use:** Any schema change to the activity database
**Example:**
```typescript
// Source: src/log/migrations.ts (established project pattern)
// Add to the migrations array:
{
  version: '20260421_001',
  description: 'Create sentinels table for folder tracking',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sentinels (
        message_id TEXT PRIMARY KEY,
        folder_path TEXT NOT NULL,
        folder_purpose TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sentinels_folder_path ON sentinels(folder_path)`);
  },
}
```

### Anti-Patterns to Avoid
- **Separate database file for sentinels:** The project uses a single `db.sqlite3` for all data. Do NOT create a second DB file -- use the shared connection via `activityLog.getDb()`. [VERIFIED: `src/index.ts` line 43]
- **Using nodemailer to construct sentinel messages:** The messages are trivially simple plain text. Introducing mail composition libraries adds complexity for zero benefit.
- **Storing the full raw message in SQLite:** Only the Message-ID and folder mapping need persistence. The raw message can be regenerated if re-planting is needed (Phase 28 concern).
- **Case-insensitive INBOX check:** Only check for exact string `'INBOX'` -- IMAP spec (RFC 3501 Section 5.1) states INBOX is case-insensitive, but this project normalizes to uppercase `INBOX` throughout. To be safe, do a case-insensitive comparison. [VERIFIED: IMAP RFC 3501]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom ID scheme | `crypto.randomUUID()` | RFC 4122 compliant, already used in project |
| Database migrations | Manual ALTER TABLE | Existing `runMigrations()` + `migrations[]` array | Versioned, idempotent, already tested |
| Shared DB access | New DB connection | `activityLog.getDb()` | Single WAL-mode connection, already established pattern |

**Key insight:** Every infrastructure piece this phase needs already exists in the codebase. The sentinel module is pure business logic on top of existing patterns.

## Common Pitfalls

### Pitfall 1: RFC 2822 Line Endings
**What goes wrong:** Using `\n` instead of `\r\n` in raw message strings
**Why it happens:** JavaScript string defaults; easy to forget IMAP/email requires CRLF
**How to avoid:** Always join headers with `\r\n`. Use a constant or helper.
**Warning signs:** IMAP APPEND succeeds but message displays incorrectly in mail clients

### Pitfall 2: Message-ID Angle Brackets
**What goes wrong:** Omitting `<` and `>` from Message-ID, or double-wrapping them
**Why it happens:** Confusion between header value (`<id@domain>`) and the ID itself
**How to avoid:** Store the full `<uuid@mail-manager.sentinel>` form consistently -- both in the header and in SQLite. When searching by Message-ID via IMAP, the angle brackets are part of the value.
**Warning signs:** IMAP SEARCH by Message-ID returns no results

### Pitfall 3: INBOX Case Sensitivity
**What goes wrong:** Checking `folderPath === 'INBOX'` misses `inbox` or `Inbox`
**Why it happens:** RFC 3501 says INBOX is case-insensitive, but most code uses uppercase
**How to avoid:** Use `folderPath.toUpperCase() === 'INBOX'` in the guard
**Warning signs:** Sentinel gets created for a folder named `Inbox` (lowercase variant)

### Pitfall 4: Date Header Format
**What goes wrong:** Using ISO 8601 format instead of RFC 2822 date format
**Why it happens:** `new Date().toISOString()` is the default instinct
**How to avoid:** Use `new Date().toUTCString()` which produces RFC 2822-compatible format (e.g., `Mon, 21 Apr 2026 12:00:00 GMT`)
**Warning signs:** Mail clients show garbled or missing dates

### Pitfall 5: Migration Version Ordering
**What goes wrong:** New migration version sorts before existing ones
**Why it happens:** Using a date that sorts wrong with string comparison
**How to avoid:** Follow existing `YYYYMMDD_NNN` convention. Current latest is `20260413_001`. Use `20260421_001` or later.
**Warning signs:** Test `migrations run in version-sort order` fails

## Code Examples

### Complete Format Builder
```typescript
// Verified pattern from project decisions + RFC 2822
import { randomUUID } from 'node:crypto';

export interface SentinelMessage {
  raw: string;
  messageId: string;
  flags: string[];
}

export interface BuildSentinelOpts {
  folderPath: string;
  folderPurpose: string;
  bodyText: string;
}

export function buildSentinelMessage(opts: BuildSentinelOpts): SentinelMessage {
  if (opts.folderPath.toUpperCase() === 'INBOX') {
    throw new Error('Cannot create sentinel for INBOX');
  }

  const uuid = randomUUID();
  const messageId = `<${uuid}@mail-manager.sentinel>`;
  const date = new Date().toUTCString();

  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `From: mail-manager@localhost`,
    `To: mail-manager@localhost`,
    `Subject: [Mail Manager] Sentinel: ${opts.folderPath}`,
    `X-Mail-Mgr-Sentinel: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ];

  const raw = headers.join('\r\n') + '\r\n\r\n' + opts.bodyText;

  return { raw, messageId, flags: ['\\Seen'] };
}
```

### Store Instantiation Pattern
```typescript
// Source: src/index.ts line 42-43 (established pattern)
// In application bootstrap:
import { SentinelStore } from './sentinel/index.js';

const sentinelStore = new SentinelStore(activityLog.getDb());
```

### Test Pattern (In-Memory DB)
```typescript
// Source: test/unit/log/migrations.test.ts (established pattern)
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/log/migrations.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // Run schema + migrations to get sentinels table
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `uuid` npm package | `crypto.randomUUID()` (Node 19+) | Node 19.x, 2022 | No dependency needed for UUID v4 |
| Manual SQL schema versioning | `schema_migrations` table pattern | Project convention (v0.5) | Consistent, testable migrations |

**Deprecated/outdated:**
- Nothing relevant -- this phase uses stable, well-established patterns

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `new Date().toUTCString()` produces RFC 2822-compatible date strings | Code Examples | LOW -- if format differs slightly, mail clients may show wrong date on sentinel; easily fixable |
| A2 | Body text in raw RFC 2822 does not need special encoding for ASCII-only content | Architecture Patterns | LOW -- sentinel body is plain English text, no special chars needed |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/sentinel/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SENT-02 | Message has unique Message-ID, X-Mail-Mgr-Sentinel header, \Seen flag, subject/body | unit | `npx vitest run test/unit/sentinel/format.test.ts -t "builds message"` | Wave 0 |
| SENT-03 | Sentinel mappings persist in SQLite (insert, query by folder, query by message-id) | unit | `npx vitest run test/unit/sentinel/store.test.ts` | Wave 0 |
| SENT-05 | Builder throws for INBOX | unit | `npx vitest run test/unit/sentinel/format.test.ts -t "INBOX"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/sentinel/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/sentinel/format.test.ts` -- covers SENT-02, SENT-05
- [ ] `test/unit/sentinel/store.test.ts` -- covers SENT-03

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- no auth in this phase |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Folder path validation (INBOX rejection); folder_purpose should be from known enum |
| V6 Cryptography | no | UUID is for uniqueness, not security |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via folder_path | Tampering | Parameterized queries (prepared statements) -- already the project standard |
| Header injection via folder_path | Tampering | Folder paths should not contain `\r\n`; validate or strip CRLF from folderPath before building headers |

## Open Questions

1. **Body text content for each folder purpose**
   - What we know: Body varies by purpose (D-03), action folders explain what the action does
   - What's unclear: Exact wording for each purpose type (rule-target, action-folder, review, sweep-target)
   - Recommendation: Define a `purposeDescription()` helper with sensible defaults; Claude has discretion here per CONTEXT.md

2. **Should folder_purpose be a strict union type or free-form string?**
   - What we know: D-08 lists examples: 'rule-target', 'action-folder', 'review', 'sweep-target'
   - What's unclear: Whether future phases might add new purposes
   - Recommendation: Use a TypeScript union type for known values but store as TEXT in SQLite for forward compatibility. The union type can be extended in later phases.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/log/migrations.ts`, `src/log/index.ts`, `src/tracking/signals.ts`, `src/config/repository.ts`, `src/action-folders/registry.ts` -- all patterns verified by reading source
- `package.json` -- dependency versions confirmed
- npm registry -- latest versions verified (better-sqlite3 12.9.0, vitest 4.1.5)
- `test/unit/log/migrations.test.ts` -- test patterns verified

### Secondary (MEDIUM confidence)
- RFC 2822 (Internet Message Format) -- email header structure
- RFC 3501 (IMAP) Section 5.1 -- INBOX case insensitivity

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in codebase
- Architecture: HIGH -- direct extension of existing SignalStore + migration patterns
- Pitfalls: HIGH -- RFC compliance items are well-documented; INBOX case sensitivity is from IMAP spec

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable domain, no fast-moving dependencies)
