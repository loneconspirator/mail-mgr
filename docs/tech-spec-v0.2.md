# v0.2 Technical Specification: Two-Stream Intake

This spec describes every code change required to implement the v0.2 PRD (two-stream intake with review folder, lifecycle sweeps, and new routing dispositions). It is written at design level — specific files, methods, types, and behaviors — sufficient to produce a work breakdown structure.

Companion doc: `docs/requirements-v0.2.md` (the product requirements).

---

## 1. Config Schema Changes

**File: `src/config/schema.ts`**

### 1.1 New action schemas

Add three Zod object schemas to the `actionSchema` discriminated union:

- **`reviewActionSchema`** — `{ type: "review", folder?: string }`. The optional `folder` is the sweep archive destination (where the message goes when it ages out of Review), not the immediate destination. Validate `folder` with `.min(1)` when present (reject empty strings).
- **`skipActionSchema`** — `{ type: "skip" }`. No additional fields.
- **`deleteActionSchema`** — `{ type: "delete" }`. No additional fields.

Update `actionSchema`:

```
actionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  reviewActionSchema,
  skipActionSchema,
  deleteActionSchema,
]);
```

Export new inferred types: `ReviewAction`, `SkipAction`, `DeleteAction`. The `Action` union type updates automatically from Zod inference.

### 1.2 New review config schema

Add a new `reviewConfigSchema` with nested `sweepConfigSchema`:

```
sweepConfigSchema:
  intervalHours: number       (positive int, default 6)
  readMaxAgeDays: number      (positive int, default 7)
  unreadMaxAgeDays: number    (positive int, default 14)

reviewConfigSchema:
  folder: string              (min 1, default "Review")
  defaultArchiveFolder: string (min 1, default "MailingLists")
  trashFolder: string         (min 1, default "Trash")
  sweep: sweepConfigSchema
```

All fields optional with defaults. The entire `review` key is optional on `configSchema`. Add `.default({})` on the review object within `configSchema` so `config.review` always exists after parsing.

Update `configSchema`:

```
configSchema = z.object({
  imap: imapConfigSchema,
  server: serverConfigSchema,
  rules: z.array(ruleSchema).default([]),
  review: reviewConfigSchema.default({}),
});
```

Export `ReviewConfig` and `SweepConfig` types.

### 1.3 Backward compatibility

Existing `config.yml` files with no `review` key and only `move` rules parse without error. The new action types are purely additive to the discriminated union. No migration step required.

### 1.4 Shared types update

**File: `src/shared/types.ts`**

Re-export new action types: `ReviewAction`, `SkipAction`, `DeleteAction`, `ReviewConfig`.

Add `source` field to `ActivityEntry`:

```typescript
source: string;  // "arrival" | "sweep"
```

Add new shared type:

```typescript
interface ReviewStatusResponse {
  folder: string;
  totalMessages: number;
  unreadMessages: number;
  readMessages: number;
  nextSweepAt: string | null;    // ISO timestamp
  lastSweep: {
    completedAt: string;
    messagesArchived: number;
    errors: number;
  } | null;
}
```

---

## 2. IMAP Client Changes

**File: `src/imap/client.ts`**

### 2.1 Parameterized mailbox lock

Change `withMailboxLock` from private to public and add a `folder` parameter:

```
public async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T>
```

Currently hardcodes `'INBOX'` in `this.flow.getMailboxLock('INBOX')`. Change to use the `folder` parameter. All existing callers (`moveMessage`, `createMailbox`, `fetchNewMessages`) pass `'INBOX'` explicitly to preserve current behavior.

Public visibility is necessary because `ReviewSweeper` needs to acquire locks on the Review folder from outside the client.

### 2.2 Update `moveMessage` to accept a source folder

IMAP `messageMove` operates on the currently-selected mailbox. To move a message out of Review during sweep, the client needs to lock the Review folder.

New signature:

```
async moveMessage(uid: number, destination: string, sourceFolder: string = 'INBOX'): Promise<void>
```

Passes `sourceFolder` to `withMailboxLock`.

### 2.3 New method: `fetchAllMessages`

The sweep needs all messages in the Review folder with flags and internal dates.

```
async fetchAllMessages(folder: string): Promise<ReviewMessage[]>
```

Implementation: acquires lock on `folder`, fetches `'1:*'` with query `{ uid: true, flags: true, internalDate: true, envelope: true }`. Returns all messages with no UID filtering.

