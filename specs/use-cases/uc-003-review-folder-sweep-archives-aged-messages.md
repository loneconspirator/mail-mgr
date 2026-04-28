---
id: UC-003
title: Review folder sweep archives aged messages by re-evaluating rules
acceptance-test: test/acceptance/uc_003_review_folder_sweep_archives_aged_messages.test.ts
starting-states: []
integrations: [IX-001, IX-002, IX-006]
---

## Actors

- **User** — the mailbox owner, who reads messages routed into the Review folder via their mail client.
- **Mail-mgr** — the background system (Monitor, ActionExecutor, ReviewSweeper, RuleEvaluator, ImapClient, ActivityLog).
- **Mail server** — the upstream IMAP server (e.g., Fastmail, Gmail).

## Preconditions

- Mail-mgr is running and connected to the IMAP server via IDLE (or polling fallback).
- The Review folder exists, is configured (`reviewConfig.folder`), and contains its sentinel.
- Sweep is enabled with `readMaxAgeDays: 7`, `unreadMaxAgeDays: 14`, `intervalHours: 6`, and `defaultArchiveFolder: "MailingLists"` (defaults).
- A rule exists with `match: { sender: "newsletter@example.com" }` and `action: { type: "review" }` (no folder override) — i.e., file to the configured Review folder.
- A rule exists with `match: { sender: "newsletter@example.com" }` and `action: { type: "move", folder: "Newsletters" }` placed *after* the review-action rule, used by the sweep destination resolver. (Equivalent setup: a single `review` rule with `folder: "Newsletters"` and `defaultArchiveFolder` as backstop — see UC-003.b.)

## Main Flow

### Phase 1: Message arrives and is filed to Review

1. An email arrives in INBOX from `newsletter@example.com` with subject "Issue #1".
2. Mail-mgr detects the new message via IDLE `newMail` event (IX-001).
3. RuleEvaluator returns the first matching rule — the `review` action rule.
4. ActionExecutor moves the message to the Review folder (IX-002), auto-creating it if missing.
5. ActivityLog records the move with source `arrival`, the matched rule ID, and destination = Review folder.

### Phase 2: User reads the message in Review

6. The user opens the Review folder in their mail client and reads "Issue #1".
7. The mail client sets the `\Seen` flag on the IMAP server. The message remains in the Review folder.

### Phase 3: Time passes; the sweep timer fires

8. Seven or more days pass since the message's `internalDate`.
9. ReviewSweeper's interval timer fires (IX-006).
10. ReviewSweeper checks `client.state === 'connected'` and a `running` guard, then calls `client.fetchAllMessages(reviewFolder)`.
11. For each fetched message, ReviewSweeper:
    - Skips sentinel messages via SentinelDetector.
    - Evaluates `isEligibleForSweep` against the message's age and read status. Read messages older than `readMaxAgeDays` are eligible.
12. "Issue #1" is read and seven days old, so it is eligible.

### Phase 4: Sweep re-evaluates rules and archives the message

13. `resolveSweepDestination` evaluates the sweep-filtered rule set (excluding `skip` rules and bare `review` rules) against the message.
14. The first eligible rule matches: the `move` rule for the same sender to "Newsletters".
15. ImapClient moves the message from the Review folder to "Newsletters".
16. ActivityLog records the archive with source `sweep`, the matched rule ID, and destination "Newsletters".
17. ReviewSweeper restores INBOX and re-arms IDLE (INV-001), updates `sweepState.lastSweep` (`completedAt`, `messagesArchived: 1`, `errors: 0`) and recomputes `nextSweepAt`.

## Expected Outcome

- "Issue #1" is in the "Newsletters" folder.
- The Review folder is empty of non-sentinel messages older than the threshold.
- The activity log contains:
    - A Phase 1 entry with `source: arrival` and destination = Review folder.
    - A Phase 4 entry with `source: sweep`, the `move` rule's ID, and destination "Newsletters".
- `sweepState.lastSweep.messagesArchived === 1`.
- IMAP connection is back on INBOX with IDLE re-armed.

## Variants

### UC-003.a: Unread message survives the read threshold

Same as the main flow through Phase 1, but the user never opens the message in Phase 2 (no `\Seen` flag set). At Phase 3, seven days have passed but the unread threshold is fourteen. `isEligibleForSweep` returns `false`; the message is skipped this cycle and remains in the Review folder. After fourteen days, a subsequent sweep cycle marks it eligible and Phase 4 proceeds normally.

### UC-003.b: No matching rule falls back to defaultArchiveFolder

Same as the main flow, but in Phase 4 step 13 `resolveSweepDestination` finds no matching rule (the user removed the `move` rule between filing and sweep). The destination resolver returns `{ type: 'move', folder: defaultArchiveFolder }` with `matchedRule: null`. The message is moved to `MailingLists`, and the activity log records the move with an empty rule reference.

### UC-003.c: Sweep rule is `delete`

Same as the main flow, but the second rule for this sender has `action: { type: "delete" }`. In Phase 4 step 14, `resolveSweepDestination` returns `{ type: 'delete' }`. ImapClient moves the message to the configured `trashFolder` instead of an archive folder, and the activity log records `action: delete`.

### UC-003.d: Config change triggers sweeper restart mid-cycle

The user changes `readMaxAgeDays` via `PUT /api/config/review` between two scheduled sweeps. ConfigRepository fires the `reviewConfigChange` listener, which restarts the sweeper. The sweeper's `restart()` clears its timers and re-arms with the updated thresholds; the new threshold is in effect for the next sweep tick. No in-flight sweep is interrupted.

### UC-003.e: Skip rule and bare review rule are excluded from sweep evaluation

Preconditions add a higher-priority `skip` rule and a higher-priority `review` rule (no `folder`) for the same sender. In Phase 4 step 13, both are filtered out of the sweep candidate set before evaluation. The lower-priority `move` rule wins. Without this filter the message would either stay in Review forever (skip) or be moved into the same Review folder it came from (bare review).

### UC-003.f: Sweep tick during disconnect is skipped, not failed

If at Phase 3 step 10 `client.state !== 'connected'`, ReviewSweeper logs and returns immediately without modifying `sweepState.lastSweep`. INV-001 is trivially satisfied (the connection was never taken). The next scheduled tick retries.

### UC-003.g: Concurrent sweep request is dropped

If `runSweep()` is invoked while a previous sweep is still running (interval fires before the prior cycle completes, or a manual trigger races the timer), the new invocation logs and returns without acting. The in-flight sweep proceeds to completion uninterrupted.
