---
id: MOD-0017
title: ActionFolderPoller
interface-schema: src/action-folders/poller.ts
unit-test-path: test/unit/action-folders/poller.test.ts
integrations: [IX-007]
invariants-enforced: [INV-001]
architecture-section: architecture.md#action-folders
---

## Responsibility

Polls the four IMAP action folders (VIP, Block, Undo-VIP, Unblock) on a fixed timer, detects user-dragged messages, and dispatches each one to ActionFolderProcessor with the corresponding ActionType. Filters out the always-present sentinel by message count before fetching, and performs a single retry pass for any folder that still holds non-sentinel messages after processing.

## Interface Summary

- `start()` — Begin periodic scanning at the configured interval (default 15s). The internal timer is `unref()`'d so it does not block process exit.
- `stop()` — Stop the periodic scan and clear the timer.
- `scanAll()` — Run a single scan over all four action folders. Single-flight: re-entrant calls while a scan is in progress short-circuit and return.

## Dependencies

- MOD-0002 — `ImapClient.status()` for cheap message counts and `ImapClient.fetchAllMessages()` to retrieve dragged messages from each action folder.
- MOD-0014 — `ConfigRepository.getActionFolderConfig()` for the enabled flag, prefix, folder names, and poll interval.
- MOD-0018 — Each non-sentinel message is handed to `ActionFolderProcessor.processMessage(msg, actionType)` for the rule mutation and recovery work.

## Notes

- The poller relies on the message-count optimization to avoid fetching when only the sentinel is present (count of 0 or 1 is skipped). When count > 1, all messages are fetched and the processor's sentinel guard distinguishes the sentinel from user-dragged messages.
- Errors raised while processing one action folder are logged and isolated; the poller continues to the next folder rather than aborting the tick.
- After processing, a status recheck triggers a single retry pass if non-sentinel messages remain. This handles the rare case where a message was added mid-scan or where the IMAP server lagged on applying a previous move.
- The ActionType for each folder is derived from `ACTION_REGISTRY`, not from folder names — folder names are user-configurable but the four ActionTypes are fixed.
