---
id: MOD-0009
title: DestinationResolver
interface-schema: src/tracking/destinations.ts
unit-test-path: test/unit/tracking/
integrations: [IX-003]
invariants-enforced: []
architecture-section: architecture.md#user-behavior-learning
---

## Responsibility

Locates where a moved message ended up using a two-tier resolution strategy. Fast-pass searches recent and common folders for quick resolution; deep-scan searches all selectable mailboxes by Message-ID on a slower timer for moves that fast-pass couldn't resolve.

## Interface Summary

- `resolveFast(messageId, sourceFolder)` — Search recent folders (from activity log) and common folder names. Returns destination folder path or null.
- `enqueueDeepScan(messageId, sourceFolder)` — Add a message to the deep-scan queue for resolution on the next 15-minute cycle.
- `runDeepScan()` — Search all selectable mailboxes for queued messages. Returns a map of messageId → destination folder.

## Dependencies

- MOD-0002 — Folder listing and message search by Message-ID.
- MOD-0007 — Recent folder list for fast-pass prioritization.

## Notes

- Fast-pass checks the last 10 folders from activity log plus hardcoded common names (Archive, All Mail, Trash, Gmail special folders).
- Deep-scan excludes the source folder, already-checked folders, and non-selectable mailboxes.
- If deep-scan also fails, the message is presumed deleted and dropped from the queue.
