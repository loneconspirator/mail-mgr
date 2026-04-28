---
id: MOD-0016
title: ReviewSweeper
interface-schema: src/sweep/index.ts
unit-test-path: test/unit/sweep/
integrations: [IX-006]
invariants-enforced: []
architecture-section: architecture.md#core-processing
---

## Responsibility

Periodically archives aged messages from the Review folder based on read status and age thresholds. Re-evaluates rules against eligible messages to determine the correct destination. Falls back to the configured default archive folder when no rule matches. Exposes both standalone helper functions and a managed class with timer lifecycle.

## Interface Summary

### Standalone Functions
- `isEligibleForSweep(message, config, now)` — Check if a message's age exceeds the configured threshold for its read status. Returns boolean.
- `resolveSweepDestination(message, rules, defaultArchiveFolder)` — Evaluate sweep-filtered rules against a message. Returns a SweepDestination (move to folder or delete) and the matched rule.
- `processSweepMessage(msg, deps)` — Process a single eligible message: resolve destination, execute move, log result.

### ReviewSweeper Class
- `start()` — Begin periodic sweeps (30s initial delay, then every `intervalHours`).
- `stop()` — Stop the sweep timer.
- `restart()` — Stop and restart (used on config change).
- `runSweep()` — Execute a single sweep cycle immediately.
- `getState()` — Returns sweep state: lastSweep timestamp, messagesArchived, errors, nextSweepAt.
- `updateRules(rules)` — Hot-reload rules from ConfigRepository change listener.

## Dependencies

- MOD-0002 — Fetch messages from Review folder and execute moves.
- MOD-0003 — Guard against processing sentinel messages.
- MOD-0004 — Re-evaluate rules to determine sweep destination.
- MOD-0007 — Log sweep actions and persist sweep state.

## Notes

- Sweep-filtered rules exclude `skip` actions and `review` actions without a folder, since those would create loops (message stays in or returns to Review).
- Read messages use `readMaxAgeDays` (default 7); unread use `unreadMaxAgeDays` (default 14).
- The sweep timer subscribes to ConfigRepository's reviewConfigChange listener for hot-reload on config changes.
