# Architecture Patterns

**Domain:** Extended matchers and behavioral learning for email organization system
**Researched:** 2026-04-11

## Recommended Architecture

The v0.4 milestone adds two conceptually distinct layers to the existing system:

1. **Extended Matchers** -- New match fields (envelope recipient, header visibility, read status) that plug into the existing `matchRule()` pipeline. These require fetching additional IMAP data and extending the `EmailMessage` type, `EmailMatch` schema, and matcher logic.

2. **Behavioral Learning** -- A completely new subsystem (move tracking, pattern detection, proposed rules) that observes user behavior and generates rule candidates. This sits alongside the rule engine, not inside it.

### Component Map

```
EXISTING (modified)                    NEW
========================              ========================
src/imap/messages.ts  [MODIFY]        src/tracking/scanner.ts     [NEW]
src/imap/client.ts    [MODIFY]        src/tracking/index.ts       [NEW]
src/config/schema.ts  [MODIFY]        src/learning/detector.ts    [NEW]
src/rules/matcher.ts  [MODIFY]        src/learning/index.ts       [NEW]
src/monitor/index.ts  [MODIFY]        src/web/routes/proposals.ts [NEW]
src/sweep/index.ts    [MINOR]
src/batch/index.ts    [MINOR]
src/log/index.ts      [MODIFY]
src/shared/types.ts   [MODIFY]
src/web/routes/rules.ts [MODIFY]
src/web/frontend/app.ts [MODIFY]
src/index.ts          [MODIFY]
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/imap/messages.ts` | Parse extended headers into EmailMessage fields | ImapClient (receives raw fetch data) |
| `src/imap/client.ts` | Fetch additional header fields from IMAP | Monitor, Sweep, Batch (provides parsed messages) |
| `src/config/schema.ts` | Zod schemas for new match fields + tracking config | Config loader, web routes |
| `src/rules/matcher.ts` | Match against envelope recipient, visibility, read status | Evaluator (called by Monitor/Sweep/Batch) |
| `src/log/index.ts` | New tables for move signals + proposed rules | Tracker, Detector, web routes |
| `src/tracking/scanner.ts` | Periodic folder scan to detect user-initiated moves | ImapClient, ActivityLog |
| `src/learning/detector.ts` | Statistical pattern analysis on move signals | ActivityLog (reads signals), proposed rules table |
| `src/web/routes/proposals.ts` | CRUD for proposed rules (approve/modify/dismiss) | ActivityLog, ConfigRepository |

### Data Flow

**Extended Matchers (arrival path):**
```
IMAP server
  --> ImapClient.fetchNewMessages() [now fetches headers: Delivered-To, X-Original-To, List-Id]
  --> parseMessage() [extracts envelopeRecipient, visibility from headers]
  --> Monitor.processMessage()
  --> evaluateRules() --> matchRule() [checks new fields]
  --> executeAction() [unchanged]
  --> activityLog.logActivity() [unchanged]
```

**Move Tracking (background):**
```
MoveTracker (periodic timer, e.g. every 5 minutes)
  --> ImapClient.fetchAllMessages('INBOX') [get current UIDs + message-ids]
  --> ImapClient.fetchAllMessages('Review') [get current UIDs + message-ids]
  --> Compare against previous snapshot (stored in SQLite state table)
  --> Messages that disappeared = moved by user (not by us -- cross-reference activity log)
  --> For moved messages: scan likely folders to find new location
  --> Log move signals to SQLite move_signals table
```

**Pattern Detection (scheduled):**
```
PatternDetector (runs after MoveTracker, or on separate schedule)
  --> Query move_signals table: group by (sender domain, destination folder)
  --> Apply threshold: e.g. >= 3 moves from same sender to same folder
  --> Check against existing rules (avoid duplicating what already exists)
  --> Insert into proposed_rules table
  --> Web UI polls /api/proposals for pending proposals
```

## Integration Details: Extended Matchers

### 1. EmailMessage Type Extension

**File:** `src/imap/messages.ts`

