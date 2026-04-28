---
id: MOD-0006
title: ActionExecutor
interface-schema: src/actions/index.ts
unit-test-path: test/unit/actions/
integrations: [IX-002]
invariants-enforced: []
architecture-section: architecture.md#core-processing
---

## Responsibility

Executes the matched rule's action against a message. Handles move, review, skip, and delete action types. Auto-creates destination folders that don't exist yet.

## Interface Summary

- `executeAction(ctx, message, rule)` — Execute the rule's action. Returns an ActionResult with success/error status and the destination folder.

## Dependencies

- MOD-0002 — Performs the actual IMAP MOVE operation and folder creation.

## Notes

- `ActionContext` provides the ImapClient, review folder path, and trash folder path so the executor can resolve destinations for review and delete actions.
- On move failure due to missing folder, the executor creates the folder and retries once.
- Skip actions return a successful result without touching IMAP.
