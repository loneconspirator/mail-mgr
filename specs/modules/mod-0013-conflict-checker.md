---
id: MOD-0013
title: ConflictChecker
interface-schema: src/rules/conflict-checker.ts
unit-test-path: test/unit/rules/
integrations: [IX-005]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

Detects conflicts between a proposed rule and existing rules before approval. Identifies two conflict types: exact matches (identical sender + recipient + folder) that would create duplicates, and shadow conflicts (broader existing rule at higher priority) that would make the new rule unreachable.

## Interface Summary

- `checkProposalConflict(proposal, rules)` — Check a proposal against all existing rules. Returns a ProposalConflict describing the conflict type and conflicting rule, or null if no conflicts.

## Dependencies

None — pure function operating on proposal and rule data.

## Notes

- Exact-match conflicts block approval entirely — the rule already exists.
- Shadow conflicts can be overridden with an `insertBefore` parameter, which causes the new rule to be inserted at a specific position with existing rules reordered.
- The conflict check runs at approval time, not at proposal creation time, because rules may change between when a proposal is created and when the user reviews it.