The `EmailMessage` interface gains three new fields:

```typescript
export type Visibility = 'direct' | 'cc' | 'bcc' | 'list';

export interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
  // NEW FIELDS
  envelopeRecipient: string | null;  // Delivered-To or X-Original-To value
  visibility: Visibility;             // Derived from To/CC/List-Id
}
```

**Why nullable envelopeRecipient:** Not all messages have Delivered-To or X-Original-To headers. Fastmail typically provides Delivered-To, but it is not guaranteed. The field is null when absent, and rules with `envelopeRecipient` match only skip when null (fail-open -- message stays in inbox).

**Visibility derivation logic:**
1. If `List-Id` header present --> `'list'`
2. If user's address appears in `To` --> `'direct'`
3. If user's address appears in `CC` --> `'cc'`
4. Otherwise --> `'bcc'`

The user's address is known from the IMAP auth config (`config.imap.auth.user`). This means the user email needs to be passed into `parseMessage()` or the visibility classifier.

### 2. IMAP Fetch Changes

**File:** `src/imap/client.ts`

The `fetchNewMessages()` method currently fetches `{ uid: true, envelope: true, flags: true }`. It needs to also request specific headers:

```typescript
// Current
flow.fetch(range, { uid: true, envelope: true, flags: true }, { uid: true })

// Updated
flow.fetch(range, {
  uid: true,
  envelope: true,
  flags: true,
  headers: ['Delivered-To', 'X-Original-To', 'List-Id'],
}, { uid: true })
```

imapflow returns headers as a `Buffer` containing the raw header block. The `parseMessage()` function needs to parse this buffer to extract individual header values.

**Confidence:** HIGH -- verified imapflow source code in `node_modules/imapflow/lib/commands/fetch.js` confirms `headers` accepts an array of header names and uses `BODY.PEEK[HEADER.FIELDS (...)]`.

The `ImapFetchResult` interface needs updating:

```typescript
export interface ImapFetchResult {
  uid: number;
  flags?: Set<string>;
  envelope?: ImapEnvelopeObject;
  headers?: Buffer;  // NEW: raw header block from BODY.PEEK
}
```

The same change applies to `fetchAllMessages()` (used by Sweep and Batch) and `parseRawToReviewMessage()`. The `ReviewMessage` type also needs the new fields so sweep/batch can evaluate extended matchers.

### 3. EmailMatch Schema Extension

**File:** `src/config/schema.ts`

```typescript
export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    // NEW FIELDS
    envelopeRecipient: z.string().optional(),  // glob pattern
    visibility: z.enum(['direct', 'cc', 'bcc', 'list']).array().optional(),  // multi-select
    readStatus: z.enum(['read', 'unread']).optional(),
  })
  .refine(
    (m) => m.sender !== undefined || m.recipient !== undefined ||
           m.subject !== undefined || m.envelopeRecipient !== undefined ||
           m.visibility !== undefined || m.readStatus !== undefined,
    { message: 'At least one match field is required' },
  );
```

**Design choice -- visibility as array:** A rule that matches `['cc', 'bcc']` means "match if the user received this via CC or BCC." This maps to a multi-select UI element. The array uses OR logic within the field, while the field itself still uses AND logic with other match fields (consistent with existing sender+recipient+subject behavior).

### 4. Matcher Extension

**File:** `src/rules/matcher.ts`

Three new match blocks added to `matchRule()`, following the existing pattern:

```typescript
if (match.envelopeRecipient !== undefined) {
  if (!message.envelopeRecipient) return false;  // no header = no match
  if (!picomatch.isMatch(message.envelopeRecipient, match.envelopeRecipient, { nocase: true })) {
    return false;
  }
}

if (match.visibility !== undefined) {
  if (!match.visibility.includes(message.visibility)) {
    return false;
  }
}

if (match.readStatus !== undefined) {
  const isRead = message.flags.has('\\Seen');
  const wantsRead = match.readStatus === 'read';
  if (isRead !== wantsRead) {
    return false;
  }
}
```

