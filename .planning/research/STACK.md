# Stack Research: v0.4 Extended Matchers and Behavioral Learning

**Domain:** Email organization system -- new match fields and behavioral learning
**Researched:** 2026-04-11
**Confidence:** HIGH

## Executive Summary

The existing stack handles everything v0.4 needs. imapflow 1.2.8 already supports fetching specific headers (returns raw Buffer), CONDSTORE for efficient change detection, and flag inspection. SQLite 3.51.2 (bundled with better-sqlite3 12.6.2) has window functions for statistical pattern detection. No new runtime dependencies are required. The work is about using existing library capabilities that are not yet wired up.

## What's Already There (No Changes Needed)

| Existing Tech | v0.4 Capability It Covers |
|---------------|---------------------------|
| imapflow 1.2.8 `fetch({ headers: [...] })` | Envelope recipient header extraction |
| imapflow 1.2.8 `fetch({ envelope: true })` | To/CC/BCC from envelope for visibility classification |
| imapflow 1.2.8 `fetch({ flags: true })` | Read status matching (`\Seen` flag) |
| imapflow 1.2.8 CONDSTORE support | Efficient flag change detection (auto-enabled on connect) |
| picomatch 4.0.3 | Glob matching for envelope recipient patterns |
| better-sqlite3 12.6.2 (SQLite 3.51.2) | Window functions, GROUP BY, COUNT for pattern detection |
| zod 4.3.6 | Schema validation for new match fields |
| pino 10.3.0 | Logging new subsystems |

## New Capabilities from Existing Stack

### 1. Envelope Recipient Header Extraction

**How it works in imapflow:** Pass specific header names to the `headers` option of `fetch()`:

```typescript
// Fetches ONLY these headers as a raw Buffer
for await (const msg of flow.fetch('1:*', {
  uid: true,
  headers: ['Delivered-To', 'X-Delivered-To', 'X-Original-To',
            'X-Original-Delivered-To', 'X-Resolved-To', 'List-Id']
}, { uid: true })) {
  // msg.headers is a Buffer containing the raw header lines
  const headerText = msg.headers.toString();
}
```

**Return format:** `msg.headers` comes back as a `Buffer` containing raw RFC 2822 header text. imapflow does NOT parse individual header values from `headers` -- only from `envelope`. You must parse the Buffer yourself.

**Headers to fetch by provider:**

| Provider | Envelope Recipient Header | Notes |
|----------|--------------------------|-------|
| Fastmail | `X-Delivered-To` | SMTP envelope recipient; always present |
| Fastmail | `X-Original-Delivered-To` | Pre-forwarding recipient; may be absent |
| Fastmail | `X-Resolved-To` | After alias resolution; always present |
| Gmail | `Delivered-To` | SMTP envelope recipient; always present |
| Generic/Postfix | `Delivered-To` or `X-Original-To` | Depends on MTA config |
| Fallback | `Received` header `for <addr>` clause | Last resort; unreliable, often absent |

**Header parsing approach:** Simple line-by-line string parsing. No library needed. The headers are key-value pairs separated by `: ` with possible continuation lines (lines starting with whitespace). A 20-line parser function handles this.

**Received header `for` clause:** Regex extraction `for\s+<([^>]+)>` from Received headers. Only use as fallback -- it's not always present and can reference intermediate MTAs, not the final recipient.

**Key detail:** imapflow can fetch both `envelope` and `headers` in the same IMAP FETCH call. No extra round-trip. The existing `fetchNewMessages()` just needs `headers: [...]` added to its query object.

**Confidence:** HIGH -- verified against imapflow 1.2.8 type definitions in `node_modules/imapflow/lib/imap-flow.d.ts` (line 369-370: `headers?: boolean | string[]` in FetchQueryObject; line 474: `headers?: Buffer` in FetchMessageObject).

### 2. Header Visibility Classification

**Source data:** Already available from `fetch({ envelope: true })` which returns `to`, `cc`, and `bcc` arrays. The existing `EmailMessage` type already has `to` and `cc` fields. BCC detection requires the envelope recipient from section 1.

