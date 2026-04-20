# PRD: v0.6 Action Folders

**Manage sender dispositions from the mail client.** Action folders let the user create and remove common routing rules by moving messages to special IMAP folders, without switching to the web UI. The resulting rules are standard rules — they appear in the normal rule list and the sender disposition views (v0.5) identically to rules created through the web interface.

---

## Problem

The web UI is the only way to manage sender rules today. For the most common operations — VIP a sender, block a sender, undo either — the user must context-switch out of their mail client, open the web UI, and perform the action there. This friction discourages frequent rule management, especially for quick reactions while triaging email ("I never want to see this sender again" or "always keep this sender in my inbox").

The mail client already supports the one gesture the user needs: moving a message to a folder. Action folders turn that gesture into rule management.

---

## Requirements

### AF-01: Action Folder Set

The system creates and monitors four folders under an `Actions/` prefix in the IMAP mailbox:

| Folder | Effect on Rules | Message Destination |
|--------|----------------|-------------------|
| `Actions/VIP Sender` | Creates a sender-only `skip` rule (leave in inbox) for the message's From address | Moved to INBOX |
| `Actions/Block Sender` | Creates a sender-only `delete` rule for the message's From address | Moved to Trash |
| `Actions/Undo VIP` | Removes any sender-only `skip` rule matching the message's From address | Moved to INBOX |
| `Actions/Unblock Sender` | Removes any sender-only `delete` rule matching the message's From address | Moved to INBOX |

**Duplicate prevention:** If a rule already exists for the target sender with the matching action type, no duplicate is created. The message is still moved to its destination.

**No matching rule (undo operations):** If `Undo VIP` or `Unblock Sender` finds no matching rule to remove, the message is still moved to its destination. This is not an error.

**Conflicting rules:** If a sender-only rule of a different type already exists for the same sender (e.g., a `delete` rule when the user VIP-s the sender), the conflicting rule is removed and the new rule is created. Both the removal and creation are logged to activity. If a more specific rule exists for the same sender (matching on additional fields beyond sender), it is preserved and the action folder rule is appended after it in the rule list.

### AF-02: Folder Lifecycle

- The system creates the `Actions/` folder hierarchy on startup if the folders don't exist. This is an exception to the general principle that the app doesn't create folders — action folders are system-managed infrastructure, not user-managed taxonomy.
- Action folders must always be empty after processing. The system processes messages on the next poll/IDLE cycle and moves them to their final destination.
- If the system restarts while messages are sitting in action folders, it processes them on startup before entering the normal monitoring loop.

### AF-03: Sender Extraction

The sender is extracted from the message's From header, normalized to a bare email address (lowercase, no display name). This becomes the `match.sender` value for any created rule.

**Error case:** If a message in an action folder has no parseable From address (malformed or missing), log an error and move the message to INBOX. Do not silently drop the message or leave it in the action folder.

### AF-04: Activity Logging

Every action folder operation is logged to the activity table with:

- `source` = `'action-folder'` (new source value, distinct from `'arrival'`, `'sweep'`, `'batch'`)
- `action` = the rule action type (`'skip'`, `'delete'`) or a descriptive value for undo operations
- `rule_id` / `rule_name` = the rule that was created or removed
- Standard message fields (uid, message_id, from, to, subject)

The activity log entry must make it clear this was triggered by an action folder operation, not a manual rule edit or arrival routing.

### AF-05: Monitoring Integration

Action folders are monitored alongside INBOX and Review. This extends the multi-folder monitoring from v0.2.

- Action folder processing takes priority over regular arrival routing — the user is explicitly requesting an action.
- The monitor must handle messages appearing in action folders via IDLE notification or poll cycle, same as INBOX arrivals.
- Action folder processing must not interfere with or delay normal INBOX/Review monitoring.

### AF-06: Rule Validation

Rules created via action folders must pass the same Zod validation as rules created through the web UI or config file. Specifically:

- The sender glob must be valid (non-empty string).
- The rule must have a unique ID (UUID, same as web UI).
- The rule is appended at the end of the rule list (highest order value + 1).
- `name` is optional. If set, use a descriptive name like `"VIP: sender@example.com"` or `"Block: sender@example.com"`.

