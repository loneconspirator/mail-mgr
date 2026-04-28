---
id: MOD-0001
title: Monitor
interface-schema: src/monitor/index.ts
unit-test-path: test/unit/monitor/
integrations: [IX-001, IX-002]
invariants-enforced: []
architecture-section: architecture.md#core-processing
---

## Responsibility

Listens for new IMAP messages in INBOX via IDLE (or polling fallback), orchestrates the arrival pipeline: fetch new messages by UID cursor, guard against sentinels, evaluate rules, delegate action execution, and log results. The primary message processing loop for the system.

## Interface Summary

- `start()` — Connect to IMAP, begin IDLE/poll listening for new messages.
- `stop()` — Disconnect and cease processing.
- `processNewMessages()` — Fetch messages with UIDs greater than lastUid, evaluate rules, execute actions. Called on each IDLE newMail event.
- `updateRules(rules)` — Hot-reload the rule set from ConfigRepository change listener.
- `getState()` — Returns current monitor state (connected, lastUid, processing status).

## Dependencies

- MOD-0002 — IMAP connection, message fetching, IDLE events.
- MOD-0003 — Sentinel guard before rule evaluation.
- MOD-0004 — First-match-wins rule evaluation.
- MOD-0006 — Executes the matched rule's action.
- MOD-0007 — Logs results and persists lastUid cursor.

## Notes

- Monitor subscribes to ConfigRepository's rulesChanged listener to hot-reload rules without restart.
- The lastUid cursor is persisted to the ActivityLog state table so processing resumes from the correct point after restart.
- Sentinel messages are skipped before rule evaluation — they never reach the RuleEvaluator.