**Classification logic (no library needed):**

| Visibility | Detection Logic |
|------------|----------------|
| `direct` | User's address appears in `To:` header |
| `cc` | User's address appears in `Cc:` header |
| `bcc` | User's address in envelope recipient but NOT in `To:` or `Cc:` |
| `list` | `List-Id` header is present (fetch via `headers: ['List-Id']`) |

**List-Id detection:** Fetch `List-Id` header alongside envelope recipient headers -- same `headers` fetch call, no extra IMAP round-trip. The `List-Id` value can be used for matching (e.g., `*.github.com` for GitHub notification lists).

**User address resolution:** Need the user's email address (and aliases) to check against To/CC. Already available from the IMAP auth config (`imap.auth.user`). May need a config field for additional aliases.

**Confidence:** HIGH -- this is pure application logic on data imapflow already provides.

### 3. Read Status Matching

**Already available:** `fetch({ flags: true })` returns `msg.flags` as `Set<string>`. The `\Seen` flag indicates a read message. The existing `EmailMessage` type already carries `flags: Set<string>`.

**Implementation:** Add `readStatus?: 'read' | 'unread'` to the match schema. In the matcher, check `message.flags.has('\\Seen')`.

**Confidence:** HIGH -- the flags field is already used throughout the codebase (sweep reads it for read/unread age thresholds).

### 4. Move Tracking (IMAP Folder State Diffing)

**CONDSTORE/QRESYNC in imapflow 1.2.8 -- verified from installed source:**

- **CONDSTORE auto-enabled:** On connect, imapflow sends `ENABLE CONDSTORE UTF8=ACCEPT` automatically (line 904 of `imap-flow.js`).
- **`changedSince` fetch option:** `fetch('1:*', { flags: true }, { changedSince: BigInt(lastModseq) })` returns only messages whose flags changed since the given MODSEQ.
- **`modseq` on fetch results:** Each fetched message includes `modseq?: bigint` when server supports CONDSTORE.
- **`highestModseq` on mailbox:** Available via `client.status(folder, { highestModseq: true })` or from the mailbox object after SELECT.
- **QRESYNC support:** Enabled via `{ qresync: true }` in ImapFlow constructor options. Makes EXPUNGE notifications include UID instead of sequence number.
- **`flags` event:** Emitted when flags change in the currently open mailbox; includes modseq.

**Critical insight: Do NOT use CONDSTORE for move tracking.** CONDSTORE tracks flag changes within a single mailbox, not message movement between mailboxes. A message moved from INBOX to a folder simply disappears from INBOX (EXPUNGE) and appears in the destination. CONDSTORE won't tell you where it went.

**Recommended approach -- periodic UID snapshot diffing:**

1. Periodically fetch UID list from monitored folders: `fetch('1:*', { uid: true })` -- lightweight, returns just UIDs
2. Compare against last known UID set stored in SQLite
3. UIDs that disappeared from INBOX = moved or deleted by user
4. Cross-reference disappeared message-ids against the activity log to exclude app-initiated moves
5. To find destination: optionally search other folders for the same message-id. Or just log the disappearance as a "user moved from INBOX" signal and let the next full scan of other folders pick up where it landed.
6. Store snapshots in SQLite with message-id for cross-referencing

**Polling frequency:** Every 5-10 minutes via `setInterval`, same pattern as sweep scheduling. Move tracking doesn't need real-time detection -- it's feeding statistical analysis that runs on accumulated data.

**Why NOT QRESYNC:** QRESYNC adds complexity for vanished UID tracking via EXPUNGE events. But move tracking uses polling-based snapshot diffing, not event-driven tracking. QRESYNC would require maintaining a persistent connection and handling events across multiple folders simultaneously, which imapflow can't do (single selected mailbox at a time).

**Fastmail CONDSTORE support:** Confirmed -- imapflow auto-enables it, and Fastmail is a modern IMAP server.

**Confidence:** HIGH for the approach. CONDSTORE support verified in imapflow source. The "don't use CONDSTORE for move detection" insight is critical.

### 5. Pattern Detection (Statistical Analysis)

