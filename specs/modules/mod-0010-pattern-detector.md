---
id: MOD-0010
title: PatternDetector
interface-schema: src/tracking/detector.ts
unit-test-path: test/unit/tracking/
integrations: [IX-004, IX-012]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

Processes confirmed move signals into proposal upserts. Builds a proposal key from sender, envelope recipient, and source folder, then creates or updates the corresponding proposal in ProposalStore. Handles match/contradict counting and auto-resurfaces dismissed proposals after sufficient new signals.

## Interface Summary

- `processSignal(signal)` — Process a single move signal: upsert the proposal for this sender/source combination with the observed destination.

## Dependencies

- MOD-0012 — Proposal persistence and upsert logic.

## Notes

- The proposal key is {sender, envelopeRecipient, sourceFolder}. Two messages from the same sender but different envelope recipients produce separate proposals.
- Dismissed proposals auto-resurface after 5 new signals, giving the user another chance to review a pattern they previously rejected.
- Approved proposals are not updated — the pattern is already captured as a rule.
