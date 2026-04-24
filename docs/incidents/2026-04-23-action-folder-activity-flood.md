# Incident: Action Folder Activity Flood

**Date:** 2026-04-23
**Severity:** High — bogus delete rules created for real senders, messages trashed
**Status:** Partially resolved — activity flood fixed, root cause of initial rule creation still unclear

## Symptoms

After shipping v0.7 (Sentinel Message System), the Activity page showed every processed message as "Trash" with rule name "Block: <sender>" — regardless of the sender's actual rule (review, move, etc). Messages were still in the inbox in most cases, but some did end up in Trash.

## Timeline

1. v0.7 deployed with action folder system and sentinel message system
2. On first startup, 89 `Block: <sender>` rules were erroneously created via the action-folder processor (source: `action-folder`, action: `delete`)
3. These Block rules persisted in `config.yml` with `type: delete`
4. Sentinel messages were planted in all action folders (including `Actions/🚫 Block Sender`)
5. Every 15-second poll cycle, the poller found the sentinel in each action folder, but the sentinel guard correctly skipped it
6. However, the existing 89 Block rules caused `duplicate-delete` activity entries to be logged — at a rate of ~1000 entries per 5 minutes, flooding the activity table
7. The monitor's rule evaluation used the original move/review rules (lower order = higher priority) for most messages, but some messages may have been trashed by the Block rules

## Root Cause

**Still unclear.** The 89 Block rules were created by the action-folder processor (`source: action-folder`), meaning real messages were somehow processed through the `block` action type. The user never manually placed messages in the `Actions/🚫 Block Sender` folder. Possible causes:

- Race condition during first v0.7 deploy where `fetchAllMessages` read from the wrong IMAP folder
- IMAP folder selection issue with emoji characters in folder names (`🚫 Block Sender`)
- Stale container running old code alongside new code
- IMAP connection state issue where `withMailboxLock` opened INBOX instead of the action folder

**The duplicate-delete flood** was caused by the poller's FOLD-02 retry mechanism. When the sentinel was the only message in the folder, `status()` always returned 1 (sentinel stays), triggering the retry path. Combined with the existing Block rules in config, this created a feedback loop of `duplicate-delete` activity logging.

## Impact

- 89 bogus `Block: <sender>` rules created in `config.yml`
- 3,472+ `duplicate-delete` activity entries flooding the activity table
- Activity page unusable — only showed "Trash" entries
- Some messages may have been moved to Trash by the bogus Block rules
- Legitimate activity entries (arrival, sweep) drowned out

## Fixes Applied

### Code Changes (commit TBD)

1. **Poller sentinel awareness** (`src/action-folders/poller.ts`): FOLD-02 retry now tracks sentinel count and skips retry when all messages are sentinels
2. **Bulk rule delete API** (`src/web/routes/rules.ts`): `DELETE /api/rules?namePrefix=<prefix>` for cleanup
3. **Activity purge API** (`src/web/routes/activity.ts`, `src/log/index.ts`): `DELETE /api/activity?action=<action>&source=<source>` for cleanup
4. **Smoke tests** (`test/unit/smoke-pipeline.test.ts`): 5 tests covering sentinel-only folders, activity flood prevention, and correct action-folder processing

### Production Cleanup

```bash
# Delete bogus Block rules
curl -X DELETE 'http://192.168.1.90:2999/api/rules?namePrefix=Block:'

# Purge duplicate-delete activity flood
curl -X DELETE 'http://192.168.1.90:2999/api/activity?action=duplicate-delete&source=action-folder'

# Purge initial bogus delete entries
curl -X DELETE 'http://192.168.1.90:2999/api/activity?action=delete&source=action-folder'
```

Also: manually check Trash folder and recover any messages that were incorrectly trashed.

## Lessons

1. **No smoke test caught this.** Unit tests for processor and poller passed individually, but nobody tested "sentinel in action folder processed through the poller" end-to-end. The new smoke tests cover this gap.
2. **Action folders should not create rules from messages the user didn't place there.** There is no safeguard against accidental rule creation if messages end up in action folders through non-user means.
3. **The FOLD-02 retry is dangerous with persistent messages.** Any message that stays in an action folder (sentinel, failed move) triggers infinite reprocessing. The sentinel-aware fix helps, but a broader solution (e.g., tracking processed UIDs) may be needed.
4. **Deploying a system that auto-creates delete rules for email senders is inherently dangerous.** Consider adding a confirmation step or dry-run mode before creating rules from action folder messages.