**No external library needed.** SQLite 3.51.2 (bundled with better-sqlite3 12.6.2) supports everything required:

- `GROUP BY` with `COUNT()`, `AVG()` -- basic frequency analysis
- Window functions (`OVER`, `PARTITION BY`, `ROWS BETWEEN`) -- trend detection
- `datetime()` functions -- time-windowed aggregation
- CTEs (`WITH` clauses) -- complex multi-step queries

**Example pattern detection queries:**

```sql
-- Find senders frequently moved to the same folder by the user
SELECT
  message_from,
  destination_folder,
  COUNT(*) as move_count,
  MIN(timestamp) as first_seen,
  MAX(timestamp) as last_seen
FROM user_moves
WHERE timestamp > datetime('now', '-30 days')
GROUP BY message_from, destination_folder
HAVING COUNT(*) >= 3
ORDER BY move_count DESC;

-- Detect subject pattern clusters (same sender, same dest, varied subjects)
SELECT
  message_from,
  destination_folder,
  COUNT(*) as total,
  COUNT(DISTINCT message_subject) as unique_subjects
FROM user_moves
WHERE timestamp > datetime('now', '-30 days')
GROUP BY message_from, destination_folder
HAVING COUNT(*) >= 3;
```

**Why no stats library:** The pattern detection here is frequency counting and threshold comparison, not regression analysis or ML. "This sender was moved to Folder X at least N times in the last 30 days" is a `GROUP BY` with `HAVING`. Simple, debuggable, no dependencies.

**Confidence:** HIGH -- SQLite window functions verified locally (`SELECT sqlite_version()` returns 3.51.2, window functions available since 3.25.0).

## Recommended Stack Additions

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| None | -- | -- | No new runtime dependencies needed |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None needed | -- | -- | -- |

## Installation

```bash
# No new packages to install.
# All v0.4 features build on the existing stack.
```

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `mailparser` / `nodemailer/mailparser` | Massive overkill for parsing 3-4 header lines from a Buffer. Pulls in `libmime`, `encoding`, `iconv-lite`. ~500KB of dependencies for a 20-line string parser. | Hand-rolled header parser: split on `\r\n`, handle continuation lines, extract key-value pairs |
| `address-rfc2822` / `email-addresses` | Only needed for parsing complex address groups or comments. Envelope recipient headers are simple `user@domain` values. | Simple regex or `string.trim()` on extracted header values |
| `simple-statistics` / `stats-lite` / any JS stats library | Pattern detection is frequency counting, not statistical modeling. GROUP BY + HAVING in SQL is the right tool. | SQLite aggregate queries with window functions |
| `node-cron` / `cron` | Move tracking polling is a simple `setInterval`, same pattern already used for sweep scheduling. | `setInterval` / `setTimeout` as used throughout existing codebase |
| QRESYNC enablement | Adds complexity for vanished UID tracking that doesn't help with polling-based move detection. | Periodic UID list fetch + diff against stored snapshot |
| Dedicated message queue (Bull, BullMQ) | Single-user system with one process. Pattern detection runs as a periodic SQLite query. | `setInterval` + direct SQLite queries |

## Integration Points with Existing Code

### Extending `EmailMessage` Type

```typescript
// src/imap/messages.ts -- extend existing type
export interface EmailMessage {
  // ... existing fields ...
  envelopeRecipient?: string;   // From Delivered-To / X-Delivered-To
  listId?: string;              // From List-Id header
  visibility?: 'direct' | 'cc' | 'bcc' | 'list';
}
```

### Extending Fetch Calls

The existing `fetchNewMessages()` and `fetchAllMessages()` methods need to add `headers: ['Delivered-To', 'X-Delivered-To', 'X-Original-To', 'List-Id']` to their fetch queries. The `headers` Buffer then gets parsed and merged into the `EmailMessage` object during `parseMessage()`.

**Key constraint:** imapflow's `fetch()` can request both `envelope` and `headers` in the same call. No extra IMAP round-trip.

### Extending Match Schema

