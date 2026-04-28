---
id: UC-001
title: Manual move creates proposed rule, which auto-files future messages after approval
acceptance-test: test/acceptance/uc_001_manual_move_to_rule_to_auto_filing.test.ts
starting-states: []
integrations: [IX-001, IX-002, IX-003, IX-004, IX-005, IX-006]
---

## Actors

- **User** — the mailbox owner, interacting via the mail-mgr web UI and their mail client (IMAP).
- **Mail-mgr** — the background system (IMAP monitor, MoveTracker, PatternDetector, ReviewSweeper).
- **Mail server** — the upstream IMAP server (e.g., Fastmail, Gmail).

## Preconditions

- Mail-mgr is running and connected to the IMAP server via IDLE (or polling fallback).
- No existing rules match the sender used in this scenario.
- No existing proposals exist for this sender.
- The Review folder exists and sweep is enabled with `readMaxAgeDays: 7`.
- The user has a destination folder (e.g., "Newsletters") already created.

## Main Flow

### Phase 1: First message arrives, user manually moves it

1. An email arrives in INBOX from `digest@example.com` with subject "Weekly Digest #42".
2. Mail-mgr detects the new message via IDLE `newMail` event.
3. Mail-mgr evaluates the message against all rules — no rule matches.
4. The message remains in INBOX (default behavior when no rule matches).
5. The user, via their mail client, manually moves the message from INBOX to the "Newsletters" folder.

### Phase 2: System detects the user move and creates a proposal

6. MoveTracker's next scan detects the message is missing from INBOX.
7. On the *following* scan (two-scan confirmation), MoveTracker confirms the disappearance is not transient.
8. DestinationResolver cross-references the activity log to confirm this was NOT a system-initiated move.
9. DestinationResolver identifies "Newsletters" as the destination (via mailbox scan or deep scan fallback).
10. PatternDetector receives the move signal and creates (or updates) a proposal in ProposalStore:
    - Sender: `digest@example.com`
    - Destination: "Newsletters"
    - Match count: 1
    - Status: `active`

### Phase 3: User approves the proposed rule

11. The user opens the mail-mgr web UI and navigates to proposed rules.
12. The UI displays the proposal for `digest@example.com` → "Newsletters" (labeled "Weak" with 1 match).
13. The user clicks "Approve" on the proposal.
14. Backend checks for conflicts with existing rules — none found.
15. A new rule is created:
    - Match: `{ sender: "digest@example.com" }`
    - Action: `{ type: "move", folder: "Newsletters" }`
    - Order: assigned as next available
16. The proposal status is set to `approved`.

### Phase 4: Second message arrives and is auto-filed to Review

17. A new email arrives in INBOX from `digest@example.com` with subject "Weekly Digest #43".
18. Mail-mgr detects the new message via IDLE `newMail` event.
19. Mail-mgr evaluates the message against rules — the newly created rule matches.
20. The rule action is `move` to "Newsletters", so the message is moved to "Newsletters".
21. The activity log records the move with source `arrival`, the matched rule ID, and destination "Newsletters".

### Phase 5: User reads the message

22. The user reads "Weekly Digest #43" in the "Newsletters" folder via their mail client.
23. The message's `\Seen` flag is set on the IMAP server.

## Expected Outcome

- Two messages from `digest@example.com` exist in the "Newsletters" folder.
- The first was moved manually by the user; the second was moved automatically by the approved rule.
- The activity log contains an entry for the automatic move (phase 4) with the rule name and destination.
- The proposal for `digest@example.com` has status `approved`.
- The rule is active and will match all future messages from this sender.

## Variants

### UC-001.a: User move detected via deep scan

Same as main flow, but in step 9 DestinationResolver cannot determine the destination on the first attempt (e.g., message was moved to a folder not in the current scan set). The resolution is deferred to the deep scan (15-minute interval), which scans all mailboxes to locate the message and resolve the destination.

### UC-001.b: Proposal approval with shadow conflict

Same as main flow through step 12, but an existing rule with a broader sender pattern (e.g., `*@example.com`) already matches this sender at higher priority. The approval attempt in step 14 is blocked with a shadow conflict error. The user must provide an `insertBefore` parameter to position the new rule above the conflicting one, causing the conflicting rule (and those above it) to shift order by +1.

### UC-001.c: Rule matches but message is in Review folder with sweep

Alternative to phase 4: instead of a `move` action, the approved rule has action `review`. The second message is moved to the Review folder. After 7 days (readMaxAgeDays) with the `\Seen` flag set, ReviewSweeper picks it up, re-evaluates rules, and moves it to the configured folder.

### UC-001.d: Multiple moves strengthen proposal before approval

Before phase 3, the user receives and manually moves 3 more messages from the same sender to "Newsletters". Each move increments the proposal's match count. By the time the user visits the UI, the proposal shows 4 matches and is labeled "Strong", giving higher confidence in the suggested rule.
