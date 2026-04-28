---
id: MOD-0003
title: SentinelDetector
interface-schema: src/sentinel/detect.ts
unit-test-path: test/unit/sentinel/
integrations: [IX-001, IX-006, IX-007, IX-008]
invariants-enforced: []
architecture-section: architecture.md#imap--infrastructure
---

## Responsibility

Tests whether a message is a system-planted sentinel by checking for the `X-Mail-Mgr-Sentinel` header. Guards every processing boundary (Monitor, ReviewSweeper, BatchEngine, ActionFolderPoller, MoveTracker) to prevent the system from processing its own internal tracking messages.

## Interface Summary

- `isSentinel(headers)` — Check a parsed headers Map for the sentinel header. Returns boolean.
- `isSentinelRaw(headersBuffer)` — Check a raw headers Buffer for the sentinel header. Returns boolean.
- `SENTINEL_HEADER` — The header name constant (`X-Mail-Mgr-Sentinel`).

## Dependencies

None — pure functions operating on header data.

## Notes

- Two variants exist because different IMAP fetch modes return headers in different formats (parsed Map vs raw Buffer).
- This is a critical guard — if sentinel detection fails, the system could enter infinite processing loops by re-processing its own planted messages.