Also add a lower-level fetch method that assumes the mailbox is already selected (for use inside `withMailboxSwitch`):

```
async fetchMessagesRaw(range: string, query: object): Promise<unknown[]>
```

`fetchAllMessages` uses this internally after acquiring its own lock. The sweep uses `fetchMessagesRaw` inside `withMailboxSwitch` to avoid double-locking.

### 2.4 `ReviewMessage` type

**File: `src/imap/messages.ts`**

```typescript
interface ReviewMessage {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  envelope: {
    from: EmailAddress;
    to: EmailAddress[];
    cc: EmailAddress[];
    subject: string;
    messageId: string;
  };
}
```

Add a conversion helper:

```
reviewMessageToEmailMessage(rm: ReviewMessage): EmailMessage
```

Maps envelope fields to `EmailMessage` shape so the rule evaluator can process it. Sets `date` from `internalDate`, `flags` from `flags`.

### 2.5 New method: `getSpecialUseFolder`

For Trash folder detection:

```
async getSpecialUseFolder(use: string): Promise<string | null>
```

Queries the server's mailbox list for the folder with the given special-use attribute (e.g., `'\\Trash'`). ImapFlow exposes this via `list()` — iterate mailboxes, find one where `specialUse` matches. Cache the result for the connection lifetime in a `Map<string, string>`. Returns `null` if not found.

### 2.6 Add `list` to `ImapFlowLike` interface

```
list(options?: Record<string, unknown>): Promise<unknown[]>;
```

Needed for `getSpecialUseFolder` to enumerate server mailboxes.

### 2.7 Mailbox switching for sweeps

New high-level method for the single-connection serialized model:

```
async withMailboxSwitch<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T>
```

Behavior:
1. Pauses IDLE/polling (calls `stopIdleAndPoll()`)
2. Acquires mailbox lock on `folder`
3. Executes `fn`
4. Releases lock
5. Re-opens INBOX (`mailboxOpen('INBOX')`)
6. Resumes IDLE/polling (`startIdleOrPoll()`)

All connection management stays inside `ImapClient`. The `ReviewSweeper` calls `withMailboxSwitch('Review', async (flow) => { ... })` and doesn't worry about IDLE state.

During the mailbox switch, `newMail` events for INBOX won't fire. That's fine — sweeps are short (seconds) and infrequent (hours). INBOX messages arriving during a sweep get picked up when IDLE resumes.

---

## 3. Database & Activity Logging Changes

**File: `src/log/index.ts`**

### 3.1 Schema migration: add `source` column

Add a migration step after table creation:

```sql
ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival';
```

Run in a try/catch — `ALTER TABLE ADD COLUMN` fails if the column already exists (idempotent). Existing rows get `'arrival'` as default, which is correct for all pre-v0.2 activity.

### 3.2 Update `logActivity` signature

Current: `logActivity(result: ActionResult, message: EmailMessage, rule: Rule): void`

Sweep actions may not have a matching rule (global default archive path), and the source must be recorded.

New signature:

```
logActivity(result: ActionResult, message: EmailMessage, rule: Rule | null, source: 'arrival' | 'sweep'): void
```

Update the INSERT statement to include `source`. When `rule` is null, insert `null` for `rule_id` and `rule_name`.

All existing callers (in `Monitor.processMessage`) pass the matched rule and `'arrival'`.

### 3.3 No changes to `getRecentActivity`

`SELECT *` picks up the new column. The `ActivityEntry` type gains `source` from the shared types update.

---

## 4. Action Execution Changes

**File: `src/actions/index.ts`**

### 4.1 New `ActionContext` type

Replace the accumulating positional parameters with a context object:

```typescript
interface ActionContext {
  client: ImapClient;
  reviewFolder: string;
  trashFolder: string;
}
```

New `executeAction` signature:

```
executeAction(ctx: ActionContext, message: EmailMessage, rule: Rule): Promise<ActionResult>
```

### 4.2 New cases in `executeAction` switch

**`case 'review'`:** Calls existing `executeMove` helper with `ctx.reviewFolder` as destination. `ActionResult` has `action: 'review'` and `folder: ctx.reviewFolder`.

**`case 'skip'`:** No IMAP operation. Returns immediately: `{ ...base, success: true, action: 'skip' }`. No `folder` field. Message stays in INBOX.

