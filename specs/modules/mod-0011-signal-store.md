---
id: MOD-0011
title: SignalStore
interface-schema: src/tracking/signals.ts
unit-test-path: test/unit/tracking/
integrations: [IX-004]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

SQLite persistence for raw user-move signals. Each signal records the full context of a detected user move: sender, envelope recipient, subject, visibility, read status, source folder, and destination folder. Provides query access and auto-pruning.

## Interface Summary

- `logSignal(input)` — Persist a move signal. Returns the assigned signal ID.
- `getSignals(limit?)` — Query recent signals.
- `getSignalById(id)` — Look up a signal by ID.
- `getSignalByMessageId(messageId)` — Look up a signal by message ID.
- `prune(days?)` — Remove signals older than the specified number of days (default 90).

## Dependencies

- better-sqlite3 (external) — Shared SQLite database (same db instance as ActivityLog and ProposalStore).

## Notes

- Signals are the raw input to PatternDetector. They are preserved independently of proposals so historical analysis is possible even after proposals are approved or dismissed.
- Auto-prunes signals older than 90 days.
