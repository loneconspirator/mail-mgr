# Automated Email Organization System

## Design Document

---

## Philosophy

Email serves two distinct purposes that are often conflated: **triage** (what do I need to do with this?) and **retrieval** (can I find it later?). This system separates those concerns cleanly.

The inbox is a processing queue, not a storage system. Its job is to surface things that need individual attention. Everything else should be routed elsewhere automatically, with minimal cognitive burden on the user.

Emails are almost never working documents. They are occasionally active conversations or action items, but mostly they are informational and should be archived and searchable — not cluttering the primary view.

---

## Two-Stream Intake Model

Incoming email is routed into one of two streams based on how it should be consumed.

### Stream 1: Inbox (Individual Attention)

The inbox contains only messages that probably warrant individual attention: personal messages, things addressed specifically to you, messages from important contacts, and anything the system doesn't have a rule for. This is the "act soon" queue. No separate folder is needed for urgency — if it's in the inbox, it matters now.

### Stream 2: Review (Batch Processing)

The Review folder is a lower-priority intake stream. It receives messages that deserve a glance but don't warrant individual attention: newsletters you sometimes read, mailing list traffic, notifications, promotional messages from companies you actually use, FYI-type messages.

These arrive unread and are processed in bulk a couple of times a week. The user scans the folder, acts on anything that warrants it (pulling it back to the inbox if needed), and moves on. This is the key quality-of-life feature — it dramatically reduces inbox volume without losing visibility into lower-priority mail.

### Review Lifecycle

Nothing lives in Review permanently. The automation enforces this:

- **Read items older than ~1 week** are automatically archived to the appropriate category folder (defaulting to Mailing Lists unless other rules match).
- **Unread items older than ~2 weeks** are also swept to archive. If you haven't batch-processed them in two weeks, you're not going to.

This eliminates the common failure mode where the review/deferral folder becomes a graveyard. There is no "someday/maybe" folder. Something either matters enough to pull back to the inbox, or it ages out into the archive.

**Optional digest:** Before the sweep runs, the system can surface a summary of items about to age out of Review, giving the user one last chance to pull something back. This is a trust feature — the sweep is the most aggressive autonomous action the system takes, and the digest ensures the user never has to worry about something being silently archived. The messages still exist in archive folders either way, but the digest eliminates the anxiety of "did I miss something?" Whether this matters depends on the user's discipline about checking Review. If you check it twice a week, the digest is noise. If you sometimes go two weeks without looking, it's a safety net.

### Default Routing Behavior

In the absence of a matching rule, the system always defaults to Inbox. Routing to Review, archive folders, or trash only happens when a rule — user-created or system-proposed — explicitly covers a message. The system never guesses. This means inbox volume starts high and decreases over time as the user adds rules and the system proposes new ones based on observed behavior. The user is always in control of what leaves the inbox.

---

## Rule-Based Sender Dispositions

Certain routing patterns are common enough to deserve dedicated UI treatment, even though they're implemented as ordinary rules.

### Disposition Views

The UI surfaces four filtered views, one for each routing outcome, covering any rule where sender is the only match criterion:

- **Priority Senders** — action is "leave in inbox." A spouse, a boss, a key client. Feels like managing a VIP list.
- **Blocked Senders** — action is "delete." Persistent spam, unwanted marketing. Feels like managing a block list.
- **Reviewed Senders** — action is "route to Review." Senders whose mail is informational but worth a periodic glance.
- **Archived Senders** — action is "move to [archive folder]." Grouped by destination folder, so the user sees which senders route to which archive categories.

Each view supports adding and removing senders directly, creating or deleting the underlying rule. For rules with more complex match criteria (sender + subject, sender + header visibility, etc.), the full rule editor is still the right tool — the disposition views only manage the simple sender-only cases.

### Why Rules, Not Separate Lists

A VIP list or block list would duplicate what rules already do, forcing the user to check two places to understand routing behavior and creating precedence conflicts between systems. By keeping rules as the single source of truth, the UI stays honest: every routing decision is traceable to one rule. The filtered views provide the convenience of list management without the complexity of a parallel system.

### Action Folders (Future)

As a convenience for managing sender dispositions from the mail client (without switching to the web UI), the system can expose special "action" folders. Moving a message to an action folder triggers rule creation:

- **Actions/VIP Sender** — creates an inbox-pinning rule for the sender, archives the message
- **Actions/Block Sender** — creates an auto-delete rule for the sender, deletes the message
- **Actions/Undo VIP** — removes the inbox-pinning rule for the sender, archives the message
- **Actions/Unblock Sender** — removes the auto-delete rule for the sender, returns message to inbox

These are shortcuts for rule management, not a separate data structure. The resulting rules appear in the normal rule list and the filtered disposition views.

---

## Archival Folder Structure

The archival layer uses a small, intentional set of category folders for retrieval. An email can only live in one folder (a constraint of IMAP/Mac Mail), so the automation picks the most useful single category.

### Structure

```
Inbox
Review
Archive/
  Activities/
    Mountaineers/
    [other activity-specific subfolders]
  MailingLists/
    [specific list subfolders as warranted]
  Projects/
    [active project subfolders]
  [other top-level categories as needed]
zz_old/
  [retired project and activity subfolders]
```

### Folder Principles

- **A topic gets its own subfolder when you would plausibly browse it rather than search for a specific message.** The Mountaineers folder exists because those emails come from varying senders with unpredictable subject lines, and you occasionally want to scan them. A one-time transaction with a vendor does not need its own folder.
- **Old project folders don't need to be collapsed.** They aren't hurting anything. Keep them in `zz_old` so they're out of sight but still browsable. The one time in three years you need to find something from that project, you'll be glad it's there.
- **The default archive destination is Mailing Lists** for anything the system routes through Review, unless more specific rules match. For messages that bypass Review (confidently categorized at arrival), the system files directly to the matched folder.
- **Keep the active folder list short.** When a project ends, stop filing into its folder and eventually move it to `zz_old`. The automation should know which projects are active.