**`case 'delete'`:** Calls `executeMove` with `ctx.trashFolder` as destination. `ActionResult` has `action: 'delete'` and `folder: ctx.trashFolder`.

### 4.3 `executeMove` helper

No changes. It already takes a folder string and handles auto-creation on first failure. All action types that involve moving (`move`, `review`, `delete`) funnel through it. `skip` bypasses it.

---

## 5. ReviewSweeper

**New file: `src/sweep/index.ts`**

The largest new component. A periodic batch job that ages messages out of the Review folder.

### 5.1 Class shape

```typescript
interface SweepDeps {
  imapClient: ImapClient;
  activityLog: ActivityLog;
  configRepo: ConfigRepository;
  trashFolder: string;
  logger?: pino.Logger;
}

interface SweepState {
  lastSweepAt: Date | null;
  messagesArchived: number;
  errors: number;
  nextSweepAt: Date | null;
  reviewFolderTotal: number;
  reviewFolderRead: number;
  reviewFolderUnread: number;
}
```

Constructor takes `SweepDeps`. Initializes `SweepState` to zeroes/nulls. Stores a reference to `configRepo` (not a snapshot) because the sweep timer must restart when review config changes.

### 5.2 Lifecycle methods

**`start(): void`** — Schedules the first sweep after a 30-second delay (let IMAP stabilize), then sets a repeating timer at `config.review.sweep.intervalHours` intervals. Computes and stores `nextSweepAt`.

**`stop(): void`** — Clears the startup delay timer and the repeating timer. Sets `nextSweepAt` to null.

**`restart(): void`** — Calls `stop()` then `start()`. Used when review config changes.

**`getState(): SweepState`** — Returns cached state. No IMAP calls. This is what `/api/review/status` serves. State is populated as a side effect of each sweep run.

### 5.3 `runSweep(): Promise<void>` — main sweep logic

Serialized with a boolean guard (same pattern as `Monitor.processing`). If a sweep is already running when the timer fires, skip the cycle.

**Step 1: Fetch Review folder contents**

Call `imapClient.withMailboxSwitch(reviewFolder, async (flow) => { ... })`. Inside the switch callback:

- Fetch all messages using `fetchMessagesRaw('1:*', { uid: true, flags: true, internalDate: true, envelope: true })`.
- Parse into `ReviewMessage` objects.
- Cache folder stats: `reviewFolderTotal`, `reviewFolderRead` (has `\Seen`), `reviewFolderUnread`.

**Step 2: Evaluate each message against sweep thresholds**

For each message, check:
1. Has `\Seen` flag AND `internalDate` older than `readMaxAgeDays` → eligible.
2. Does NOT have `\Seen` AND `internalDate` older than `unreadMaxAgeDays` → eligible.
3. Otherwise → skip, leave in Review.

"Older than N days" means `Date.now() - internalDate.getTime() > N * 86_400_000`.

Extract as a pure function for testability:

```
isEligibleForSweep(message: ReviewMessage, config: SweepConfig, now: Date): boolean
```

Collect eligible messages into a list.

**Step 3: Determine archive destination for each eligible message**

Single re-evaluation pass per message. Extract as a pure function:

```
resolveSweepDestination(
  message: EmailMessage,
  rules: Rule[],
  defaultArchiveFolder: string,
): { destination: string; action: 'move' | 'delete'; rule: Rule | null }
```

Filter the rule set to exclude `skip` rules (skip is meaningless during sweep):

```
const sweepRules = rules.filter(r => r.action.type !== 'skip');
const match = evaluateRules(sweepRules, messageAsEmailMessage);
```

Convert `ReviewMessage` to `EmailMessage` using `reviewMessageToEmailMessage()` before passing to `evaluateRules`.

Interpret the matched rule's action:

- **`move`** → destination is the rule's `folder`. Return rule reference.
- **`delete`** → destination is trash folder, action is `'delete'`. Return rule reference.
- **`review` with `folder`** → destination is that rule's `folder`. Return rule reference.
- **`review` without `folder`** → fall through to global default.
- **No match** → fall through to global default.

Global default fallback: destination is `config.review.defaultArchiveFolder`. Return `rule: null`.

**Step 4: Execute moves**

Still inside `withMailboxSwitch`. For each eligible message with a resolved destination:

- Call `flow.messageMove([uid], destination, { uid: true })`.
- Auto-create destination folder on first failure, retry once (same pattern as existing `executeMove`).
- Log each action to `activityLog.logActivity(...)` with `source: 'sweep'`.
- Track success/error counts.