**Read status note:** The `\\Seen` flag is already in `message.flags` -- no additional IMAP fetch needed. This is purely a matcher-side feature.

### 5. ReviewMessage + Sweep/Batch Impact

`ReviewMessage` needs `envelopeRecipient` and `visibility` added. The `reviewMessageToEmailMessage()` converter passes them through. The sweep and batch engines already call `evaluateRules()` with the converted `EmailMessage`, so they automatically get extended matching -- no logic changes needed in those files, only the type expansion.

## Integration Details: Behavioral Learning

### 6. SQLite Schema Changes

**File:** `src/log/index.ts` -- new tables added via migration

```sql
-- Move signals: records of user-initiated moves detected by the tracker
CREATE TABLE IF NOT EXISTS move_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  message_id TEXT,
  message_from TEXT,
  message_subject TEXT,
  from_folder TEXT NOT NULL,
  to_folder TEXT NOT NULL,
  envelope_recipient TEXT,
  visibility TEXT
);

CREATE INDEX IF NOT EXISTS idx_move_signals_from
  ON move_signals(message_from);
CREATE INDEX IF NOT EXISTS idx_move_signals_to_folder
  ON move_signals(to_folder);
CREATE INDEX IF NOT EXISTS idx_move_signals_detected
  ON move_signals(detected_at);

-- Proposed rules: candidates generated by pattern detection
CREATE TABLE IF NOT EXISTS proposed_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, dismissed
  match_sender TEXT,
  match_recipient TEXT,
  match_subject TEXT,
  match_envelope_recipient TEXT,
  match_visibility TEXT,  -- JSON array
  action_type TEXT NOT NULL,
  action_folder TEXT,
  evidence_count INTEGER NOT NULL,
  evidence_sample TEXT,  -- JSON array of recent message_ids
  resolved_at TEXT,
  resolved_as_rule_id TEXT  -- links to rules table if approved
);

CREATE INDEX IF NOT EXISTS idx_proposed_status
  ON proposed_rules(status);
```

