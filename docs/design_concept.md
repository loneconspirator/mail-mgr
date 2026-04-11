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

The inbox contains only messages that probably warrant individual attention: personal messages, things addressed specifically to you, messages from important contacts, and anything the system isn't confident enough to divert. This is the "act soon" queue. No separate folder is needed for urgency — if it's in the inbox, it matters now.

### Stream 2: Review (Batch Processing)

The Review folder is a lower-priority intake stream. It receives messages that deserve a glance but don't warrant individual attention: newsletters you sometimes read, mailing list traffic, notifications, promotional messages from companies you actually use, FYI-type messages.

These arrive unread and are processed in bulk a couple of times a week. The user scans the folder, acts on anything that warrants it (pulling it back to the inbox if needed), and moves on. This is the key quality-of-life feature — it dramatically reduces inbox volume without losing visibility into lower-priority mail.

### Review Lifecycle

Nothing lives in Review permanently. The automation enforces this:

- **Read items older than ~1 week** are automatically archived to the appropriate category folder (defaulting to Mailing Lists unless other rules match).
- **Unread items older than ~2 weeks** are also swept to archive. If you haven't batch-processed them in two weeks, you're not going to.

This eliminates the common failure mode where the review/deferral folder becomes a graveyard. There is no "someday/maybe" folder. Something either matters enough to pull back to the inbox, or it ages out into the archive.

### Other Dispositions

- **Sheer junk:** Deleted immediately by the automation. Never reaches inbox or Review.
- **Amusing scams:** Archived to a designated reference folder.

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

## Automation Behavior

### Arrival-Time Routing

When a new message arrives, the system evaluates it and takes one of the following actions:

1. **Auto-archive:** High-confidence matches (known mailing lists, receipts, notifications, matching clear sender/header patterns) go directly to the appropriate category folder, bypassing both inbox and Review.
2. **Route to Review:** Messages that are informational but not junk — newsletters, mailing list posts, notifications from services you use, promotional email from legitimate senders. The user has not seen these; they arrive unread.
3. **Leave in Inbox:** Everything the system isn't confident about, plus messages that match high-priority signals (direct personal messages, important contacts, messages where the user is in the To field rather than CC/BCC).

The system should start conservative — leave more in the inbox than necessary, and expand auto-routing coverage over time as confidence grows.

### Periodic Sweeps

- **Review cleanup:** Sweep read items older than 1 week and unread items older than 2 weeks from Review to archive.
- **Optional digest:** Before sweeping, surface a summary of items about to age out of Review, giving the user one last chance to act.

---

## Learning from User Behavior

The system monitors user-initiated message moves to learn routing preferences over time.

### Tracked Signals

For each user-initiated move, the system logs:

- **Sender** (From address)
- **Recipient** (the user's address that received it)
- **Mailing list headers** (List-ID, List-Post, etc.)
- **Subject line**
- **Read status** at time of move (read vs. unread)
- **Position of user's address** (To, CC, BCC, or not present)
- **Source folder** (where the message was)
- **Destination folder** (where the user moved it)

### Learning Mechanics

The system performs statistical analysis on logged moves to identify patterns and generate routing rules.

- **Inbox → Review pattern:** If the user repeatedly moves messages from a particular sender or mailing list from Inbox to Review, the system should begin auto-routing those to Review. Example: after 5 moves of emails from `noreply@example.com` to Review, propose a rule.
- **Inbox/Review → specific archive folder:** Repeated moves to the same archive folder train direct filing rules.
- **Review → Inbox:** If the user repeatedly pulls a sender's messages back from Review to Inbox, that sender should be promoted to inbox delivery.

### Proposed Rules

Rather than silently changing behavior, the system should surface learned patterns as proposed rules: _"You've moved 8 emails from noreply@rei.com to Review — want me to do this automatically?"_ The user confirms, and it becomes a permanent rule.

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
    ├─ High-confidence match? ──→ Auto-archive to category folder
    │
    ├─ Informational / bulk? ───→ Review folder (unread)
    │                               │
    │                               ├─ User batch-processes ──→ Read + 1 week ──→ Auto-archive
    │                               ├─ User pulls to inbox ──→ Treat as action item
    │                               └─ Never processed ──→ 2 weeks ──→ Auto-archive
    │
    ├─ Junk? ───────────────────→ Delete
    │
    └─ Everything else ─────────→ Inbox
                                    │
                                    ├─ User acts on it
                                    ├─ User archives manually
                                    └─ User moves to Review (trains the system)
```