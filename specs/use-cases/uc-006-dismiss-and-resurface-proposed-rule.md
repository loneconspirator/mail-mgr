---
id: UC-006
title: User dismisses a proposed rule, which auto-resurfaces after five new moves
acceptance-test: test/acceptance/uc_006_dismiss_and_resurface_proposed_rule.test.ts
starting-states: []
integrations: [IX-003, IX-004, IX-012]
---

## Actors

- **User** — the mailbox owner, interacting with the mail-mgr web UI to triage proposed rules and continuing to manually move messages in their mail client.
- **Mail-mgr** — the background system (MoveTracker, DestinationResolver, PatternDetector, ProposalStore, WebServer).
- **Mail server** — the upstream IMAP server.

## Preconditions

- Mail-mgr is running and connected to the IMAP server.
- MoveTracker is enabled and watching INBOX (and any other tracked folders).
- A proposal P1 exists in ProposalStore with:
    - `sender: "weekly@example.com"`, `envelopeRecipient: null`, `sourceFolder: "INBOX"`, `destinationFolder: "Newsletters"`.
    - `status: 'active'`, `matchingCount: 2`, `contradictingCount: 0`, `signalsSinceDismiss: 0`.
- No rule yet exists for this sender (i.e., the user has not approved the proposal — consistent with UC-001's pre-approval state).

## Main Flow

### Phase 1: User dismisses the proposal

1. The user opens the proposed rules page in the web UI. P1 is rendered as a card with strength label "Moderate pattern (2 moves)".
2. The user decides not to automate this sender (e.g., they want to keep eyeballing it) and clicks "Dismiss".
3. The browser sends `POST /api/proposed-rules/{P1.id}/dismiss`.
4. WebServer calls `ProposalStore.dismissProposal(id)`, which sets `status: 'dismissed'`, `dismissed_at` to the current timestamp, and resets `signals_since_dismiss` to 0.
5. WebServer responds 204. On the next list fetch, P1 is excluded from `getProposals()` (the active list).

### Phase 2: User keeps manually moving messages from the same sender

6. New emails from `weekly@example.com` arrive over the next several days. The user manually moves each one to "Newsletters" via their mail client.
7. For each move, MoveTracker's two-scan protocol confirms the disappearance from INBOX, DestinationResolver locates the message in "Newsletters" (IX-003), and SignalStore records a move signal.
8. PatternDetector calls `ProposalStore.upsertProposal({sender, recipient, sourceFolder}, "Newsletters", signalId)` (IX-004).

### Phase 3: ProposalStore counts dismissed signals and resurfaces at the threshold

9. On each `upsertProposal` for a dismissed proposal, the store increments `destination_counts["Newsletters"]`, recomputes `matching_count` and `contradicting_count`, and increments `signals_since_dismiss` by 1.
10. After the first four post-dismissal moves, P1 remains `dismissed` (signals_since_dismiss = 1, 2, 3, 4). It is *not* listed by `getProposals()` and the user sees no UI change.
11. On the fifth post-dismissal move, `signals_since_dismiss` reaches 5. The store flips `status` back to `'active'`, clears `dismissed_at`, and *retains* `signals_since_dismiss = 5` so the UI can display the resurfaced notice.

### Phase 4: Resurfaced proposal reappears with a notice

12. The user opens the proposed rules page again.
13. WebServer's `GET /api/proposed-rules` calls `ProposalStore.getProposals()`. P1 is now `active` and reappears, sorted by strength.
14. The card builder generates a `resurfacedNotice`: `"Previously dismissed — 5 new moves since then."`
15. Strength label reflects the cumulative `matchingCount` (now 7: 2 pre-dismiss + 5 post-dismiss).
16. The user can now Approve, Modify, or Dismiss again.

## Expected Outcome

- ProposalStore row for P1 has `status: 'active'`, `signals_since_dismiss: 5`, `dismissed_at: NULL`, `matching_count: 7`.
- `GET /api/proposed-rules` returns P1 with `resurfacedNotice` set.
- No rule has been created (the user has not approved). MoveTracker continues to feed signals on future moves.
- ActivityLog has no entries tied to dismissal or resurfacing — these mutations live solely in `proposed_rules`. Move signals from Phase 2 are recorded in `move_signals` per IX-004.

## Variants

### UC-006.a: Re-dismiss after resurface

After Phase 4, the user dismisses P1 again. `dismissProposal` sets `status: 'dismissed'`, refreshes `dismissed_at`, and resets `signals_since_dismiss` to 0. The threshold restarts from zero — five *more* signals are required for the next resurface. The cumulative `matching_count` is preserved.

### UC-006.b: Approve a resurfaced proposal

After Phase 4, the user clicks Approve on the resurfaced P1. The flow is identical to UC-001 Phase 3 (IX-005 conflict-checking + rule creation) — the resurfacing state has no effect on approval beyond the higher displayed `matchingCount`. On approval, ProposalStore sets `status: 'approved'` and records `approved_rule_id`. Subsequent move signals for this key are no-ops on the proposal (the upsert path explicitly skips approved rows).

### UC-006.c: Contradicting moves accumulate during the dismissed window

While dismissed, the user moves three messages to "Newsletters" and two to a different folder, "Read later". The destination_counts JSON tracks both. The dominant destination remains "Newsletters" (3 vs. 2), and `matching_count` reflects the dominant tally; the two contradicting moves go into `contradicting_count`. `signals_since_dismiss` counts every signal regardless of destination — so resurfacing fires on the fifth signal even if half were contradictions. The strength label may now indicate weaker confidence.

### UC-006.d: Different envelope recipient is a different proposal

A new signal arrives with the same sender but a non-null `envelope_recipient` not seen before. The proposal key (sender + envelopeRecipient + sourceFolder) does not match P1, so a new proposal P2 is created at `matching_count: 1`, `status: 'active'`. P1's dismissal state is not affected; its threshold counter is untouched.

### UC-006.e: Dismiss of a non-existent proposal returns 404

The user's UI is stale and tries to dismiss a proposal id that no longer exists (e.g., merged or deleted by another mechanism). WebServer's `dismiss` route looks up the proposal first via `getById`; on null, returns 404 without calling `dismissProposal`. The UI prompts a reload.

### UC-006.f: Modify path approves without further dismissal interaction

Instead of approving directly, the user clicks "Modify" on the resurfaced P1. WebServer's `POST /api/proposed-rules/{id}/modify` returns the pre-fill payload (sender, envelopeRecipient, destinationFolder, sourceFolder). The frontend opens the rule editor pre-populated, the user adds a subject filter and submits. The frontend creates the rule via `POST /api/rules` (UC-005), then calls `POST /api/proposed-rules/{id}/mark-approved` with the new rule's id. ProposalStore marks P1 approved. Resurfacing logic plays no further role.
