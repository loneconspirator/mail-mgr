# Monitor Changes (Section F) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add integration tests verifying that review, skip, and delete action types work end-to-end through the Monitor pipeline, and confirm the existing integration test `makeConfig` includes the `review` property required by the Monitor constructor.

**Architecture:** F1-F4 are already implemented. The Monitor constructor reads `config.review.folder` and `config.review.trashFolder`, builds an `ActionContext`, and passes `'arrival'` as the log source. We only need F5: unit tests exercising the three new action types (review → moves to Review folder, skip → stays in INBOX with no IMAP calls, delete → moves to Trash) through the Monitor's `processMessage` path. These are unit-level tests using mocked ImapFlow, matching the existing test style in `test/unit/monitor/monitor.test.ts`.

**Tech Stack:** TypeScript, Vitest, mock ImapFlowLike

---

### Task 1: Add review action test through Monitor (F5 — review)

**Files:**
- Modify: `test/unit/monitor/monitor.test.ts`

**Step 1: Write the failing test**

Append to the existing `describe('Monitor')` block in `test/unit/monitor/monitor.test.ts`:

```typescript
  it('review action moves message to Review folder', async () => {
    const rule = makeRule({
      id: 'review-rule',
      match: { sender: '*@example.com' },
      action: { type: 'review' },
    });
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Review me');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // Message moved to Review folder (from config.review.folder)
    expect(flow.messageMove).toHaveBeenCalledWith([1], 'Review', { uid: true });

    // Activity logged with source 'arrival' and action 'review'
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('review');
    expect(entries[0].folder).toBe('Review');
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('review-rule');

    await client.disconnect();
  });
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run test/unit/monitor/monitor.test.ts`
Expected: PASS — the review action case already exists in `src/actions/index.ts` and the Monitor already wires it correctly.

**Step 3: Commit**

```bash
git add test/unit/monitor/monitor.test.ts
git commit -m "test(monitor): add review action integration test (F5 — review)"
```

---

### Task 2: Add skip action test through Monitor (F5 — skip)

**Files:**
- Modify: `test/unit/monitor/monitor.test.ts`

**Step 1: Write the test**

Append to the `describe('Monitor')` block:

```typescript
  it('skip action leaves message in INBOX with no IMAP move', async () => {
    const rule = makeRule({
      id: 'skip-rule',
      match: { sender: '*@example.com' },
      action: { type: 'skip' },
    });
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Leave me');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // No move — skip doesn't touch IMAP
    expect(flow.messageMove).not.toHaveBeenCalled();

    // Activity logged with action 'skip' and no folder
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('skip');
    expect(entries[0].folder).toBeNull();
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('skip-rule');

    await client.disconnect();
  });
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run test/unit/monitor/monitor.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/unit/monitor/monitor.test.ts
git commit -m "test(monitor): add skip action integration test (F5 — skip)"
```

---

### Task 3: Add delete action test through Monitor (F5 — delete)

**Files:**
- Modify: `test/unit/monitor/monitor.test.ts`

**Step 1: Write the test**

Append to the `describe('Monitor')` block:

```typescript
  it('delete action moves message to Trash folder', async () => {
    const rule = makeRule({
      id: 'delete-rule',
      match: { sender: '*@example.com' },
      action: { type: 'delete' },
    });
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Delete me');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // Message moved to Trash (from config.review.trashFolder)
    expect(flow.messageMove).toHaveBeenCalledWith([1], 'Trash', { uid: true });

    // Activity logged with action 'delete'
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('delete');
    expect(entries[0].folder).toBe('Trash');
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('delete-rule');

    await client.disconnect();
  });
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run test/unit/monitor/monitor.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/unit/monitor/monitor.test.ts
git commit -m "test(monitor): add delete action integration test (F5 — delete)"
```

---

### Task 4: Verify full test suite and TypeScript compilation

**Files:** None — verification only.

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (208 existing + 3 new = 211).

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Final commit if any cleanup needed**

Only commit if adjustments were needed. Otherwise, F5 is satisfied by Tasks 1-3.
