---
id: UC-002
title: Dragging a message into an action folder creates or removes a sender rule
acceptance-test: test/acceptance/uc_002_action_folder_drag_creates_or_removes_rule.test.ts
starting-states: []
integrations: [IX-001, IX-002, IX-007, IX-008]
---

## Actors

- **User** — the mailbox owner, interacting via their mail client (IMAP) to drag messages into action folders.
- **Mail-mgr** — the background system (ActionFolderPoller, ActionFolderProcessor, ConfigRepository, ActivityLog, ImapClient).
- **Mail server** — the upstream IMAP server (e.g., Fastmail, Gmail).

## Preconditions

- Mail-mgr is running and connected to the IMAP server.
- The four action folders exist under the configured prefix (e.g., `mail-mgr/VIP`, `mail-mgr/Block`, `mail-mgr/Undo VIP`, `mail-mgr/Unblock`) and contain a sentinel message each.
- Action folder polling is enabled with the default 15-second interval.
- The trash folder and INBOX are configured.
- No existing rule matches the sender used in this scenario.

## Main Flow

### Phase 1: User drags a message into the VIP folder

1. An email from `priority@example.com` exists in the INBOX (or any other folder accessible to the user's mail client).
2. The user, via their mail client, drags the message from its current folder into the `mail-mgr/VIP` action folder.
3. Within at most one poll interval, ActionFolderPoller runs its scheduled scan and queries the message count for `mail-mgr/VIP`.
4. The poller observes a count greater than one (the sentinel plus the user's message), fetches all messages in the folder, and hands each non-sentinel message to ActionFolderProcessor with `actionType: 'vip'`.

### Phase 2: System extracts the sender, creates a rule, and re-files the message

5. ActionFolderProcessor checks the message against SentinelDetector — it is not a sentinel, processing continues.
6. The processor extracts the sender address from the `From` header and normalizes it to a lowercase bare email (`priority@example.com`).
7. The processor queries ConfigRepository for current rules and confirms no existing sender-only `delete` rule exists for this sender (no Block conflict).
8. The processor calls `ConfigRepository.addRule()` with:
    - Match: `{ sender: "priority@example.com" }`
    - Action: `{ type: "skip" }`
    - Name: `"VIP: priority@example.com"`
    - Order: next available
    - Enabled: true
9. The processor moves the message from `mail-mgr/VIP` to INBOX via `ImapClient.moveMessage()`.
10. The processor writes an activity log entry with `source: "action-folder"`, the new rule's ID, and the destination INBOX.

### Phase 3: A future message from the same sender bypasses review

11. A new email arrives in INBOX from `priority@example.com`.
12. Mail-mgr detects the new message via IDLE `newMail` event.
13. Mail-mgr evaluates the message against rules — the newly created VIP rule matches.
14. The rule action is `skip`, so the message remains in INBOX (no move performed).
15. The activity log records the evaluation with `action: "skip"` and the matched rule ID.

## Expected Outcome

- A sender-only `skip` rule for `priority@example.com` exists in the configuration.
- The message dragged in Phase 1 is back in INBOX (not in the VIP folder).
- The action folder `mail-mgr/VIP` contains only its sentinel.
- The activity log contains a Phase 2 entry with source `action-folder` and the newly created rule's ID.
- The activity log contains a Phase 3 entry recording the rule's match against the second message.
- Subsequent messages from `priority@example.com` are not affected by other rules that would otherwise move or delete them.

## Variants

### UC-002.a: Block folder creates a delete rule and trashes the message

Same overall shape as the main flow, but the user drags the message into `mail-mgr/Block`. The processor uses `actionType: 'block'`, creates a sender-only rule with action `{ type: "delete" }` named `"Block: <sender>"`, and moves the dragged message to the configured trash folder (not INBOX). Future messages from that sender are deleted on arrival rather than skipped.

### UC-002.b: Undo-VIP folder removes the existing skip rule

Preconditions: a sender-only `skip` rule already exists for `priority@example.com` (from a prior run of the main flow). The user drags any message from that sender into `mail-mgr/Undo VIP`. The processor uses `actionType: 'undoVip'`, locates the existing skip rule via `findSenderRule()`, deletes it via `ConfigRepository.deleteRule()`, and moves the message to INBOX. The activity log records a removal entry. Subsequent messages from that sender no longer match the deleted rule.

### UC-002.c: Unblock folder removes the existing delete rule

Mirror of UC-002.b for the Block side. Preconditions: a sender-only `delete` rule already exists for `blocked@example.com`. The user drags a message from that sender into `mail-mgr/Unblock`. The processor uses `actionType: 'unblock'`, locates the delete rule, deletes it, and moves the message to INBOX. Subsequent messages from that sender are no longer deleted on arrival.

### UC-002.d: VIP drag with an existing Block rule swaps the rule

Preconditions: a sender-only `delete` rule exists for `flipflop@example.com` (i.e., the sender was previously blocked). The user drags a message from that sender into `mail-mgr/VIP`. The processor detects the conflicting opposite-action rule, deletes the existing `delete` rule, then creates the new `skip` rule. Two activity log entries are written — one for the removal, one for the creation — both with source `action-folder`. The dragged message is moved to INBOX. The reverse case (dragging into Block while an existing skip rule exists) behaves symmetrically: the skip rule is removed and a delete rule is created in its place.

### UC-002.e: Multi-field rule for the same sender is preserved

Preconditions: a multi-field rule already exists for `priority@example.com` matching, e.g., `{ sender: "priority@example.com", subject: "*invoice*" }` with action `move` to a specific folder. The user drags a different message from the same sender into `mail-mgr/VIP`. The processor uses `isSenderOnly()` to determine the existing rule is not sender-only and therefore not a conflict. The new sender-only `skip` rule is appended after the existing rule in evaluation order. Future invoice messages from the sender continue to be moved by the multi-field rule (higher priority); other messages match the new VIP rule and skip.

### UC-002.f: Unparseable From address is recovered to INBOX

The user drags a message into any action folder, but the `From` header on the message cannot be parsed into a valid email (missing `@`, malformed envelope, etc.). The processor extracts a null sender, logs an error, moves the message to INBOX without creating or removing any rule, and returns an error result. No activity log entry tied to a rule is written. The action folder is left clean (only the sentinel remains).

### UC-002.g: Remove operation when no matching rule exists

The user drags a message into `mail-mgr/Undo VIP` (or `mail-mgr/Unblock`) for a sender that has no existing skip (or delete) rule. The processor finds no rule via `findSenderRule()`, performs no rule mutation, moves the message to INBOX anyway, and returns success. No rule activity is logged but the folder is cleared.