---

## Message Addressing Signals

Rules can match on two distinct addressing concepts that are often conflated:

### Envelope Recipient

The address that actually received the message, extracted from delivery headers (`Delivered-To`, `X-Original-To`, or inferred from `Received` headers). This is the user's actual address, including `+tag` variants and catch-all matches.

This answers: **"Which of my addresses was this sent to?"**

Useful for rules like "anything delivered to `mike+github@example.com` goes to Projects" or "anything to `mike+lists@example.com` routes to Review." Even if a mailing list rewrites the To field, the envelope recipient preserves which address is subscribed to that list.

### Header Visibility

Where the user's address appears (or doesn't) in the message's To and CC headers. Categories:

- **Direct** — user's address is in the To field
- **CC** — user's address is in the CC field
- **BCC/undisclosed** — user's address doesn't appear in To or CC (likely BCC or envelope-only delivery)
- **List** — message has List-Id or similar mailing list headers

This answers: **"Was I directly addressed, copied, or is this list traffic?"**

Useful as a routing signal: direct-addressed messages are more likely to need individual attention than CC'd messages, which are more likely than list traffic. A rule can use header visibility as one of its match criteria.

### These Are Orthogonal

A message can be delivered to `mike+mountaineers@example.com` (envelope recipient) while the To field shows `members@mountaineers.org` (header visibility = list). Rules should be able to match on either independently. The envelope recipient tells you *which identity* received the message; header visibility tells you *how prominently you were addressed*.

---

## Automation Behavior

### Arrival-Time Routing

When a new message arrives, the system evaluates it against the rule set and takes one of the following actions:

1. **Auto-archive:** High-confidence matches (known mailing lists, receipts, notifications, matching clear sender/header patterns) go directly to the appropriate category folder, bypassing both inbox and Review.
2. **Route to Review:** Messages that are informational but not junk — newsletters, mailing list posts, notifications from services you use, promotional email from legitimate senders. The user has not seen these; they arrive unread.
3. **Leave in Inbox:** Messages matching an inbox-pinning rule (priority senders, specific envelope recipients), plus everything that doesn't match any rule. The inbox is the default.
4. **Delete:** Messages matching a delete rule (blocked senders, known junk patterns). Moved to Trash.

### Periodic Sweeps

- **Review cleanup:** Sweep read items older than ~1 week and unread items older than ~2 weeks from Review to archive.
- **Optional digest:** Before sweeping, surface a summary of items about to age out, giving the user one last chance to act.

### Retroactive Application (Future)

When creating or editing a rule, the user can optionally apply it to existing messages in a specified folder. This is a one-shot batch operation, not a change to ongoing monitoring. Useful when a new rule would catch hundreds of messages already sitting in Inbox or Review.

---

## Learning from User Behavior

The system monitors user-initiated message moves to learn routing preferences over time.

### Tracked Signals

For each user-initiated move, the system logs:

- **Sender** (From address)
- **Envelope recipient** (the user's address that received it, including +tag variants)
- **Mailing list headers** (List-ID, List-Post, etc.)
- **Subject line**
- **Read status** at time of move (read vs. unread)
- **Header visibility** (Direct, CC, BCC, or List)
- **Source folder** (where the message was)
- **Destination folder** (where the user moved it)

### Learning Mechanics

The system performs statistical analysis on logged moves to identify patterns and generate routing rules.

- **Inbox to Review pattern:** If the user repeatedly moves messages from a particular sender or mailing list from Inbox to Review, the system should propose a rule to auto-route those to Review. Example: after 5 moves of emails from `noreply@example.com` to Review, propose a rule.
- **Inbox/Review to specific archive folder:** Repeated moves to the same archive folder train direct filing rules.
- **Review to Inbox:** If the user repeatedly pulls a sender's messages back from Review to Inbox, the system should propose an inbox-pinning rule for that sender.

### Proposed Rules

Rather than silently changing behavior, the system surfaces learned patterns as proposed rules: _"You've moved 8 emails from noreply@rei.com to Review — want me to do this automatically?"_ The user confirms, modifies, or dismisses, and confirmed proposals become permanent rules.

This approach fails gracefully. A bad guess just means something lands in the wrong stream, and the user's correction generates more training data.

---

## Technical Context

- **Runtime:** Node.js / TypeScript
- **Protocol:** IMAP client running in the background
- **Primary mail server:** Fastmail (with potential Gmail instance later)
- **User's mail client:** Mac Mail (read-only interaction; the automation system has its own management UI)
- **Constraint:** Mac Mail does not support tags or labels, only folders and colored flags. The system is designed entirely around folders.
- **Message modification:** Not used. The system does not alter message headers or subject lines. Organization is achieved solely through folder placement.

---

## Summary of Email Lifecycle

```
New mail arrives
    │
    ├─ Matches archive rule? ───→ Auto-archive to category folder
    │
    ├─ Matches review rule? ────→ Review folder (unread)
    │                               │
    │                               ├─ User batch-processes ──→ Read + ~1 week ──→ Auto-archive
    │                               ├─ User pulls to inbox ──→ Treat as action item
    │                               └─ Never processed ──→ ~2 weeks ──→ Auto-archive
    │
    ├─ Matches delete rule? ────→ Trash
    │
    └─ No matching rule ────────→ Inbox (default)
                                    │
                                    ├─ User acts on it
                                    ├─ User archives manually ──→ System learns
                                    └─ User moves to Review ────→ System learns
```
