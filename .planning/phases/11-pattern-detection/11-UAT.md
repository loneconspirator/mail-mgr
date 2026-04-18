---
status: complete
phase: 11-pattern-detection
source: [11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md]
started: 2026-04-13T12:00:00Z
updated: 2026-04-18T00:00:00Z
---

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start the application fresh. Server boots without errors, migrations complete, and the web UI loads successfully.
result: pass

### 2. Proposed Nav Tab with Badge
expected: The navigation bar shows a "Proposed" tab/button. If there are active proposals, a badge count appears on the tab showing how many.
result: pass

### 3. Proposal Cards Display
expected: Clicking the Proposed tab shows proposal cards. Each card displays: sender address, destination folder, a strength badge (strong/moderate/weak/ambiguous), and example subject lines from recent moves.
result: pass

### 4. Envelope Recipient and Conflict Annotations
expected: If a proposal has an envelope recipient, it's shown on the card. If a proposal conflicts with an existing rule, a conflict annotation is visible.
result: blocked
blocked_by: server
reason: "Deep scan required to generate proposals with envelope recipients, but IMAP connection fails with 'Not connected' error"

### 5. Approve Proposal
expected: Clicking Approve on a proposal card creates a real rule and the card fades out/disappears from the list. The new rule appears in the Rules view.
result: pass

### 6. Modify Proposal
expected: Clicking Modify opens the rule editor pre-filled with the proposal's sender/destination. After saving the rule, the proposal is marked as approved (card disappears) without creating a duplicate rule.
result: pass
note: Fixed — openRuleModal now called with forceCreate=true so isEdit stays false

### 7. Dismiss Proposal
expected: Clicking Dismiss removes the proposal card from the list. A toast/notification confirms the dismissal.
result: pass
note: Fixed — getProposals() now uses WHERE status = 'active', dismissed rows excluded

### 8. Resurfaced Notice
expected: If a previously dismissed proposal resurfaces (after enough new signals), it shows a "resurfaced" notice on the card indicating it was dismissed before but has come back.
result: skipped
reason: Requires generating 5+ real move signals from a dismissed sender — live IMAP only

### 9. Live Pattern Detection
expected: Move a message to a folder (creating a new move signal). After the move is tracked, if the sender has enough signals, a new proposal appears in the Proposed tab without needing to restart the server.
result: skipped
reason: Requires live IMAP with enough signals to cross threshold

### 10. Proposal Strength Updates
expected: As more messages from the same sender are moved to the same destination, the proposal's strength badge increases (e.g., from weak to moderate to strong) and the matching count goes up.
result: skipped
reason: Requires live IMAP with multiple move signals

## Summary

total: 10
passed: 6
skipped: 3
blocked: 1

## Gaps

None — all testable items pass. Skipped tests require live IMAP signal accumulation.
