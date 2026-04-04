# WBS 9.3 — ImapClient Mailbox Locking

## Problem

`ImapClient.moveMessage()` calls `ImapFlow.messageMove()` without acquiring a mailbox lock. ImapFlow's `getMailboxLock()` pauses IDLE, serializes commands, and ensures the server processes them cleanly. Without it, the MOVE command is issued while ImapFlow may be in IDLE state, leading to unreliable behavior on some IMAP servers.

This was discovered during WBS 9.1 integration testing against GreenMail: the MOVE command returns OK at the protocol level, but the message is not actually relocated. Production servers (Gmail, Dovecot, Fastmail) may be more tolerant, but relying on that tolerance is fragile.

## Scope

Add mailbox lock acquisition around IMAP operations in `ImapClient` that mutate mailbox state.

## Affected Methods

| Method | Current Behavior | Required Change |
|--------|-----------------|-----------------|
| `moveMessage(uid, destination)` | Calls `flow.messageMove()` directly | Acquire lock, move, release lock |
| `createMailbox(path)` | Calls `flow.mailboxCreate()` directly | Acquire lock, create, release lock |
| `fetchNewMessages(sinceUid)` | Calls `flow.fetch()` directly | Acquire lock, fetch, release lock |

## Implementation

### Step 1: Add lock helper to ImapClient

```typescript
private async withMailboxLock<T>(fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
  if (!this.flow) throw new Error('Not connected');
  const lock = await this.flow.getMailboxLock('INBOX');
  try {
    return await fn(this.flow);
  } finally {
    lock.release();
  }
}
```

This requires extending the `ImapFlowLike` interface to include `getMailboxLock`:

```typescript
interface MailboxLock {
  release(): void;
}

export interface ImapFlowLike {
  // ... existing methods ...
  getMailboxLock(path: string | string[]): Promise<MailboxLock>;
}
```

### Step 2: Wrap mutations

```typescript
async moveMessage(uid: number, destination: string): Promise<void> {
  await this.withMailboxLock(async (flow) => {
    await flow.messageMove([uid], destination, { uid: true });
  });
}

async createMailbox(path: string): Promise<void> {
  await this.withMailboxLock(async (flow) => {
    await flow.mailboxCreate(path);
  });
}

async fetchNewMessages(sinceUid: number): Promise<unknown[]> {
  return this.withMailboxLock(async (flow) => {
    const range = sinceUid > 0 ? `${sinceUid + 1}:*` : '1:*';
    const results: unknown[] = [];
    for await (const msg of flow.fetch(range, { uid: true, envelope: true, flags: true }, { uid: true })) {
      const m = msg as { uid?: number };
      if (m.uid !== undefined && m.uid > sinceUid) {
        results.push(msg);
      }
    }
    return results;
  });
}
```

### Step 3: Update unit test mocks

The `makeMockFlow()` helper in `test/unit/imap/client.test.ts` needs a `getMailboxLock` mock that returns `{ release: vi.fn() }`.

### Step 4: Restore integration test assertions

In `test/integration/pipeline.test.ts`, restore the assertions that were removed during WBS 9.1:

- INBOX should have 0 messages after a successful move
- Processed folder should contain the moved message

Also remove the `processNewMessages()` nudge if the locking fix allows IDLE-based detection to work reliably.

## Test Plan

- Existing unit tests pass with updated mocks (122 tests)
- Integration test 1 asserts INBOX empty + Processed has message
- Integration test 2 asserts INBOX retains unmatched message (unchanged)

## Files to Modify

| File | Change |
|------|--------|
| `src/imap/client.ts` | Add `MailboxLock` interface, `getMailboxLock` to `ImapFlowLike`, `withMailboxLock` helper, wrap `moveMessage`/`createMailbox`/`fetchNewMessages` |
| `test/unit/imap/client.test.ts` | Add `getMailboxLock` to mock flow |
| `test/unit/monitor/monitor.test.ts` | Add `getMailboxLock` and `noop` to mock flow |
| `test/integration/pipeline.test.ts` | Restore INBOX-empty and Processed-has-message assertions |

## Completion

**Completed: 2026-03-29**

All four steps implemented. 122 unit tests pass, 2 integration tests pass (including INBOX-empty and Processed-has-message assertions). The `processNewMessages()` nudge was retained in the integration test because GreenMail does not reliably push IDLE EXISTS notifications — this is a GreenMail limitation, not a locking issue.
