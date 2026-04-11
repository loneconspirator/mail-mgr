# v0.2 Product Requirements: Two-Stream Intake

## Overview

v0.2 transforms mail-mgr from a single-action auto-filer into a triage assistant. Today every rule is "move message to folder X." This tier introduces three routing dispositions (archive, review, skip), a Review folder with lifecycle sweeps, a delete action, and multi-folder monitoring. The user's inbox volume drops dramatically while retaining visibility over lower-priority mail.

---

## 1. Routing Dispositions

### 1.1 Three action types replace the single "move" action

Every rule must specify one of four action types:

| Action | Behavior | Config representation |
|--------|----------|----------------------|
| **move** | Move to a named folder (existing v0.1 behavior) | `{ type: "move", folder: "Projects/Acme" }` |
| **review** | Move to the Review folder; optionally specifies an archive folder for sweep | `{ type: "review" }` or `{ type: "review", folder: "MailingLists" }` |
| **skip** | Leave in Inbox, mark as processed | `{ type: "skip" }` |
| **delete** | Move to Trash | `{ type: "delete" }` |

### 1.2 Constraints

- `move` requires a non-empty `folder` field. `skip` and `delete` have no additional fields.
- `review` accepts an optional `folder` field. During **arrival routing**, the message always goes to the Review folder regardless of whether `folder` is set — the folder field has no effect at arrival time. During **sweep archival**, if the rule that originally matched has a `folder`, that folder is used as the archive destination instead of the global `review.defaultArchiveFolder`. This lets the user say "route newsletters to Review, and when they age out, file them in MailingLists" vs. "route GitHub notifications to Review, and when they age out, file them in Projects/OpenSource" — all without needing separate `move` rules.
- Existing v0.1 rules (all `type: "move"`) must continue working with no config migration. The schema change is purely additive — new action types in the discriminated union.
- `skip` is an explicit "I've seen this pattern and it belongs in Inbox." Without it, the only way to prevent a lower-priority rule from matching is to reorder rules. `skip` makes intent clear and stops evaluation.
- `delete` moves to the IMAP Trash folder (or server-configured equivalent via the `\Trash` special-use attribute). It does not expunge.

### 1.3 Rule evaluation is unchanged

First-match-wins, sorted by `order`, filtered to enabled. The only change is that a matched rule can now produce any of the four action types instead of only `move`.

---

## 2. Review Folder

### 2.1 Purpose

A holding pen for mail that deserves a glance but not individual inbox attention. Newsletters, mailing lists, automated notifications, social media alerts — anything the user wants to batch-process a couple times a week rather than see in real time.

### 2.2 Folder name

Configurable. Default: `Review`. Stored in the top-level config alongside `imap` and `server`:

```yaml
review:
  folder: Review
```

If the folder doesn't exist on the IMAP server when a `review` action fires, auto-create it (same behavior as `move` folder auto-creation today).

### 2.3 What happens to messages

