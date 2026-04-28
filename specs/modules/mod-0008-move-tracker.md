---
id: MOD-0008
title: MoveTracker
interface-schema: src/tracking/index.ts
unit-test-path: test/unit/tracking/
integrations: [IX-003]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

Detects user-initiated message moves by scanning tracked folders on a timer, comparing UID snapshots to detect disappearances, and confirming via a two-scan protocol. Coordinates with DestinationResolver to locate moved messages, then feeds confirmed signals to PatternDetector for proposal generation.

## Interface Summary

- `start()` — Begin periodic scanning (default every 30s).
- `stop()` — Stop scanning.
- `getState()` — Returns scan count, pending confirmations, deep scan queue size.
- `runScanForTest()` — Execute a single scan cycle (test helper).
- `triggerDeepScan()` — Manually trigger a deep scan of all folders for unresolved moves.

## Dependencies

- MOD-0002 — UID snapshot fetching and folder scanning.
- MOD-0007 — System move exclusion via `isSystemMove`.
- MOD-0009 — Fast-pass and deep-scan destination resolution.
- MOD-0010 — Receives confirmed move signals for proposal upsert.
- MOD-0011 — Persists raw move signals.

## Notes

- Two-scan confirmation prevents false positives: a message must be absent on two consecutive scans before being treated as moved.
- Tracks INBOX and Review folder by default; also scans destination folders from recent activity.
- Deep scan runs on a 15-minute timer for moves that fast-pass resolution couldn't locate.
