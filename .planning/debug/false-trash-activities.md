---
status: diagnosed
trigger: "Activities page showing 'trashed' for ALL processed messages, but messages are NOT actually being trashed"
created: 2026-04-23T00:00:00Z
updated: 2026-04-23T01:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- Action-folder processor logs activity with success=true BEFORE moveMessage, and does NOT return early after duplicate detection. Messages stuck in Block folder get reprocessed every 15-second poll cycle, flooding the activity log with duplicate-delete entries.
test: Code review of processor.ts lines 66-103 confirms pre-move logging and no early return
expecting: N/A -- root cause confirmed via code analysis + production data correlation
next_action: Return diagnosis

## Symptoms

expected: Activities page should only show "trashed" entries when a message is actually moved to trash by a trash-action rule. Messages with other rule types should show their actual action.
actual: ALL activity records show action=duplicate-delete, folder=Trash, rule_name=Block:<sender>, source=action-folder, success=1. Messages stay in inbox.
errors: None
reproduction: Process any message with any rule -- activity record shows "trashed"
started: v0.7 release

## Eliminated

- hypothesis: Sentinel system logging delete actions for sentinel operations
  evidence: Sentinel uses logSentinelEvent() with actions like 'rename-healed', 'sentinel-replanted', 'folder-lost' -- none are 'delete'. Source is 'sentinel'.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: executeAction incorrectly mapping action types
  evidence: Code review of src/actions/index.ts shows correct mapping: move->move, review->review, skip->skip, delete->delete. Each case returns the correct action string.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: logActivity receiving wrong action value
  evidence: All callers (monitor, sweep, batch, action-folder) pass through the action value from executeAction or build it correctly from rule.action.type.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Frontend display logic mapping wrong action to "Trash"
  evidence: Frontend switch at app.ts:730-734 only shows "Trash" for e.action==='delete'. Other actions show correct labels. Built JS (dist/public/app.js) matches source. For duplicate-delete, the default case shows "-> Trash" because folder=Trash.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: API response mapping columns incorrectly
  evidence: activity.ts route maps r.action to action correctly. No column reordering or mismapping.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Config schema or Zod transformation corrupting action types
  evidence: Discriminated union validates but does not transform action types. saveConfig re-validates but writes result.data (not mutating input).
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Sentinel healer corrupting rule action types during rename/folder-loss
  evidence: handleRename only modifies action.folder (not action.type). handleFolderLoss only sets rule.enabled=false.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Database migration corrupting existing data
  evidence: v0.7 migrations only CREATE new tables (sentinels, move_signals, proposed_rules). No ALTER on activity table.
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Action folder processor flooding activity log with delete entries
  evidence: Block action logs action='delete' but only for actual block operations. Sentinel messages in action folders are skipped by isSentinel guard (no activity logged). Duplicate detection logs 'duplicate-delete' which wouldn't display as "Trash".
  timestamp: 2026-04-23T00:01:00Z

- hypothesis: Monitor or other processor putting messages into Block action folder
  evidence: Monitor moves to INBOX/Review/Trash, never to action folders. Sweep moves to archive/trash. Batch moves to archive/trash. No code path moves messages INTO action folders.
  timestamp: 2026-04-23T01:00:00Z

- hypothesis: findSenderRule matching Move/Review rules as Delete rules
  evidence: findSenderRule strictly checks r.action.type === actionType ('delete'). Move and Review rules have type='move'/'review', not 'delete'. Cannot match.
  timestamp: 2026-04-23T01:00:00Z

- hypothesis: Sentinel messages leaking past isSentinel guard
  evidence: GUARD-01 is correctly implemented as first check in processMessage(). getHeaderFields() always includes X-Mail-Mgr-Sentinel. parseHeaderLines normalizes to lowercase. isSentinel checks headers.has(SENTINEL_HEADER). Even if leaked, sentinel From is mail-manager@localhost, not real senders seen in production.
  timestamp: 2026-04-23T01:00:00Z

- hypothesis: IMAP folder path mismatch or wrong mailbox selected during fetch
  evidence: withMailboxLock uses ImapFlow's getMailboxLock which does SELECT. fetchAllMessages and moveMessage both properly lock the correct folder. Single-flow sequential locking prevents concurrent mailbox confusion.
  timestamp: 2026-04-23T01:00:00Z

## Evidence

- timestamp: 2026-04-23T00:01:00Z
  checked: src/actions/index.ts -- executeAction function
  found: Correctly maps action types: move returns 'move', review returns 'review', skip returns 'skip', delete returns 'delete'. Each via explicit case in switch statement.
  implication: The action field in ActionResult is correct for all rule types.

