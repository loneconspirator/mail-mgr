---
id: MOD-0012
title: ProposalStore
interface-schema: src/tracking/proposals.ts
unit-test-path: test/unit/tracking/
integrations: [IX-004, IX-005]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

SQLite persistence for detected move patterns presented as rule proposals. Tracks per-sender destination counts, match/contradict statistics, proposal status (active/approved/dismissed), and links to approved rules. Provides query access for the web UI and approval workflow.

## Interface Summary

- `upsertProposal(key, destination, signalId)` — Create or update a proposal for the given sender/source/destination combination. Handles match/contradict counting, dominant destination recalculation, and dismissed proposal resurfacing.
- `getProposals()` — List all proposals (all statuses).
- `getById(id)` — Look up a proposal by ID.
- `getExampleSubjects(sender, envelopeRecipient, sourceFolder, limit?)` — Get example message subjects from SignalStore for display in the web UI.
- `approveProposal(id, ruleId)` — Mark a proposal as approved with a reference to the created rule ID.
- `dismissProposal(id)` — Mark a proposal as dismissed, recording the dismissal timestamp.

## Dependencies

- better-sqlite3 (external) — Shared SQLite database.

## Notes

- The `destination_counts` field is a JSON-serialized map of {folder: count}, enabling dominant destination recalculation when contradicting moves occur.
- Resurfacing logic: a dismissed proposal's `signals_since_dismiss` counter increments on each new signal. At 5, the proposal is reactivated.
- Approved proposals store the `approved_rule_id` for traceability back to the created rule.