Messages routed to Review arrive there unread. The system does not modify flags on delivery — it simply moves the message. The user reads (or doesn't read) messages in Review via their mail client.

---

## 3. Review Lifecycle Sweeps

### 3.1 Purpose

Messages don't live in Review forever. The sweep process ages them out based on read status and time since arrival, auto-archiving them to keep the folder manageable.

### 3.2 Sweep rules

Two thresholds, evaluated in order:

1. **Read + stale:** Messages with the `\Seen` flag AND an IMAP internal date older than `readMaxAgeDays` → auto-archive.
2. **Unread + abandoned:** Messages without `\Seen` AND an IMAP internal date older than `unreadMaxAgeDays` → auto-archive.

### 3.3 Archive destination

When a sweep archives a message, it needs to know where to put it. The sweep re-evaluates the message against the current rule set in priority order:

1. **Filter out non-actionable rules:** Remove `skip` rules and `review` rules that have no `folder` field. These have no meaningful sweep destination — `skip` is a no-op and a folder-less `review` would just loop the message back to Review.
2. **Evaluate remaining rules in order.** The candidate set contains `move`, `delete`, and `review`-with-`folder` rules. A `review` rule with a `folder` is treated as a move to that folder during sweep. The first matching rule wins.
3. **If no rule matches**, fall back to the global default: `review.defaultArchiveFolder` (default: `MailingLists`).

Rules are processed in their normal priority order, so the result is straightforward:

- A `review` rule with `folder: "MailingLists"` → message ages out to `MailingLists`.
- A `review` rule with no `folder` → filtered out; other rules get a chance, otherwise falls back to `review.defaultArchiveFolder`.
- A higher-priority `move` rule that matches the same pattern → wins naturally because it's evaluated first.

### 3.4 Configuration

```yaml
review:
  folder: Review
  defaultArchiveFolder: MailingLists
  sweep:
    intervalHours: 6
    readMaxAgeDays: 7
    unreadMaxAgeDays: 14
```

All sweep fields have defaults as shown above.

### 3.5 Sweep execution model

- Sweeps run on a periodic timer (`intervalHours`), not triggered by IMAP events. This is a batch job.
- A sweep fetches all messages in the Review folder with their UID, flags, and internal date.
- Messages matching either threshold are processed. For each:
  - Determine archive destination per §3.3: re-evaluate against the filtered rule set (no `skip`, no folder-less `review`), first match wins, otherwise fall back to the global default.
  - Execute the move (or delete).
  - Log to the activity table with a distinct source indicator (see §5.2).
- Sweeps must be serialized (no concurrent sweeps). If a sweep is already running when the timer fires, skip that cycle.
- Sweeps must not block the arrival-routing pipeline. They run on a separate timer and acquire mailbox locks independently.

### 3.6 Sweep on startup

Run one sweep shortly after startup (e.g., 30 seconds delay) to catch up on anything that aged out while the system was down. Don't run immediately — let the IMAP connection stabilize first.

---

## 4. Multi-Folder Monitoring

### 4.1 Current state

The `ImapClient` currently:
- Opens a single mailbox (`INBOX`) on connect.
- Holds a mailbox lock scoped to `INBOX` for all operations.
- Listens for `exists` events only on `INBOX`.
- Emits `newMail` which the `Monitor` uses to trigger `processNewMessages()`.

### 4.2 Required changes

The system must now interact with two folders:

| Folder | Purpose | Trigger model |
|--------|---------|---------------|
| INBOX | Arrival routing — new messages evaluated against rules | Real-time (IDLE or poll, as today) |
| Review | Lifecycle sweeps — existing messages evaluated by age/flags | Periodic timer (not IMAP events) |

### 4.3 IMAP connection model

**INBOX monitoring** stays as-is: one IMAP connection sits in IDLE (or polls) on INBOX, emitting `newMail` events.

**Review sweeps** do not need a persistent connection or IDLE. When the sweep timer fires, the sweep process:
1. Acquires a mailbox lock on the Review folder.
2. Fetches all messages with UID, flags (`\Seen`), and internal date.
3. Processes eligible messages (move to archive destination).
4. Releases the lock.

This is a periodic batch operation, not a continuously-monitored mailbox. The existing `ImapClient` needs to support operations on folders other than INBOX, but it does not need to IDLE on multiple folders simultaneously.

### 4.4 Mailbox lock scope

The current `withMailboxLock` always locks `INBOX`. This needs to become parameterized — the caller specifies which folder to lock. Arrival routing locks INBOX. Sweeps lock the Review folder. Move operations lock the source folder (since `messageMove` operates on the currently-selected mailbox).

### 4.5 Concurrent access

Arrival routing and sweep operations should not run simultaneously on the same IMAP connection if they target different mailboxes (IMAP only supports one selected mailbox at a time). Options:

- **Single connection, serialized:** Sweep acquires the connection, switches to Review, does its work, switches back to INBOX. Simple but blocks arrival routing during sweeps.
- **Two connections:** One persistent connection for INBOX monitoring, a second short-lived connection for sweep operations. More complex but no blocking.

Recommended approach: **single connection, serialized.** Sweeps are infrequent (every 6 hours) and fast (enumerate + move). Blocking arrival routing for a few seconds during a sweep is acceptable. The sweep should pause IDLE, switch mailbox, do its work, switch back, and resume IDLE.

If this proves too slow in practice (large Review folders), upgrading to two connections is a future optimization, not a v0.2 requirement.

---

## 5. Activity Logging Changes

### 5.1 New action types in logs

The activity table's `action` column currently stores `"move"`. It must now also store `"review"`, `"skip"`, and `"delete"` corresponding to the new action types.

### 5.2 Source stream indicator

Add a `source` column to the activity table to distinguish where the action was triggered:

| Source value | Meaning |
|-------------|---------|
| `arrival` | Message processed during arrival routing (new message in INBOX) |
| `sweep` | Message processed during a Review lifecycle sweep |

This lets the UI and queries distinguish "rule fired on arrival" from "message aged out of Review."

### 5.3 Logging for skip actions

When a `skip` rule matches, log it to the activity table like any other action. The `folder` field is null. This provides visibility into which messages are being explicitly left in Inbox and which rules are responsible.

### 5.4 Logging for sweep actions

Sweep-archived messages are logged with:
- `source`: `"sweep"`
- `action`: `"move"` (or `"delete"` if a delete rule matched during re-evaluation)
- `folder`: the archive destination
- `rule_id` / `rule_name`: the rule that determined the destination. This could be: (a) a `move`/`delete` rule that matched during re-evaluation, (b) the original `review` rule whose `folder` field was used, or (c) null if the global default archive folder was used.
- A null `rule_id` with a non-null `folder` indicates the global default archive path was taken.

---

## 6. Configuration Schema Changes

### 6.1 New action schemas

Add to the Zod action discriminated union:

- `reviewActionSchema`: `{ type: "review", folder?: string }` — optional `folder` specifies the archive destination when the message ages out of Review during sweep. If omitted, the global `review.defaultArchiveFolder` is used.
- `skipActionSchema`: `{ type: "skip" }` — no additional fields.
- `deleteActionSchema`: `{ type: "delete" }` — no additional fields.

The `actionSchema` union becomes: `move | review | skip | delete`.

### 6.2 New review config section

Top-level config gains a `review` key:

```typescript
review:
  folder: string          // default "Review"
  defaultArchiveFolder: string  // default "MailingLists"
  sweep:
    intervalHours: number  // default 6
    readMaxAgeDays: number // default 7
    unreadMaxAgeDays: number // default 14
```

All fields optional with defaults. The entire `review` section is optional — if absent, defaults apply.

### 6.3 Backward compatibility

- Existing `config.yml` files with only `move` rules load without errors. The new action types are additive.
- If the `review` section is absent, the system still creates the Review folder on first `review` action and uses default sweep settings.
- No migration step required.

---

## 7. Web UI Changes

### 7.1 Rule editor: action type selector

The rule create/edit modal currently has a hardcoded "move" action with a folder text field. Replace with:

- A dropdown/radio group: **Archive to folder** | **Route to Review** | **Leave in Inbox** | **Delete**
- The folder text field appears when "Archive to folder" is selected (required) or when "Route to Review" is selected (optional, labeled "Archive to folder after review" or similar to indicate it controls where the message goes when it ages out of Review). When the folder field is populated for a `review` rule, the UI should make it clear this is the sweep destination, not the immediate destination.
- Default selection for new rules: "Archive to folder" (preserves current behavior).

Use human-readable labels in the UI, not the internal type names:

| Internal type | UI label |
|--------------|----------|
| `move` | Archive to folder |
| `review` | Route to Review |
| `skip` | Leave in Inbox |
| `delete` | Delete |

### 7.2 Rules table: action display

The rules list currently shows the destination folder. Update to show the action type:

| Action | Display |
|--------|---------|
| move | `→ Projects/Acme` (folder name, as today) |
| review (no folder) | `→ Review` |
| review (with folder) | `→ Review → MailingLists` (shows both the immediate and eventual destination) |
| skip | `— Inbox` |
| delete | `✕ Delete` |

### 7.3 Activity log: source column

Add a visual indicator for the source stream:

- **Arrival** actions: no special treatment (this is the default, existing behavior).
- **Sweep** actions: a small label or badge ("sweep") next to the timestamp or action column so the user can distinguish auto-archive-on-arrival from aged-out-of-Review.

### 7.4 Activity log: new action types

The activity table already shows the action and folder. The new action types should display naturally:

| Action | Folder | Display |
|--------|--------|---------|
| move | Projects/Acme | `→ Projects/Acme` |
| review | Review | `→ Review` |
| skip | (null) | `— Inbox` |
| delete | Trash | `✕ Trash` |

### 7.5 Review status panel

Add a new section to the Settings page (or as a new top-level tab — decision deferred to implementation):

- **Review folder item count:** Total messages currently in Review.
- **Read vs. unread breakdown:** How many are read vs. unread.
- **Upcoming sweep:** When the next sweep will run (countdown or absolute time).
- **Last sweep result:** When it ran, how many messages were archived, any errors.
- **Sweep settings:** Display current thresholds (read max age, unread max age, interval). Optionally editable inline — but at minimum, display them.

This information requires the system to periodically check the Review folder's state (count, flags). This can piggyback on the sweep timer — cache the folder state during each sweep and serve it via the API.

---

## 8. API Changes

### 8.1 Existing endpoints: no breaking changes

- `GET/POST/PUT/DELETE /api/rules` — rule payloads now accept the expanded action union. Existing `move` rules are unchanged.
- `GET /api/activity` — response rows gain a `source` field (`"arrival"` or `"sweep"`).
- `GET /api/status` — unchanged.

### 8.2 New endpoint: Review status

`GET /api/review/status`

Response:

```json
{
  "folder": "Review",
  "totalMessages": 42,
  "unreadMessages": 28,
  "readMessages": 14,
  "nextSweepAt": "2025-04-05T06:00:00Z",
  "lastSweep": {
    "completedAt": "2025-04-05T00:00:00Z",
    "messagesArchived": 7,
    "errors": 0
  }
}
```

Returns `null` for `lastSweep` if no sweep has run yet.

### 8.3 New endpoint: Review config

`GET /api/config/review` — returns current review configuration (folder name, sweep settings).

`PUT /api/config/review` — updates review configuration. Restarts the sweep timer with new settings.

---

## 9. Delete Action Specifics

### 9.1 Trash folder resolution

The delete action moves messages to the server's Trash folder. Resolution:

1. Use the IMAP `\Trash` special-use attribute to find the correct folder name (servers name it differently: "Trash", "Deleted Items", "Deleted Messages", etc.).
2. If special-use detection fails, fall back to a configurable name: `review.trashFolder` (default: `"Trash"`).

### 9.2 No expunge

Delete means "move to Trash," not "permanently destroy." The user's mail client handles Trash purging on its own schedule. The system never expunges.

### 9.3 Use cases

- Junk mail that bypasses the spam filter but matches a known pattern (e.g., repeated sender, known subject patterns).
- Automated notifications that have zero value even in batch (e.g., "your password was used to sign in" from a service you check daily anyway).

---

## 10. IMAP Client Changes

### 10.1 Parameterized mailbox operations

`withMailboxLock(folder, fn)` replaces the current `withMailboxLock(fn)` which hardcodes `INBOX`. All existing callers pass `"INBOX"` explicitly.

### 10.2 Fetch with flags and internal date

The sweep needs to read flags and internal date from messages in the Review folder. Add a new fetch method (or extend the existing one):

```typescript
async fetchAllMessages(folder: string): Promise<ReviewMessage[]>
```

Returns for each message: `uid`, `flags` (string array), `internalDate` (Date), and envelope fields (from, to, subject, messageId) for rule re-evaluation.

### 10.3 Trash folder detection

Add a method to query the server's special-use folders:

```typescript
async getSpecialUseFolder(use: '\\Trash' | '\\Junk' | ...): Promise<string | null>
```

Cache the result per connection (special-use mappings don't change within a session).

### 10.4 Mailbox switching for sweeps

When a sweep runs on a single-connection model, the client must:
1. Pause IDLE/polling on INBOX.
2. Open the Review mailbox.
3. Perform sweep operations.
4. Re-open INBOX.
5. Resume IDLE/polling.

Expose this as a high-level method that the sweep orchestrator calls, keeping the connection management internal to `ImapClient`.

---

## 11. Sweep Orchestration

### 11.1 New component: ReviewSweeper

A new module (`src/sweep/` or `src/review/`) responsible for:

- Running on a periodic timer.
- Fetching Review folder contents.
- Evaluating each message against sweep thresholds.
- Determining archive destination (rule re-evaluation → default).
- Executing moves.
- Logging results.
- Caching folder state for the Review status API.

### 11.2 Dependencies

The `ReviewSweeper` needs:

- `ImapClient` — for folder operations.
- Rule set — for re-evaluation during archive destination resolution. Subscribe to rule changes same as `Monitor`.
- `ActivityLog` — for logging sweep results.
- Review config — for thresholds, folder names, defaults.

### 11.3 Lifecycle

- Created and started in `index.ts` alongside the `Monitor`.
- Stopped on shutdown.
- Restarted when IMAP config changes (same as `Monitor`).
- Restarted when review config changes (new trigger).

---

## 12. Out of Scope for v0.2

These are explicitly **not** part of this tier:

- Folder taxonomy / picker UI (Tier 3).
- LLM classification (Tier 4).
- Move tracking / rule proposals (Tier 5).
- Review digest notifications (Tier 6).
- Batch-apply rules to existing messages (Tier 3).
- Multiple IMAP accounts (Tier 6).
- Mobile-responsive UI (Tier 6).

---

## 13. Acceptance Criteria

The following must be true for v0.2 to be considered complete:

1. A rule can be created with each of the four action types via the web UI.
2. A `review` rule moves a matching INBOX message to the Review folder.
3. A `skip` rule leaves the message in INBOX and logs it as processed.
4. A `delete` rule moves the message to the server's Trash folder.
5. The Review lifecycle sweep runs on schedule and archives read messages older than the configured threshold.
6. The Review lifecycle sweep archives unread messages older than the configured threshold.
7. Sweep archive destination resolves by re-evaluating against rules in priority order (`skip` and folder-less `review` rules filtered out; `review`-with-`folder` treated as a move), falling back to `review.defaultArchiveFolder` if no rule matches.
8. The activity log distinguishes arrival-routed actions from sweep-archived actions.
9. The web UI displays Review folder status (count, read/unread, next sweep, last sweep results).
10. All existing v0.1 functionality (move rules, activity log, settings, connection management) continues to work without config migration.
11. Sweep and arrival routing do not deadlock or corrupt each other's state.
12. Configuration changes to review settings take effect without a full restart.
