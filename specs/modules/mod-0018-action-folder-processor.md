---
id: MOD-0018
title: ActionFolderProcessor
interface-schema: src/action-folders/processor.ts
unit-test-path: test/unit/action-folders/processor.test.ts
integrations: [IX-007, IX-008]
invariants-enforced: []
architecture-section: architecture.md#action-folders
---

## Responsibility

Processes a single message dispatched from an action folder. Extracts the sender, looks up the action's semantics in `ACTION_REGISTRY`, mutates the rule set (creating a sender-only skip/delete rule for VIP/Block, removing the matching sender-only rule for Undo-VIP/Unblock, swapping when the opposite rule exists), moves the message to its final destination (INBOX or trash), and writes one or two activity log entries describing what happened. Sentinel messages are filtered at the entry point and never produce a rule mutation.

## Interface Summary

- `processMessage(message, actionType)` — Process one message. Returns a discriminated `ProcessResult`: `{ ok: true, action, sender, ruleId? }` on success or `{ ok: false, action, error }` on a recoverable failure (e.g., unparseable `From`).
- `extractSender(message)` — Module-level helper that parses the `From` address into a normalized lowercase bare email, returning `null` if the address is missing or has no `@`.

## Dependencies

- MOD-0002 — `ImapClient.moveMessage()` to move the dragged message out of the action folder to its final destination.
- MOD-0003 — `isSentinel(headers)` guards the entry point so the sentinel is never treated as a user action.
- MOD-0007 — `ActivityLog.logActivity()` records each rule mutation (creation, removal, conflict swap) and the final message move with `source: 'action-folder'`.
- MOD-0014 — `ConfigRepository.getRules()`, `addRule()`, `deleteRule()`, `nextOrder()`, and `getActionFolderConfig()` cover all rule mutations and source-folder path resolution.

## Notes

- The action semantics live in `ACTION_REGISTRY` (`src/action-folders/registry.ts`), not in this module — the processor is a pure orchestrator over the registry's declarative shape.
- Conflict resolution: when a create operation finds a sender-only rule for the opposite action (Block existed when VIP is requested, or vice versa), the conflicting rule is removed first and the new rule is added afterward. Each side is logged as its own activity entry.
- Multi-field rules (e.g., sender + subject) for the same sender are preserved. `isSenderOnly()` from `src/rules/sender-utils.ts` distinguishes them from sender-only rules.
- The processor never throws on expected errors. Unparseable `From` addresses, missing rules during a remove operation, and IMAP move failures all result in a returned result object (success or error) plus an activity log entry. Move failures do not roll back rule mutations — the rule mutation reflects the user's intent and a retry on the next poll will recover the stuck message.
- Destination resolution: the abstract `'inbox'` / `'trash'` values from `ACTION_REGISTRY` are resolved at runtime to the configured INBOX path and trash folder. Source folder paths are constructed as `<prefix>/<folder>` from the action-folder config.
