---
id: FM-001
title: Scheduled folder scan leaves IMAP IDLE on non-inbox folder
fault-injection-test: test/integration/fm-001-scheduled-scan-strands-idle.test.ts
integrations: [IX-001, IX-006, IX-007]
invariants-protected: [INV-001]
---

## Trigger

A scheduled, non-arrival process holds the single IMAP connection to inspect a folder other than INBOX and either:

1. Completes without re-selecting INBOX and re-arming IDLE/polling, or
2. Throws partway through, and the error path does not restore INBOX + IDLE.

Concrete instances of this trigger include:

- `ReviewSweeper` opening the review folder for IX-006.
- `ActionFolderPoller` opening any of the four action folders for IX-007.
- Any future scheduled job that uses `ImapClient` to read or move messages outside INBOX.

The most common code-level cause is a caller using `withMailboxLock` (which does not restore INBOX/IDLE) on a non-INBOX folder, or bypassing the helpers entirely and calling `getMailboxLock` / `mailboxOpen` directly.

## Required behavior

The system MUST guarantee that, regardless of which scheduled job ran or whether it succeeded:

- After the job's IMAP work returns control, the active selected mailbox is INBOX.
- IDLE (or the polling fallback) is actively listening on INBOX.
- The next message that arrives in INBOX triggers IX-001.1 (Monitor receives a `newMail` event) within the normal latency budget.

The system MUST NOT silently strand IDLE on the wrong folder. If restoration fails for any reason, an error MUST be logged at warn-or-higher severity so the condition is observable.

## Why this exists

This failure mode is captured because it occurred in production: a scheduled folder-scan job took the IMAP connection, did not return IDLE to INBOX afterwards, and inbound mail stopped being processed by rules until the connection was reset. Nothing alerted because the connection was still healthy and the scheduled jobs still ran — only IX-001 was broken, and IX-001 has no heartbeat that fires in the absence of new mail.

Because the symptom (rules stop firing) is silent and the cause (a folder-switch helper not restoring state) is easy to reintroduce when adding any new scheduled IMAP consumer, this needs a fault-injection test, not just a code review checklist.

## Test approach

`test/integration/fm-001-scheduled-scan-strands-idle.test.ts` should:

1. Bring up the IMAP test server with an INBOX and at least one secondary folder (e.g. the review folder).
2. Connect `ImapClient`, confirm it is IDLE on INBOX, and install a spy/event-listener on `newMail`.
3. Drive the scheduled job under test (ReviewSweeper tick, ActionFolderPoller tick, etc.) so it opens the secondary folder.
4. After the job returns, assert that `flow.mailbox?.path === 'INBOX'` and that the IDLE/poll loop is armed.
5. Append a fresh message to INBOX and assert that the `newMail` event fires within the normal latency budget — this is the real proof that IX-001 still works.
6. Repeat with a fault injected mid-job (e.g. force `fetchAllMessages` to throw) to verify the restoration also happens on the error path.

The test must exercise the actual scheduled consumers, not call `withMailboxSwitch` directly, because the regression risk is precisely that a future consumer bypasses the helper.
</content>
</invoke>