If validation fails (e.g., somehow an empty sender), log the error and move the message to INBOX.

### AF-07: Idempotent Processing

Action folder processing must be idempotent:

- Processing the same message twice must not create duplicate rules.
- If the system crashes mid-processing (after rule creation but before message move), reprocessing on restart must detect the existing rule and skip creation.
- Duplicate detection: check for an existing enabled sender-only rule with the same sender glob and same action type before creating.

### AF-08: UI Integration

No new UI views are required. Action folder operations surface through existing mechanisms:

- **Activity log:** Action folder entries appear with their distinct source, filterable alongside arrival/sweep/batch entries.
- **Disposition views:** Rules created via action folders appear in Priority Senders, Blocked Senders, etc. — because they are standard sender-only rules.
- **Rule list:** Rules created via action folders appear in the main rule list, editable like any other rule.

---

## Technical Design Notes

These are architectural observations to inform implementation planning, not prescriptive design.

### Folder Creation

The system currently discovers folders but never creates them (`Key insight` in PROJECT.md). Action folders are an intentional exception — they're system infrastructure analogous to the Review folder, not user taxonomy. The IMAP client's `mailboxCreate` (imapflow) or equivalent should handle this on startup.

### Monitoring Architecture

The current monitor watches INBOX via IDLE. The MoveTracker polls INBOX + Review for UID changes. Action folder monitoring could follow either pattern:

- **Option A: Extend the monitor's IDLE/poll loop** to include `Actions/*` folders. Processes action folder messages with higher priority before regular arrival routing.
- **Option B: Dedicated action folder poller** that runs on a shorter interval than MoveTracker, since responsiveness matters more here.
- **Option C: Piggyback on MoveTracker's scan cycle** with a pre-check for action folder contents.

The implementation should optimize for responsiveness — the user expects near-immediate feedback when they move a message to an action folder.

### Sender-Only Rule Utilities

The `isSenderOnly()` predicate from `dispositions.ts` and the disposition query API already handle filtering rules by type. Action folder processing needs the inverse: given a sender address and action type, find an existing matching rule. This is a query the disposition routes already perform implicitly.

### Action Folder Configuration

The `Actions/` prefix and folder names should be configurable (with sensible defaults) to support:

- IMAP servers with different hierarchy separators (`.` vs `/`)
- Users who want different folder names
- Localization (future)

Add to the config schema under a new `actionFolders` section, defaulting to:

```yaml
actionFolders:
  enabled: true
  prefix: "Actions"
  folders:
    vip: "VIP Sender"
    block: "Block Sender"
    undoVip: "Undo VIP"
    unblock: "Unblock Sender"
```

### Extensibility

The action folder pattern should be designed as a registry of action types, where each entry defines:

- Folder name (under the prefix)
- Processing function (given a message, what rule operation to perform)
- Message destination (where to move the message after processing)

This makes adding future action types (e.g., `Actions/Route to Review`, `Actions/File to [Folder]`) a matter of registering a new entry, not modifying processing logic.

---

## Out of Scope

- **Nested action folders** (e.g., `Actions/File to/Projects/`) — future extension, not this milestone.
- **Bulk action folder operations** — action folders process one message = one rule. Bulk sender management stays in the web UI.
- **Action folder for non-sender rules** — only sender-only dispositions. Complex rules require the web UI.
- **IMAP NOTIFY extension** for instant action folder detection — standard IDLE/poll is sufficient.
- **Undo/redo for action folder operations** — the user can undo via the complementary action folder (Undo VIP) or the web UI.

---

## Success Criteria

1. Moving a message to `Actions/VIP Sender` creates a working skip rule for that sender within one poll cycle, and the message disappears from the action folder.
2. Moving a message to `Actions/Block Sender` creates a working delete rule and the message lands in Trash.
3. Undo operations remove the correct rule and move the message to the expected destination.
4. Rules created via action folders are indistinguishable from web UI rules in the rule list and disposition views.
5. Activity log clearly shows action folder operations with enough detail to audit what happened.
6. The system handles restart-with-pending-messages, duplicate sender, missing From header, and invalid sender gracefully.
7. Action folders are created automatically on startup and remain empty after processing.