- timestamp: 2026-04-23T00:01:00Z
  checked: src/log/index.ts -- logActivity function
  found: Inserts result.action directly into the action column. No transformation or default value.
  implication: Whatever executeAction returns is what gets stored.

- timestamp: 2026-04-23T00:01:00Z
  checked: src/web/frontend/app.ts lines 728-735 -- activity display
  found: switch(e.action) maps 'delete' to cross-mark+Trash, 'skip' to dash+Inbox, 'review' to arrow+Review, default to arrow+folder.
  implication: Only action='delete' in the DB would produce the "Trash" display. But duplicate-delete falls to default, showing "-> Trash" because folder=Trash.

- timestamp: 2026-04-23T00:01:00Z
  checked: Local database (data/db.sqlite3) -- recent activity entries
  found: All recent entries have action='review' or action='move'. ZERO entries with action='delete'. Timestamps are April 18-19 (pre-fix).
  implication: Local DB shows correct behavior. Production DB may differ.

- timestamp: 2026-04-23T00:01:00Z
  checked: data/config.yml -- rule definitions
  found: 15 rules total. Mix of type='move' (10) and type='review' (5). ZERO rules with type='delete' or type='skip'.
  implication: No delete rules exist in config, so no legitimate path to action='delete' entries via normal processing.

- timestamp: 2026-04-23T00:01:00Z
  checked: All activity-writing code paths (monitor, sweep, batch, action-folder, sentinel)
  found: Every path correctly derives the action value from the rule's action.type or uses specific sentinel action strings.
  implication: No code path would produce action='delete' for a non-delete rule.

- timestamp: 2026-04-23T00:01:00Z
  checked: dist/public/app.js -- built frontend
  found: Contains exactly 2 occurrences of "Trash": one in activity display ('\u2715 Trash') and one in settings label. Matches source code.
  implication: No build artifact discrepancy.

- timestamp: 2026-04-23T01:00:00Z
  checked: Production activity records (user-provided)
  found: ALL entries have action=duplicate-delete, folder=Trash, rule_name=Block:<sender>, source=action-folder, success=1
  implication: The action-folder processor's duplicate-detection path (processor.ts:66-70) is the sole source. Block rules exist in production config for these senders.

- timestamp: 2026-04-23T01:00:00Z
  checked: src/action-folders/processor.ts lines 66-103 -- duplicate path flow
  found: After logging duplicate-delete activity with success=true (line 69-70), code falls through to moveMessage (line 99) with NO early return. If moveMessage fails (line 100-103), activity record already committed with success=1. Failed message stays in Block folder, reprocessed next poll cycle (15s).
  implication: Messages stuck in Block folder generate duplicate-delete entries every 15 seconds indefinitely.

- timestamp: 2026-04-23T01:00:00Z
  checked: src/action-folders/processor.ts line 118-133 -- buildActionResult
  found: success field is HARDCODED to true. Activity is logged BEFORE moveMessage. No correction on move failure.
  implication: Activity records always show success=1 regardless of whether the message was actually moved.

- timestamp: 2026-04-23T01:00:00Z
  checked: src/action-folders/poller.ts -- FOLD-02 retry logic
  found: After processing all messages in a folder, poller checks if messages remain (status recheck). If messages > 0, retries processing. This reprocesses stuck messages within the SAME poll cycle.
  implication: Each poll cycle may process a stuck message 2x (initial + retry), doubling the duplicate-delete flood.

- timestamp: 2026-04-23T01:00:00Z
  checked: src/action-folders/registry.ts -- ACTION_REGISTRY
  found: block action has ruleAction='delete', destination='trash'. Template literal `duplicate-${actionDef.ruleAction}` produces 'duplicate-delete' for block duplicates.
  implication: Confirms the duplicate-delete string origin.

- timestamp: 2026-04-23T01:00:00Z
  checked: src/config/repository.ts -- addRule
  found: addRule pushes to this.config.rules, persists to disk via saveConfig, and calls notifyRulesChange. Block rules created by processor persist permanently in config.yml.
  implication: Once created, Block rules survive restarts and accumulate. Production config likely contains many Block:<sender> rules not present in source-controlled config.

## Resolution

root_cause: The action-folder processor has two interacting bugs causing an activity log flood: (1) Activity is logged with success=true BEFORE the moveMessage call, with no correction on move failure. If moveMessage fails, the message stays in the Block action folder and gets reprocessed every 15-second poll cycle. (2) The duplicate-detection path (processor.ts:66-70) has no early return -- it always falls through to the move operation, but the activity log entry is already committed. Combined with the FOLD-02 retry (which reprocesses remaining messages within the same cycle), a single stuck message generates 2+ duplicate-delete entries per poll tick (every 15s), rapidly flooding the activity table and drowning out legitimate arrival/sweep entries.
fix:
verification:
files_changed: []