**Step 5: Update state**

Set `lastSweepAt` to now, `messagesArchived` and `errors` from counters. Compute `nextSweepAt` from timer interval.

### 5.4 Error handling

- IMAP connection down when timer fires → log warning, skip cycle. Next cycle retries.
- Individual message move failure → log error, increment error counter, continue to next message. Don't abort the sweep.

---

## 6. Monitor Changes

**File: `src/monitor/index.ts`**

### 6.1 New fields

- `private reviewFolder: string` — from `config.review.folder`.
- `private trashFolder: string` — resolved at startup.

### 6.2 Trash folder resolution

Add to `start()`, after `this.client.connect()`:

1. Call `this.client.getSpecialUseFolder('\\Trash')`.
2. If found, use it. If null, fall back to `config.review.trashFolder`.
3. Store as `this.trashFolder`.

Runs once per connection lifecycle. If Monitor is rebuilt on IMAP config change (which already happens in `index.ts`), it re-resolves.

### 6.3 Update `processMessage`

Build `ActionContext` and pass to `executeAction`:

```typescript
const ctx: ActionContext = {
  client: this.client,
  reviewFolder: this.reviewFolder,
  trashFolder: this.trashFolder,
};
const result = await executeAction(ctx, message, matchedRule);
```

### 6.4 Update activity logging call

Change from: `this.activityLog.logActivity(result, message, matchedRule)`
To: `this.activityLog.logActivity(result, message, matchedRule, 'arrival')`

### 6.5 Skip actions

No special handling needed. When a `skip` rule matches, it flows through `executeAction` (which returns success with no IMAP operation) and then through `logActivity` like any other action.

---

## 7. Config Repository & Change Listeners

**File: `src/config/repository.ts`**

### 7.1 New accessors

- `getReviewConfig(): ReviewConfig` — returns `this.config.review`.

### 7.2 New update method

- `async updateReviewConfig(input: Partial<ReviewConfig>): Promise<ReviewConfig>` — merges input with existing review config, validates with `reviewConfigSchema`, persists, notifies listeners.

### 7.3 New change listener

- `private reviewListeners: Array<(config: Config) => void> = []`
- `onReviewConfigChange(fn: (config: Config) => void): void`
- `updateReviewConfig` calls all review listeners after persist.

### 7.4 Wiring in `src/index.ts`

**Create ReviewSweeper** after Monitor, before server start:

```
const trashFolder = await imapClient.getSpecialUseFolder('\\Trash')
  ?? config.review.trashFolder;

const sweeper = new ReviewSweeper({
  imapClient,
  activityLog,
  configRepo,
  trashFolder,
  logger,
});
```

**Register config change listener:**

```
configRepo.onReviewConfigChange(() => {
  sweeper.restart();
});
```

**Update existing `onImapConfigChange`** to also rebuild sweeper:

```
configRepo.onImapConfigChange(async (newConfig) => {
  sweeper.stop();
  await monitor.stop();
  const newClient = new ImapClient(newConfig.imap, createImapFlow);
  monitor = new Monitor(newConfig, { imapClient: newClient, activityLog, logger });
  await monitor.start();
  const newTrash = await newClient.getSpecialUseFolder('\\Trash')
    ?? newConfig.review.trashFolder;
  sweeper = new ReviewSweeper({
    imapClient: newClient, activityLog, configRepo, trashFolder: newTrash, logger,
  });
  sweeper.start();
});
```

**Start sweeper** after `monitor.start()`. Stop on shutdown.

**Pass sweeper to `buildServer`** so API routes can access `sweeper.getState()`.

---

## 8. API Route Changes

### 8.1 Existing routes: no code changes needed

**`src/web/routes/activity.ts`** — `SELECT *` picks up the new `source` column. Response shape gains the field automatically via the updated `ActivityEntry` type.

**`src/web/routes/rules.ts`** — Rule CRUD accepts the expanded `actionSchema` union. Zod validation in `ConfigRepository` handles new action types. Existing `move` payloads unchanged.

**`src/web/routes/imap-config.ts`** — No changes.

**`src/web/routes/status.ts`** — No changes.

### 8.2 New routes

**New file: `src/web/routes/review.ts`**

Register: `registerReviewRoutes(app: FastifyInstance, deps: ServerDeps)`

