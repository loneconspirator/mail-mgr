# WBS Section B: IMAP Client Changes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the IMAP client to support parameterized mailbox locking, special-use folder detection, multi-folder message fetching, and mailbox switching for sweep operations.

**Architecture:** All changes go into `src/imap/client.ts` and `src/imap/messages.ts`, with exports updated in `src/imap/index.ts`. The existing single-connection model is preserved — `withMailboxSwitch` temporarily pauses IDLE, switches to the target folder, executes a callback, then returns to INBOX and resumes IDLE. A `ReviewMessage` type is added to `messages.ts` with a converter to `EmailMessage` for rule evaluation compatibility.

**Tech Stack:** TypeScript, vitest, ImapFlow (behind `ImapFlowLike` interface)

---

### Task 1: Parameterize `withMailboxLock` (B1)

**Files:**
- Modify: `src/imap/client.ts:116-124`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Update existing tests that depend on `withMailboxLock` behavior**

The `withMailboxLock` method is currently private. It becomes public and takes a `folder` parameter. Update the existing `getMailboxLock` mock assertions in `client.test.ts` to verify `'INBOX'` is still passed by callers.

Add a test in `test/unit/imap/client.test.ts` inside a new `describe('withMailboxLock')` block:

```typescript
describe('withMailboxLock', () => {
  it('acquires lock on the specified folder', async () => {
    await client.connect();

    const result = await client.withMailboxLock('SomeFolder', async () => 'done');

    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('SomeFolder');
    expect(result).toBe('done');
  });

  it('releases lock even if callback throws', async () => {
    await client.connect();
    const releaseSpy = vi.fn();
    (mockFlow.getMailboxLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ release: releaseSpy });

    await expect(
      client.withMailboxLock('INBOX', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    expect(releaseSpy).toHaveBeenCalled();
  });

  it('throws when not connected', async () => {
    await expect(
      client.withMailboxLock('INBOX', async () => 'nope'),
    ).rejects.toThrow('Not connected');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `withMailboxLock` is private and doesn't accept a folder argument.

**Step 3: Implement the change in `client.ts`**

Change `withMailboxLock` from:

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

To:

```typescript
async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
  if (!this.flow) throw new Error('Not connected');
  const lock = await this.flow.getMailboxLock(folder);
  try {
    return await fn(this.flow);
  } finally {
    lock.release();
  }
}
```

Update all internal callers to pass `'INBOX'`:

- `moveMessage`: `await this.withMailboxLock('INBOX', async (flow) => {`
- `createMailbox`: `await this.withMailboxLock('INBOX', async (flow) => {`
- `fetchNewMessages`: `return this.withMailboxLock('INBOX', async (flow) => {`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS (all existing tests still pass, new tests pass)

**Step 5: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): parameterize withMailboxLock to accept folder argument (B1)"
```

---

### Task 2: Add `sourceFolder` parameter to `moveMessage` (B2)

**Files:**
- Modify: `src/imap/client.ts:126-130`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Write test for moveMessage with custom source folder**

Add inside a new `describe('moveMessage')` block in `client.test.ts`:

```typescript
describe('moveMessage', () => {
  it('acquires lock on INBOX by default', async () => {
    mockFlow = createMockFlow({
      messageMove: vi.fn(async () => ({})),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();
    await client.moveMessage(42, 'Archive');

    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(mockFlow.messageMove).toHaveBeenCalledWith([42], 'Archive', { uid: true });
  });

  it('acquires lock on custom source folder when specified', async () => {
    mockFlow = createMockFlow({
      messageMove: vi.fn(async () => ({})),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();
    await client.moveMessage(42, 'Archive', 'Review');

    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');
    expect(mockFlow.messageMove).toHaveBeenCalledWith([42], 'Archive', { uid: true });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `moveMessage` doesn't accept a third argument yet.

**Step 3: Implement**

Change `moveMessage` in `client.ts`:

```typescript
async moveMessage(uid: number, destination: string, sourceFolder: string = 'INBOX'): Promise<void> {
  await this.withMailboxLock(sourceFolder, async (flow) => {
    await flow.messageMove([uid], destination, { uid: true });
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): add sourceFolder parameter to moveMessage (B2)"
```

---

### Task 3: Add `list` to `ImapFlowLike` interface (B3)

**Files:**
- Modify: `src/imap/client.ts:17-30`

**Step 1: Add `list` to the interface**

In the `ImapFlowLike` interface, add:

```typescript
list(options?: Record<string, unknown>): Promise<unknown[]>;
```

**Step 2: Update `createMockFlow` in the test file**

Add `list` to the mock in `test/unit/imap/client.test.ts`:

```typescript
list: vi.fn(async () => []),
```

**Step 3: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS (adding an interface member and mock doesn't break anything)

**Step 4: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): add list method to ImapFlowLike interface (B3)"
```

---

### Task 4: Implement `getSpecialUseFolder` with caching (B4)

**Files:**
- Modify: `src/imap/client.ts`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Write tests for `getSpecialUseFolder`**

Add a new `describe('getSpecialUseFolder')` block in `client.test.ts`:

```typescript
describe('getSpecialUseFolder', () => {
  it('returns folder name when special-use attribute found', async () => {
    mockFlow = createMockFlow({
      list: vi.fn(async () => [
        { path: 'INBOX', specialUse: undefined },
        { path: 'Sent', specialUse: '\\Sent' },
        { path: 'Junk', specialUse: '\\Junk' },
        { path: 'MyTrash', specialUse: '\\Trash' },
      ]),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();

    const result = await client.getSpecialUseFolder('\\Trash');
    expect(result).toBe('MyTrash');
  });

  it('returns null when special-use attribute not found', async () => {
    mockFlow = createMockFlow({
      list: vi.fn(async () => [
        { path: 'INBOX', specialUse: undefined },
        { path: 'Sent', specialUse: '\\Sent' },
      ]),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();

    const result = await client.getSpecialUseFolder('\\Trash');
    expect(result).toBeNull();
  });

  it('caches results for connection lifetime', async () => {
    mockFlow = createMockFlow({
      list: vi.fn(async () => [
        { path: 'MyTrash', specialUse: '\\Trash' },
      ]),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();

    const first = await client.getSpecialUseFolder('\\Trash');
    const second = await client.getSpecialUseFolder('\\Trash');

    expect(first).toBe('MyTrash');
    expect(second).toBe('MyTrash');
    expect(mockFlow.list).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `getSpecialUseFolder` doesn't exist.

**Step 3: Implement**

Add a cache field to the `ImapClient` class:

```typescript
private specialUseCache: Map<string, string | null> = new Map();
```

Clear the cache in `cleanupFlow()`:

```typescript
private cleanupFlow(): void {
  if (this.flow) {
    this.flow.removeAllListeners();
    this.flow = null;
  }
  this.specialUseCache.clear();
}
```

Add the method:

```typescript
async getSpecialUseFolder(use: string): Promise<string | null> {
  if (this.specialUseCache.has(use)) {
    return this.specialUseCache.get(use)!;
  }

  if (!this.flow) throw new Error('Not connected');

  const mailboxes = await this.flow.list();
  for (const mb of mailboxes) {
    const box = mb as { path?: string; specialUse?: string };
    if (box.specialUse === use && box.path) {
      this.specialUseCache.set(use, box.path);
      return box.path;
    }
  }

  this.specialUseCache.set(use, null);
  return null;
}
```

**Step 4: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): implement getSpecialUseFolder with connection-lifetime caching (B4)"
```

---

### Task 5: Create `ReviewMessage` type and converter (B5)

**Files:**
- Modify: `src/imap/messages.ts`
- Modify: `src/imap/index.ts`
- Create: (tests added to existing `test/unit/imap/messages.test.ts`)

**Step 1: Write tests for `reviewMessageToEmailMessage` (B9)**

Add to `test/unit/imap/messages.test.ts`:

```typescript
import { reviewMessageToEmailMessage, type ReviewMessage } from '../../../src/imap/index.js';

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 100,
    flags: new Set(['\\Seen']),
    internalDate: new Date('2026-03-15T08:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Review test',
      messageId: '<review-1@example.com>',
    },
    ...overrides,
  };
}

describe('reviewMessageToEmailMessage', () => {
  it('maps envelope fields to EmailMessage', () => {
    const rm = makeReviewMessage();
    const em = reviewMessageToEmailMessage(rm);

    expect(em.uid).toBe(100);
    expect(em.messageId).toBe('<review-1@example.com>');
    expect(em.from).toEqual({ name: 'Alice', address: 'alice@example.com' });
    expect(em.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }]);
    expect(em.cc).toEqual([]);
    expect(em.subject).toBe('Review test');
    expect(em.date).toEqual(new Date('2026-03-15T08:00:00Z'));
    expect(em.flags).toEqual(new Set(['\\Seen']));
  });

  it('handles empty envelope fields', () => {
    const rm = makeReviewMessage({
      envelope: {
        from: { name: '', address: '' },
        to: [],
        cc: [],
        subject: '',
        messageId: '',
      },
    });
    const em = reviewMessageToEmailMessage(rm);

    expect(em.from).toEqual({ name: '', address: '' });
    expect(em.to).toEqual([]);
    expect(em.subject).toBe('');
    expect(em.messageId).toBe('');
  });

  it('uses internalDate for the date field', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const rm = makeReviewMessage({ internalDate: d });
    const em = reviewMessageToEmailMessage(rm);

    expect(em.date).toEqual(d);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/messages.test.ts`
Expected: FAIL — `reviewMessageToEmailMessage` and `ReviewMessage` don't exist.

**Step 3: Implement in `src/imap/messages.ts`**

Add the `ReviewMessage` interface and converter after the existing code:

```typescript
export interface ReviewMessage {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  envelope: {
    from: EmailAddress;
    to: EmailAddress[];
    cc: EmailAddress[];
    subject: string;
    messageId: string;
  };
}

export function reviewMessageToEmailMessage(rm: ReviewMessage): EmailMessage {
  return {
    uid: rm.uid,
    messageId: rm.envelope.messageId,
    from: rm.envelope.from,
    to: rm.envelope.to,
    cc: rm.envelope.cc,
    subject: rm.envelope.subject,
    date: rm.internalDate,
    flags: rm.flags,
  };
}
```

**Step 4: Update exports in `src/imap/index.ts`**

Add to the existing exports:

```typescript
export { reviewMessageToEmailMessage } from './messages.js';
export type { ReviewMessage } from './messages.js';
```

**Step 5: Run tests**

Run: `npx vitest run test/unit/imap/messages.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/imap/messages.ts src/imap/index.ts test/unit/imap/messages.test.ts
git commit -m "feat(imap): add ReviewMessage type and reviewMessageToEmailMessage converter (B5, B9)"
```

---

### Task 6: Implement `fetchMessagesRaw` (B6)

**Files:**
- Modify: `src/imap/client.ts`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Write test**

Add a new `describe('fetchMessagesRaw')` block:

```typescript
describe('fetchMessagesRaw', () => {
  it('fetches messages from flow and returns array', async () => {
    const messages = [
      { uid: 1, flags: new Set(), envelope: {} },
      { uid: 2, flags: new Set(['\\Seen']), envelope: {} },
    ];
    mockFlow = createMockFlow({
      fetch: vi.fn(function* () {
        yield* messages;
      } as unknown as ImapFlowLike['fetch']),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();
    const results = await client.fetchMessagesRaw('1:*', { uid: true, flags: true });

    expect(results).toHaveLength(2);
    expect(mockFlow.fetch).toHaveBeenCalledWith('1:*', { uid: true, flags: true }, { uid: true });
  });

  it('throws when not connected', async () => {
    await expect(
      client.fetchMessagesRaw('1:*', { uid: true }),
    ).rejects.toThrow('Not connected');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `fetchMessagesRaw` doesn't exist.

**Step 3: Implement**

Add to `ImapClient`:

```typescript
async fetchMessagesRaw(range: string, query: Record<string, unknown>): Promise<unknown[]> {
  if (!this.flow) throw new Error('Not connected');
  const results: unknown[] = [];
  for await (const msg of this.flow.fetch(range, query, { uid: true })) {
    results.push(msg);
  }
  return results;
}
```

**Step 4: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): implement fetchMessagesRaw low-level fetch (B6)"
```

---

### Task 7: Implement `fetchAllMessages` (B7)

**Files:**
- Modify: `src/imap/client.ts`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Write test**

Add a new `describe('fetchAllMessages')` block. This requires importing `ReviewMessage` from the imap index:

```typescript
import type { ReviewMessage } from '../../../src/imap/index.js';
```

Then the test:

```typescript
describe('fetchAllMessages', () => {
  it('acquires lock on folder and returns ReviewMessage array', async () => {
    const rawMessages = [
      {
        uid: 10,
        flags: new Set(['\\Seen']),
        internalDate: new Date('2026-03-01T12:00:00Z'),
        envelope: {
          from: [{ name: 'Alice', address: 'alice@test.com' }],
          to: [{ name: 'Bob', address: 'bob@test.com' }],
          cc: [],
          subject: 'Hello',
          messageId: '<msg-10@test.com>',
        },
      },
      {
        uid: 20,
        flags: new Set<string>(),
        internalDate: new Date('2026-03-10T12:00:00Z'),
        envelope: {
          from: [{ name: 'Charlie', address: 'charlie@test.com' }],
          to: [{ name: 'Bob', address: 'bob@test.com' }],
          cc: [],
          subject: 'World',
          messageId: '<msg-20@test.com>',
        },
      },
    ];

    mockFlow = createMockFlow({
      fetch: vi.fn(function* () {
        yield* rawMessages;
      } as unknown as ImapFlowLike['fetch']),
    }) as typeof mockFlow;
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);

    await client.connect();
    const results = await client.fetchAllMessages('Review');

    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');
    expect(results).toHaveLength(2);
    expect(results[0].uid).toBe(10);
    expect(results[0].flags).toEqual(new Set(['\\Seen']));
    expect(results[0].internalDate).toEqual(new Date('2026-03-01T12:00:00Z'));
    expect(results[0].envelope.from).toEqual({ name: 'Alice', address: 'alice@test.com' });
    expect(results[1].uid).toBe(20);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `fetchAllMessages` doesn't exist.

**Step 3: Implement**

Add to `ImapClient`. Import `ReviewMessage` and parsing helpers at the top:

```typescript
import type { ReviewMessage, EmailAddress } from './messages.js';
```

Add a private helper to parse raw fetch results into `ReviewMessage`:

```typescript
private parseRawToReviewMessage(raw: unknown): ReviewMessage {
  const msg = raw as {
    uid: number;
    flags?: Set<string>;
    internalDate?: Date;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      to?: Array<{ name?: string; address?: string }>;
      cc?: Array<{ name?: string; address?: string }>;
      subject?: string;
      messageId?: string;
    };
  };

  const parseAddr = (a?: { name?: string; address?: string }): EmailAddress => ({
    name: a?.name ?? '',
    address: a?.address ?? '',
  });

  const parseAddrList = (list?: Array<{ name?: string; address?: string }>): EmailAddress[] =>
    list?.map(parseAddr) ?? [];

  const fromList = msg.envelope?.from;
  const from = fromList && fromList.length > 0 ? parseAddr(fromList[0]) : { name: '', address: '' };

  return {
    uid: msg.uid,
    flags: msg.flags ?? new Set(),
    internalDate: msg.internalDate ?? new Date(0),
    envelope: {
      from,
      to: parseAddrList(msg.envelope?.to),
      cc: parseAddrList(msg.envelope?.cc),
      subject: msg.envelope?.subject ?? '',
      messageId: msg.envelope?.messageId ?? '',
    },
  };
}
```

Then the public method:

```typescript
async fetchAllMessages(folder: string): Promise<ReviewMessage[]> {
  return this.withMailboxLock(folder, async () => {
    const raw = await this.fetchMessagesRaw('1:*', {
      uid: true,
      flags: true,
      internalDate: true,
      envelope: true,
    });
    return raw.map((r) => this.parseRawToReviewMessage(r));
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): implement fetchAllMessages for folder contents (B7)"
```

---

### Task 8: Implement `withMailboxSwitch` (B8)

**Files:**
- Modify: `src/imap/client.ts`
- Modify: `test/unit/imap/client.test.ts`

**Step 1: Write tests**

Add a new `describe('withMailboxSwitch')` block:

```typescript
describe('withMailboxSwitch', () => {
  it('pauses IDLE, locks folder, executes fn, reopens INBOX, resumes IDLE', async () => {
    await client.connect();

    const callOrder: string[] = [];
    (mockFlow.getMailboxLock as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('lock');
      return { release: () => callOrder.push('unlock') };
    });
    (mockFlow.mailboxOpen as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      callOrder.push(`open:${path}`);
      return {};
    });

    const result = await client.withMailboxSwitch('Review', async () => {
      callOrder.push('callback');
      return 'sweep-result';
    });

    expect(result).toBe('sweep-result');
    // Lock acquired on Review, callback runs, lock released, INBOX reopened
    expect(callOrder).toContain('lock');
    expect(callOrder).toContain('callback');
    expect(callOrder).toContain('unlock');
    expect(callOrder).toContain('open:INBOX');

    // Verify the folder locked was Review
    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');

    // IDLE should resume — verify by advancing timers past idleTimeout
    (mockFlow.noop as ReturnType<typeof vi.fn>).mockClear();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mockFlow.noop).toHaveBeenCalled();
  });

  it('reopens INBOX and resumes IDLE even if callback throws', async () => {
    await client.connect();

    await expect(
      client.withMailboxSwitch('Review', async () => {
        throw new Error('sweep failed');
      }),
    ).rejects.toThrow('sweep failed');

    // INBOX should still be reopened — verify IDLE resumes
    expect(mockFlow.mailboxOpen).toHaveBeenCalledWith('INBOX');
    (mockFlow.noop as ReturnType<typeof vi.fn>).mockClear();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mockFlow.noop).toHaveBeenCalled();
  });

  it('throws when not connected', async () => {
    await expect(
      client.withMailboxSwitch('Review', async () => 'nope'),
    ).rejects.toThrow('Not connected');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: FAIL — `withMailboxSwitch` doesn't exist.

**Step 3: Implement**

Make `stopIdleAndPoll` and `startIdleOrPoll` accessible for the switch. They're already private methods, and `withMailboxSwitch` is a method on the same class, so no visibility change needed.

Add to `ImapClient`:

```typescript
async withMailboxSwitch<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
  if (!this.flow) throw new Error('Not connected');

  this.stopIdleAndPoll();

  const lock = await this.flow.getMailboxLock(folder);
  try {
    return await fn(this.flow);
  } finally {
    lock.release();
    try {
      await this.flow!.mailboxOpen('INBOX');
    } catch {
      // best-effort reopen
    }
    this.startIdleOrPoll();
  }
}
```

Note: `mailboxOpen('INBOX')` is called in `connect()` initially with the `!` on the very first line. Here in the finally block we need the same call. The `flow!` is safe because we checked `this.flow` at the top and the lock acquisition would have thrown if the connection died. But we wrap in try/catch for resilience.

**Step 4: Run tests**

Run: `npx vitest run test/unit/imap/client.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/imap/client.ts test/unit/imap/client.test.ts
git commit -m "feat(imap): implement withMailboxSwitch for sweep folder operations (B8)"
```

---

### Task 9: Update `src/imap/index.ts` exports (B3/B5/B7)

**Files:**
- Modify: `src/imap/index.ts`

**Step 1: Update exports**

Ensure all new public types and functions are exported. The file should look like:

```typescript
export { ImapClient } from './client.js';
export type { ConnectionState, ImapClientEvents, ImapFlowLike, ImapFlowFactory, MailboxLock } from './client.js';
export { parseMessage, reviewMessageToEmailMessage } from './messages.js';
export type { EmailMessage, EmailAddress, ImapFetchResult, ReviewMessage } from './messages.js';
```

(Task 5 already added `reviewMessageToEmailMessage` and `ReviewMessage` — this step ensures everything is consistent and `MailboxLock` is exported if needed downstream.)

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/imap/index.ts
git commit -m "chore(imap): update barrel exports for new types and methods (B3)"
```

---

### Task 10: Verify everything and run full suite

**Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: All tests pass, no regressions.

**Step 2: Run TypeScript type checking**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Verify the build**

Run: `npm run build`
Expected: Build succeeds.

---

## Summary of Changes

| WBS Item | Description | Status |
|----------|-------------|--------|
| B1 | Parameterize `withMailboxLock` with `folder`, update callers | Task 1 |
| B2 | Add `sourceFolder` param to `moveMessage` | Task 2 |
| B3 | Add `list` to `ImapFlowLike` interface | Task 3 |
| B4 | Implement `getSpecialUseFolder` with caching | Task 4 |
| B5 | Create `ReviewMessage` type and converter | Task 5 |
| B6 | Implement `fetchMessagesRaw` | Task 6 |
| B7 | Implement `fetchAllMessages` | Task 7 |
| B8 | Implement `withMailboxSwitch` | Task 8 |
| B9 | Tests for `reviewMessageToEmailMessage` | Task 5 (combined) |
| B10 | Tests for `getSpecialUseFolder` | Task 4 (combined) |
| B11 | Tests for `withMailboxSwitch` | Task 8 (combined) |
