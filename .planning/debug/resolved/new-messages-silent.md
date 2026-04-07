---
status: resolved
trigger: "New messages are not getting handled since updating the system to store the last message ID. No new messages appear in the log, rules are not applied."
created: 2026-04-06T00:00:00Z
updated: 2026-04-06T01:00:00Z
---

## Current Focus

hypothesis: lastUid is updated BEFORE processMessage runs. If processMessage throws (or the loop is
  interrupted), the UID is already persisted as "processed" — so on the next restart the message is
  permanently skipped. Additionally, messages that arrive while the initial scan is running are dropped
  by the processing guard and may never be retried. Moving the lastUid update to AFTER processMessage
  completes (or after the full loop) ensures only genuinely-processed messages advance the cursor.
test: Move activityLog.setState call to after processMessage succeeds, so that a failed or dropped
  message does not advance lastUid.
expecting: New messages are fetched and processed reliably on every restart and on newMail events.
next_action: Apply fix — move lastUid persistence to after processMessage, add per-message error
  handling so one bad message does not abort the whole batch.

## Symptoms

expected: New messages should be logged and processed by rules/sweep when the app starts
actual: Silent failure — no new messages in the log, no errors, rules not applied
errors: None — completely silent
reproduction: Start the app — no logs for new messages. Send a test email matching a rule — no log, rule not applied.
started: After updating the system to store the last message ID (commit 2c54612)

## Eliminated

- hypothesis: Schema creation failure (state table not created)
  evidence: db.exec(SCHEMA) creates both tables correctly; tests confirm state round-trip works
  timestamp: 2026-04-06

- hypothesis: parseInt/getState returning wrong value
  evidence: parseInt('50', 10) = 50; getState returns correct string; all confirmed in manual test
  timestamp: 2026-04-06

- hypothesis: fetchNewMessages lock deadlock
  evidence: withMailboxLock uses finally{lock.release()}, all callers release; no deadlock possible
  timestamp: 2026-04-06

- hypothesis: ImapFlow exists event missing prevCount
  evidence: ImapFlow source always emits {path, count, prevCount} where prevCount = this.mailbox.exists
  timestamp: 2026-04-06

## Evidence

- timestamp: 2026-04-06
  checked: commit 2c54612 diff
  found: lastUid update (setState call) is placed BEFORE processMessage runs in the for loop
  implication: If processMessage throws or the loop is interrupted by the outer catch, the UID is
    already persisted as processed — that message will never be retried

- timestamp: 2026-04-06
  checked: processNewMessages outer try/catch
  found: Any exception in the for-loop body propagates to the outer catch, which logs the error and
    stops processing the remaining messages in the fetched batch
  implication: A single failed message aborts the entire batch; combined with early lastUid update,
    the failed message AND all subsequent messages in the batch are effectively skipped forever

- timestamp: 2026-04-06
  checked: processNewMessages processing guard
  found: if (this.processing) return — newMail events that fire while initial scan is running are
    silently dropped and never retried
  implication: Messages arriving during startup scan are missed until the next newMail event or restart

- timestamp: 2026-04-06
  checked: monitor test coverage
  found: The "persists lastUid" test only verifies the fetch RANGE used on second startup, not that
    new messages present in the fetch result are actually processed; no test covers batch interruption
  implication: The ordering bug (setState before processMessage) has no test catching it

## Resolution

root_cause: In processNewMessages, lastUid is updated (and persisted to DB) BEFORE processMessage
  is called. If processMessage or anything inside it causes the loop to abort (exception propagates
  to outer catch), the affected UID is already recorded as processed and the message is permanently
  skipped on all future restarts. With the new persistence, this creates a silent, unrecoverable gap.
  Additionally, there is no per-message error isolation — one bad message aborts the whole batch.

fix: |
  1. Move lastUid/setState call to AFTER processMessage completes successfully.
  2. Wrap the per-message processing in its own try/catch so one bad message does not abort the batch.
  These changes mean: a message is only marked as processed once it has been processed; and a failure
  on one message is logged but does not prevent subsequent messages from being processed.

verification: |
  All 230 tests pass (228 existing + 2 new regression tests).
  New tests confirm:
  - lastUid is only persisted after processMessage returns successfully
  - lastUid is not persisted when processMessage throws
files_changed:
  - src/monitor/index.ts
  - test/unit/monitor/monitor.test.ts