**`GET /api/review/status`** — Calls `deps.sweeper.getState()`, combines with `configRepo.getReviewConfig().folder`, returns `ReviewStatusResponse`. `lastSweep` is `null` before first sweep. `nextSweepAt` is `null` if sweeper is stopped.

**New file: `src/web/routes/review-config.ts`**

Register: `registerReviewConfigRoutes(app: FastifyInstance, deps: ServerDeps)`

**`GET /api/config/review`** — Returns `deps.configRepo.getReviewConfig()`. Straight passthrough, no masking (no secrets).

**`PUT /api/config/review`** — Accepts partial or full `ReviewConfig` body. Calls `deps.configRepo.updateReviewConfig(body)`. Returns updated config. The `onReviewConfigChange` listener restarts the sweep timer automatically.

### 8.3 Server wiring

**File: `src/web/server.ts`**

Update `ServerDeps` to include `sweeper: ReviewSweeper`. Call `registerReviewRoutes` and `registerReviewConfigRoutes` alongside existing registrations.

### 8.4 Frontend API client update

**File: `src/web/frontend/api.ts`**

Add:

```
review: {
  status()          // GET /api/review/status → ReviewStatusResponse
}
config: {
  ...existing...
  getReview()       // GET /api/config/review → ReviewConfig
  updateReview(cfg) // PUT /api/config/review → ReviewConfig
}
```

---

## 9. Frontend UI Changes

**File: `src/web/frontend/app.ts`**

### 9.1 Rule modal: action type selector

Replace the hardcoded `<select>` (currently only `move`) with four options:

| Value | Label |
|-------|-------|
| `move` | Archive to folder |
| `review` | Route to Review |
| `skip` | Leave in Inbox |
| `delete` | Delete |

Default selection for new rules: `move`.

**Folder field visibility logic** (bind `change` listener on the select):

- **`move`** → show folder field, required, label "Folder".
- **`review`** → show folder field, optional, label "Archive folder after review". Hint text: "Leave blank to use default archive folder."
- **`skip`** → hide folder field.
- **`delete`** → hide folder field.

**Save handler** builds action object from selected type:

- `move` → `{ type: 'move', folder }` (validate folder non-empty).
- `review` → `{ type: 'review' }` if folder blank, `{ type: 'review', folder }` if populated.
- `skip` → `{ type: 'skip' }`.
- `delete` → `{ type: 'delete' }`.

**Edit mode:** Set select to rule's current action type, trigger change handler to show/hide folder, populate folder from `rule.action.folder` if present.

### 9.2 Rules table: action display

Replace current `actionStr` (hardcoded `${rule.action.type} → ${rule.action.folder}`):

| Action | Display |
|--------|---------|
| `move` | `→ Projects/Acme` |
| `review` (no folder) | `→ Review` |
| `review` (with folder) | `→ Review → MailingLists` |
| `skip` | `— Inbox` |
| `delete` | `✕ Delete` |

### 9.3 Activity table: source badge

