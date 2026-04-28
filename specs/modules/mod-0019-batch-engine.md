---
id: MOD-0019
title: BatchEngine
interface-schema: src/batch/index.ts
unit-test-path: test/unit/batch/
integrations: [IX-009, IX-010]
invariants-enforced: [INV-001]
architecture-section: architecture.md#core-processing
---

## Responsibility

Retroactively applies the current rule set to messages already present in a chosen folder. Provides two operations: a non-mutating dry-run that returns grouped previews of what would happen, and a chunked execute that performs the moves. Supports cooperative cancel between chunks. Selects processing semantics based on whether the source folder is INBOX, the configured Review folder, or any other folder.

## Interface Summary

- `dryRun(sourceFolder)` — Fetch all messages, evaluate against current rules, return `DryRunGroup[]` keyed by `{action, destination}`. Sets `state.status` to `dry-running` then `previewing`. Throws `"Batch already running"` when `running === true`.
- `execute(sourceFolder)` — Fetch all messages, process in chunks of 25, perform moves through ActionExecutor (inbox mode), `processSweepMessage` (review mode), or direct `ImapClient.moveMessage` (generic mode). Yields with `setImmediate` between chunks. Returns a `BatchResult` summary. Throws `"Batch already running"` on concurrent invocation.
- `cancel()` — Set the cooperative cancel flag. Effective at the next inter-chunk check; the in-flight chunk completes.
- `getState()` — Return the current `BatchState` snapshot (status, source folder, totals, counters, dry-run results, completedAt).
- `updateRules(rules)` — Hot-swap the engine's rules array. The next chunk uses the new set; an in-flight chunk completes against its captured copy.

## Dependencies

- MOD-0002 — Fetch messages and execute moves; provides INV-001 enforcement transparently via `withMailboxSwitch`.
- MOD-0003 — Skip sentinel messages at every per-message guard.
- MOD-0004 — Evaluate rules against each message in inbox/generic mode.
- MOD-0006 — Execute the matched action in inbox mode.
- MOD-0007 — Record per-message outcomes with `source: 'batch'`.
- MOD-0016 — Reuse `isEligibleForSweep`, `resolveSweepDestination`, and `processSweepMessage` for review-folder mode.

## Notes

- Processing modes:
    - `inbox` (`sourceFolder === 'INBOX'`) — uses `executeAction`; review-action rules resolve to the configured Review folder.
    - `review` (`sourceFolder === reviewFolder`) — uses sweep semantics including `defaultArchiveFolder` fallback.
    - `generic` (anything else) — uses rule evaluation but performs moves directly via `moveMessage`; review-action rules without a `folder` are reported as "Skip" (no fallback).
- Per-message errors increment `state.errors` and are logged to ActivityLog; the run continues. A fetch-time error sets `state.status = 'error'` and aborts before per-message processing.
- Cancel is cooperative, not preemptive. The user observes a small lag (up to ~25 messages) between clicking Cancel and the run terminating.
- The fire-and-forget invocation in `WebServer` means execute errors after the synchronous portion never reach the client; only `getState()` polling reveals them.
- INV-001 is satisfied transitively: BatchEngine never calls `getMailboxLock` directly; all IMAP operations route through MOD-0002 helpers that enforce INBOX restoration in their `finally` blocks.