**Pruning:** Move signals should auto-prune after 90 days (longer than activity's 30 days because pattern detection needs a longer window). Proposed rules with status `dismissed` prune after 30 days; `approved` records kept indefinitely for audit.

### 7. Move Tracker (New Component)

**File:** `src/tracking/scanner.ts`

**Approach -- UID snapshot diffing:**

The tracker maintains a snapshot of message UIDs currently in monitored folders (INBOX and Review). On each scan cycle:

1. Fetch current UIDs from INBOX and Review via `fetchAllMessages()`
2. Compare against previous snapshot
3. UIDs that disappeared could mean: (a) moved by our rules, (b) moved by user, (c) deleted by user
4. Cross-reference against activity log -- if we logged a move/delete for that UID recently, it was us. If not, the user did it.
5. For user-initiated moves: scan other folders to find where the message went (by message-id search across folders)

**Critical design decision -- finding destination folder:**

The hardest part of move tracking is determining WHERE the user moved the message. Options:

**Option A: Full folder scan (recommended for now)**
After detecting a missing UID, search for the message-id across all folders. imapflow supports `SEARCH` by header, but searching all folders is expensive. Mitigate by:
- Only scanning "likely" folders (recently used folders from activity log, plus a configurable scan list)
- Caching folder contents briefly during a scan cycle
- Limiting to one scan pass -- if not found, log as "destination unknown"

**Option B: IMAP NOTIFY extension**
Fastmail may support NOTIFY for real-time move tracking. However, imapflow does not implement NOTIFY, and this would require significant protocol-level work. Not recommended.

**Option C: Mailbox metadata (UIDVALIDITY + APPENDUID)**
IMAP MOVE responses include COPYUID, but only the server sees this. The client (Mac Mail) performs the move, not our app. Not applicable.

**Recommendation:** Option A with smart folder scanning. Start with a simple approach -- scan the top 20 most-used folders (from activity log `getRecentFolders()` expanded to ~20). If performance is acceptable, keep it. If not, add a configurable scan list or limit scanning to folders changed since last check (via IMAP STATUS).

**Tracker lifecycle:**

```typescript
export interface TrackerDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  scanIntervalMs: number;  // default: 300_000 (5 minutes)
  monitoredFolders: string[];  // ['INBOX', 'Review']
  userEmail: string;  // for visibility classification
}

export class MoveTracker {
  private previousSnapshots: Map<string, Map<number, string>>;  // folder -> (UID -> messageId)
  // ...
  start(): void;   // begin periodic scanning
  stop(): void;    // stop scanning
  scan(): Promise<void>;  // manual trigger
}
```

**Integration point:** Instantiated in `src/index.ts` alongside Monitor and ReviewSweeper. Receives the same ImapClient. Started after Monitor connects. Uses `withMailboxSwitch()` which temporarily pauses IDLE, scans, then reopens INBOX.

**Snapshot persistence:** Store latest snapshot in SQLite `state` table (key: `tracker_snapshot_inbox`, value: JSON of `{uid: messageId}` map). On startup, load previous snapshot so the first scan after restart can detect moves that happened while the app was down.

### 8. Pattern Detector (New Component)

**File:** `src/learning/detector.ts`

```typescript
export interface DetectorConfig {
  minMoveCount: number;        // default: 3 -- minimum moves to suggest a rule
  windowDays: number;          // default: 30 -- look at moves in last N days
  runAfterScan: boolean;       // default: true -- run detection after each tracker scan
}

export class PatternDetector {
  constructor(activityLog: ActivityLog, config: DetectorConfig);

  /** Analyze move signals, generate/update proposed rules */
  async detect(): Promise<number>;  // returns count of new proposals
}
```

**Detection algorithm:**
1. Query `move_signals` for last `windowDays` days
2. Group by `(sender_domain, to_folder)` -- domain extracted from `message_from`
3. For each group with count >= `minMoveCount`:
   - Check if an existing rule already covers this sender+folder combination
   - Check if a pending proposed rule already exists for this pattern
   - If neither: insert new proposed rule with `match_sender: '*@domain.com'`, `action_type: 'move'`, `action_folder: to_folder`
4. Optionally: detect patterns by envelope recipient (e.g., `user+tag@domain` always moved to same folder)

**Integration:** PatternDetector is triggered by MoveTracker after each successful scan. It could also run on a separate schedule, but running it post-scan is simpler and ensures fresh data.

### 9. Proposed Rules API (New Route)

**File:** `src/web/routes/proposals.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/proposals` | List proposed rules (filter by status) |
| POST | `/api/proposals/:id/approve` | Approve proposal -- creates a real rule |
| POST | `/api/proposals/:id/dismiss` | Dismiss proposal |
| PUT | `/api/proposals/:id` | Modify proposal before approving |

**Approve flow:**
1. Read proposed rule from `proposed_rules` table
2. Generate a new rule with `id: uuid()`, `match` from proposal fields, `action` from proposal
3. Add rule to config via `ConfigRepository` (triggers hot-reload)
4. Update proposal status to `approved`, set `resolved_as_rule_id`

This reuses the existing config hot-reload mechanism -- when a rule is added via the API, `configRepo.onRulesChange()` fires, and Monitor/Sweeper/Batch all pick up the new rule automatically.

## Patterns to Follow

### Pattern 1: Extend, Don't Fork
**What:** New match fields plug into the existing `matchRule()` function. Do not create a separate matcher for extended fields.
**When:** Adding any new match criterion.
**Why:** The evaluator, monitor, sweep, and batch all call `evaluateRules()` --> `matchRule()`. A single extension point means all consumers automatically get the new matching capability.

### Pattern 2: Migration via Idempotent ALTER TABLE
**What:** Schema changes added as try/catch `ALTER TABLE` statements in `migrate()`.
**When:** Adding columns or tables to SQLite.
**Why:** Matches the existing pattern in `src/log/index.ts` where the `source` column was added. No migration framework needed for a single-user app.

### Pattern 3: Dependency Injection via Constructor
**What:** New components (MoveTracker, PatternDetector) receive their dependencies via constructor, not globals.
**When:** Creating any new service class.
**Why:** Matches Monitor, ReviewSweeper, BatchEngine patterns. Enables testing with mocks.

### Pattern 4: Getter Functions for Hot-Swappable Instances
**What:** Web server receives `getTracker: () => tracker` and `getDetector: () => detector` rather than direct references.
**When:** Wiring new components into the web server.
**Why:** Matches existing pattern in `src/index.ts` where `getMonitor()`, `getSweeper()`, `getBatchEngine()` handle config-reload instance replacement.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Fetching Full Message Bodies
**What:** Fetching BODY[] to parse headers from full message content.
**Why bad:** Massive bandwidth for 20 years of email. A single batch scan of a folder with thousands of messages would download gigabytes.
**Instead:** Use `headers: ['Delivered-To', 'X-Original-To', 'List-Id']` in the fetch query. imapflow sends `BODY.PEEK[HEADER.FIELDS (...)]` which returns only the requested headers.

### Anti-Pattern 2: Real-Time Move Detection via Polling All Folders
**What:** Scanning every folder every 5 minutes to detect moves.
**Why bad:** With hundreds of folders and thousands of messages, this would hammer the IMAP server and take minutes per cycle.
**Instead:** Only snapshot the monitored folders (INBOX, Review). When a message disappears, do a targeted search of likely destination folders.

### Anti-Pattern 3: Storing Move Snapshots in Memory Only
**What:** Keeping the UID snapshot only in the MoveTracker instance.
**Why bad:** On restart, all messages currently in INBOX appear "new" and there is no baseline to diff against. The first scan after restart would miss all moves or generate false signals.
**Instead:** Persist the latest snapshot to the SQLite `state` table (key: `tracker_snapshot_inbox`, value: JSON of UID-to-messageId map). On startup, load the previous snapshot and diff normally.

### Anti-Pattern 4: Pattern Detection in the Request Path
**What:** Running pattern detection when the user loads the proposals page.
**Why bad:** Detection queries aggregate over thousands of move signals. This is a background task, not a request handler.
**Instead:** Run detection on a schedule (after each tracker scan) and cache results in `proposed_rules` table. The API just reads from the table.

## Existing Components: Modification Summary

### Modified Components

| File | Change | Scope |
|------|--------|-------|
| `src/imap/messages.ts` | Add `envelopeRecipient`, `visibility` to `EmailMessage` and `ReviewMessage`. Add header parsing logic. Update `parseMessage()` and `reviewMessageToEmailMessage()`. | MEDIUM -- new fields + header parsing function |
| `src/imap/client.ts` | Add `headers` to fetch queries in `fetchNewMessages()` and `fetchAllMessages()`. Update `parseRawToReviewMessage()`. Pass user email for visibility classification. | MEDIUM -- fetch query changes + plumbing user email |
| `src/config/schema.ts` | Add `envelopeRecipient`, `visibility`, `readStatus` to `emailMatchSchema`. Add tracking config schema (scan interval, thresholds). | SMALL -- schema additions |
| `src/rules/matcher.ts` | Add three new match blocks for new fields. | SMALL -- three if-blocks |
| `src/monitor/index.ts` | Pass user email into message parsing context (for visibility classification). | SMALL -- plumbing |
| `src/log/index.ts` | Add `move_signals` and `proposed_rules` tables to migrations. Add methods: `logMoveSignal()`, `getMoveSignals()`, `getProposedRules()`, `updateProposal()`, `createProposal()`. | MEDIUM -- new tables + query methods |
| `src/shared/types.ts` | Add `Visibility` type, proposal API types, tracking status types. | SMALL -- type definitions |
| `src/index.ts` | Instantiate MoveTracker and PatternDetector. Wire into web server deps. Start/stop alongside Monitor. Handle config-reload reconstruction. | MEDIUM -- lifecycle wiring |
| `src/web/routes/rules.ts` | Handle new match fields in rule CRUD (they flow through Zod validation automatically). | MINIMAL -- schema handles it |
| `src/web/frontend/app.ts` | Add envelope recipient input, visibility multi-select, read status toggle to rule editor. Add proposals panel. | MEDIUM-LARGE -- UI work |

### Unchanged Components

| File | Why Unchanged |
|------|---------------|
| `src/rules/evaluator.ts` | Calls `matchRule()` which handles all field matching. No evaluator logic changes. |
| `src/actions/index.ts` | Actions (move/review/skip/delete) are unaffected by match field changes. |
| `src/sweep/index.ts` | Uses `evaluateRules()` + `reviewMessageToEmailMessage()`. Gets new matching automatically. Only needs type updates for ReviewMessage. |
| `src/batch/index.ts` | Same as sweep -- automatic via evaluateRules pipeline. Only type updates. |
| `src/config/loader.ts` | Loads YAML, validates against schema. Schema changes propagate automatically. |
| `src/config/repository.ts` | Manages config lifecycle. No changes needed for new match fields. |

## Tests Impacted

### Existing Tests Requiring Updates

| Test File | What Changes |
|-----------|-------------|
| `test/unit/imap/messages.test.ts` | `parseMessage()` now returns additional fields. All test helpers creating `EmailMessage` objects need `envelopeRecipient` and `visibility` fields. |
| `test/unit/imap/client.test.ts` | Mock fetch responses need `headers` buffer. `fetchNewMessages()` and `fetchAllMessages()` query changes. |
| `test/unit/rules/matcher.test.ts` | Test `EmailMessage` fixtures need new fields. Add tests for each new match type. |
| `test/unit/config/config.test.ts` | Schema validation tests for new `emailMatchSchema` fields. |
| `test/unit/sweep/sweep.test.ts` | `ReviewMessage` fixtures need new fields. |
| `test/unit/batch/engine.test.ts` | `ReviewMessage` fixtures need new fields. |
| `test/unit/monitor/monitor.test.ts` | Mock messages need new fields. |
| `test/integration/pipeline.test.ts` | End-to-end message fixtures need new fields. |
| `test/integration/sweep.test.ts` | Message fixtures need new fields. |
| `test/unit/web/api.test.ts` | New route tests for `/api/proposals`. |
| `test/unit/web/frontend.test.ts` | UI tests for new form fields and proposals panel. |

### New Test Files

| Test File | What It Tests |
|-----------|--------------|
| `test/unit/imap/header-parsing.test.ts` | Delivered-To extraction, X-Original-To fallback, List-Id detection, visibility classification |
| `test/unit/tracking/scanner.test.ts` | UID snapshot diffing, activity log cross-reference, destination folder scanning |
| `test/unit/learning/detector.test.ts` | Pattern grouping, threshold filtering, duplicate proposal prevention, existing rule deduplication |
| `test/unit/web/proposals.test.ts` | Proposals API routes: list, approve, dismiss, modify |

## Suggested Build Order

The dependency chain dictates a strict ordering for some features, while others can be parallelized.

### Phase 1: Extended Message Data (Foundation)

**Must come first** -- everything else depends on these fields existing.

1. Extend `EmailMessage` + `ReviewMessage` types with `envelopeRecipient: string | null` and `visibility: Visibility`
2. Update IMAP fetch queries in `ImapClient` to request `headers: ['Delivered-To', 'X-Original-To', 'List-Id']`
3. Implement header parsing in `parseMessage()` -- extract envelope recipient from Delivered-To/X-Original-To, classify visibility from headers
4. Update `ImapFetchResult` to include `headers?: Buffer`
5. Update `reviewMessageToEmailMessage()` to pass through new fields
6. Thread user email from IMAP config into parsing context (needed for visibility classification)

**Tests to update:** `test/unit/imap/messages.test.ts`, `test/unit/imap/client.test.ts`
**New tests:** Header parsing for Delivered-To extraction, visibility classification logic

### Phase 2: Extended Matchers (Depends on Phase 1)

1. Extend `emailMatchSchema` with `envelopeRecipient`, `visibility`, `readStatus`
2. Add match blocks to `matchRule()` for each new field
3. Update existing matcher tests, add new test cases

**Tests to update:** `test/unit/rules/matcher.test.ts`, `test/unit/config/config.test.ts`
**Integration tests to update:** `test/integration/pipeline.test.ts`

### Phase 3: UI for Extended Matchers (Depends on Phase 2)

1. Update rule editor in frontend with envelope recipient glob input, visibility multi-select, read status toggle
2. Update rule display to show new fields
3. Verify rules API handles new fields (should work via Zod validation automatically)

**Tests to update:** `test/unit/web/frontend.test.ts`, `test/unit/web/api.test.ts`

### Phase 4: Move Tracking (Independent of Phases 2-3, depends on Phase 1)

Can start as soon as Phase 1 is complete -- does not need extended matchers.

1. Add `move_signals` table to SQLite migrations in `src/log/index.ts`
2. Add `logMoveSignal()` and query methods to `ActivityLog`
3. Build `MoveTracker` class in `src/tracking/scanner.ts` -- UID snapshot diffing, cross-reference with activity log, destination folder scanning
4. Persist snapshots to SQLite state table
5. Wire into `src/index.ts` -- instantiate, start/stop lifecycle, config-reload handling
6. Add tracking config to schema (scan interval, monitored folders)

**New tests:** `test/unit/tracking/scanner.test.ts`

### Phase 5: Pattern Detection (Depends on Phase 4)

1. Add `proposed_rules` table to SQLite migrations
2. Add proposal query/mutation methods to `ActivityLog`
3. Build `PatternDetector` class in `src/learning/detector.ts`
4. Wire into tracker -- run detection after each successful scan

**New tests:** `test/unit/learning/detector.test.ts`

### Phase 6: Proposed Rules UI + API (Depends on Phase 5)

1. Add `/api/proposals` routes in `src/web/routes/proposals.ts`
2. Add proposals panel to frontend -- list pending proposals, approve/modify/dismiss
3. Approve flow -- create rule in config, update proposal status
4. Wire route into web server via `buildServer()` deps

**New tests:** `test/unit/web/proposals.test.ts`

### Dependency Graph

```
Phase 1 (Extended Message Data)
  |
  +---> Phase 2 (Extended Matchers) ---> Phase 3 (Matcher UI)
  |
  +---> Phase 4 (Move Tracking) ---> Phase 5 (Pattern Detection) ---> Phase 6 (Proposals UI)
```

Phases 2 and 4 can run in parallel after Phase 1. Phases 3 and 5 can also overlap.

## Scalability Considerations

| Concern | Current Scale | At Scale (20yr mailbox) |
|---------|--------------|------------------------|
| Header fetch overhead | Negligible for new messages | Batch filing thousands of messages adds ~200 bytes/msg for 3 headers. Acceptable. |
| Move tracker folder scan | INBOX typically < 100 msgs | If scanning 20 folders for destination, ~20 IMAP STATUS commands per cycle. Under 5 seconds. |
| Pattern detection query | Trivial with < 100 signals | With 10K+ move signals over 30 days, GROUP BY query on indexed columns is still sub-second in SQLite. |
| Proposed rules accumulation | N/A | Auto-dismiss stale proposals after 90 days to prevent unbounded growth. |

## Sources

- imapflow source code: `node_modules/imapflow/lib/commands/fetch.js` -- verified `headers` array support for `BODY.PEEK[HEADER.FIELDS (...)]` (HIGH confidence)
- [ImapFlow Fetching Messages documentation](https://imapflow.com/docs/guides/fetching-messages/) (HIGH confidence)
- Existing codebase analysis: `src/imap/client.ts`, `src/rules/matcher.ts`, `src/log/index.ts`, `src/monitor/index.ts`, `src/sweep/index.ts`, `src/batch/index.ts` (HIGH confidence)
- IMAP RFC 3501 for `\Seen` flag semantics and SEARCH capabilities (HIGH confidence, well-established standard)