For sweep-sourced entries (`entry.source === 'sweep'`), render a small `[sweep]` badge before the action text in the Action column, styled with a muted background. Arrival entries get no badge (they're the default).

### 9.4 Activity table: action display

Update the action column from raw `entry.action` string to formatted display:

| action | folder | Display |
|--------|--------|---------|
| `move` | Projects/Acme | `→ Projects/Acme` |
| `review` | Review | `→ Review` |
| `skip` | (null) | `— Inbox` |
| `delete` | Trash | `✕ Trash` |

### 9.5 Settings page: Review status panel

Add a new section below the existing IMAP connection settings card.

Fetch `api.review.status()` alongside existing `api.config.getImap()` and `api.status.get()` calls in `renderSettings`.

Display:

- **Review folder stats:** "Review: 42 messages (14 read, 28 unread)"
- **Next sweep:** "Next sweep: in 3h 22m" (computed from `nextSweepAt`) or "Next sweep: —" if null.
- **Last sweep:** "Last sweep: 2h ago — 7 archived, 0 errors" or "Last sweep: never" if null.
- **Sweep settings:** Show current `readMaxAgeDays`, `unreadMaxAgeDays`, `intervalHours` as read-only text. Optionally make editable with save button calling `api.config.updateReview()` — display-only is the minimum for v0.2.

---

## 10. Testing Strategy

### 10.1 Unit tests

**Sweep threshold evaluation** — test the pure `isEligibleForSweep` function:

- Read message older than `readMaxAgeDays` → eligible
- Read message younger than `readMaxAgeDays` → not eligible
- Unread message older than `unreadMaxAgeDays` → eligible
- Unread message younger than `unreadMaxAgeDays` → not eligible
- Unread message older than `readMaxAgeDays` but younger than `unreadMaxAgeDays` → not eligible
- Edge case: message exactly at threshold boundary

**Sweep archive destination resolution** — test the pure `resolveSweepDestination` function:

- Message matches a `move` rule → returns that rule's folder
- Message matches a `delete` rule → returns trash, action `'delete'`
- Message matches a `review` rule with `folder` → returns that folder
- Message matches a `review` rule without `folder` → returns `defaultArchiveFolder`, rule is null
- Message matches a `skip` rule only → skip filtered out, falls to default
- No rule matches → returns `defaultArchiveFolder`, rule is null
- Higher-priority `move` rule beats lower-priority `review` rule
- Higher-priority `review` rule with folder beats lower-priority `move` rule

**New action schemas** — add to existing config schema tests:

- `review` action with folder validates
- `review` action without folder validates
- `review` action with empty string folder rejects
- `skip` action validates, rejects extra fields
- `delete` action validates, rejects extra fields
- Existing `move` rules still validate (backward compat)
- Full config with no `review` section parses with defaults
- Full config with partial `review` section fills in defaults

**Action execution** — add to existing action tests:

- `skip` action returns success with no IMAP calls
- `review` action calls `moveMessage` with the review folder
- `delete` action calls `moveMessage` with the trash folder
- `review` action auto-creates Review folder on first failure

**`reviewMessageToEmailMessage` conversion:**

- Envelope fields map correctly
- Handles missing/empty fields gracefully

### 10.2 Integration tests

**Sweep lifecycle (mock IMAP):**

- Sweep timer fires → fetches Review → identifies eligible messages → moves them → logs with `source: 'sweep'`
- Sweep skips messages that aren't old enough
- Sweep serialization: second sweep skipped if first still running
- Sweep with empty Review folder: no-op, updates stats to zeros
- Sweep on startup: fires after 30s delay

**Monitor with new action types:**

- `review` rule → message moved to Review folder, logged with `action: 'review'`, `source: 'arrival'`
- `skip` rule → message stays in INBOX, logged with `action: 'skip'`, `source: 'arrival'`, `folder: null`
- `delete` rule → message moved to Trash, logged with `action: 'delete'`, `source: 'arrival'`
- Existing `move` rules still work identically

**IMAP client: mailbox switching:**

- `withMailboxSwitch` pauses IDLE, opens target folder, executes callback, reopens INBOX, resumes IDLE
- `withMailboxSwitch` during active processing: serialized by lock, no state corruption
- `fetchAllMessages` returns UIDs, flags, dates, envelopes

**Activity log: source column migration:**

- Fresh database: `source` column exists
- Existing database without `source`: migration adds it, existing rows get `'arrival'`
- `logActivity` with `source: 'sweep'` persists correctly
- `getRecentActivity` returns `source` field

**API routes:**

- `GET /api/review/status` returns correct shape, nulls before first sweep
- `GET /api/config/review` returns defaults when no review section in config
- `PUT /api/config/review` updates config, triggers sweeper restart
- Rule CRUD accepts all four action types
- Activity endpoint returns `source` field

### 10.3 What NOT to test

- ImapFlow internals (library's responsibility)
- Exact timer intervals (flaky)
- Frontend DOM manipulation (vanilla JS, test manually)

---

## 11. Migration & Deployment

### 11.1 Config migration

None required. The `review` config section is optional with defaults. Existing `config.yml` files parse unchanged. New action types are additive. First `review` action auto-creates the Review folder on the IMAP server.

### 11.2 Database migration

Handled at startup in `ActivityLog` constructor — `ALTER TABLE ADD COLUMN source` runs in a try/catch. Idempotent. No manual migration step.

### 11.3 Deployment

No new environment variables. No new Docker volumes. No new ports. The system starts, defaults apply, sweep timer begins. If the user has no `review` rules, the sweeper runs but finds nothing — harmless.

### 11.4 Rollback

Downgrade to v0.1: the extra `source` column in SQLite is ignored (`SELECT *` doesn't break). The `review` config key in YAML would cause a Zod validation error on v0.1 schema — but only if the user added it. If they never edited review config, the YAML is unchanged and v0.1 loads fine.