```typescript
// src/config/schema.ts -- extend emailMatchSchema
export const emailMatchSchema = z.object({
  sender: z.string().optional(),
  recipient: z.string().optional(),
  envelopeRecipient: z.string().optional(),  // NEW: glob for Delivered-To
  subject: z.string().optional(),
  visibility: z.enum(['direct', 'cc', 'bcc', 'list']).optional(),  // NEW
  readStatus: z.enum(['read', 'unread']).optional(),  // NEW
}).refine(/* at least one field */);
```

### New SQLite Tables

```sql
-- Move tracking: snapshot of UIDs per folder
CREATE TABLE folder_snapshots (
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  message_id TEXT,
  message_from TEXT,
  message_subject TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (folder, uid)
);

-- User-initiated moves detected by diffing snapshots
CREATE TABLE user_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  message_id TEXT,
  message_from TEXT,
  message_subject TEXT,
  source_folder TEXT NOT NULL,
  destination_folder TEXT  -- NULL if unknown (deleted or moved to unmonitored folder)
);

-- Proposed rules from pattern detection
CREATE TABLE proposed_rules (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  match_json TEXT NOT NULL,   -- JSON blob of match criteria
  action_json TEXT NOT NULL,  -- JSON blob of proposed action
  evidence_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/dismissed
  resolved_at TEXT
);
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Raw header parsing (20 lines) | `mailparser` npm package | If you later need full MIME parsing, body text extraction, or attachment handling -- none of which v0.4 requires |
| UID snapshot diffing for move tracking | IMAP NOTIFY extension (RFC 5465) | If Fastmail ever supports NOTIFY, which allows push notifications for mailbox changes across folders. Not widely supported today. |
| SQLite aggregate queries for patterns | Dedicated ML/stats library | If pattern detection evolves beyond frequency counting into classification (Tier 4 LLM classification would be where this matters) |
| Polling-based folder scan | IMAP IDLE on multiple folders | imapflow can only IDLE on one folder at a time. Periodic polling is simpler and sufficient for move tracking that feeds batch statistical analysis. |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| imapflow 1.2.8 | Fastmail IMAP (CONDSTORE enabled) | Auto-enables CONDSTORE on connect; `changedSince` and `modseq` work out of the box |
| better-sqlite3 12.6.2 | SQLite 3.51.2 | Window functions available since SQLite 3.25.0; well above minimum |
| picomatch 4.0.3 | New glob patterns for envelope recipient | Same engine already used for sender/recipient/subject matching |
| zod 4.3.6 | Extended match schema with new optional fields | Discriminated unions and optional fields handle new match types cleanly |

## Sources

- imapflow 1.2.8 installed source (`node_modules/imapflow/lib/imap-flow.d.ts` lines 369-370, 451-452, 474, 528-529; `imap-flow.js` line 904) -- verified CONDSTORE auto-enable, `changedSince` option, `headers` fetch option, return types. HIGH confidence.
- [ImapFlow Fetching Messages Guide](https://imapflow.com/docs/guides/fetching-messages/) -- `headers` option documentation. HIGH confidence.
- [ImapFlow Client API](https://imapflow.com/docs/api/imapflow-client/) -- status command, mailbox properties, CONDSTORE/QRESYNC. HIGH confidence.
- [Fastmail Email Addressing](https://www.fastmail.com/help/receive/emailnottome.html) -- `X-Delivered-To`, `X-Original-Delivered-To`, `X-Resolved-To` header names specific to Fastmail. HIGH confidence.
- [RFC 7162 CONDSTORE/QRESYNC](https://datatracker.ietf.org/doc/html/rfc7162) -- protocol specification for conditional store and quick resync. HIGH confidence.
- SQLite 3.51.2 version verified locally via `node -e "..."` -- window function support confirmed. HIGH confidence.
- [SQLite Window Functions](https://www.sqlitetutorial.net/sqlite-window-functions/sqlite-window-frame/) -- syntax reference for pattern detection queries. HIGH confidence.

---
*Stack research for: Mail Manager v0.4 Extended Matchers and Behavioral Learning*
*Researched: 2026-04-11*
