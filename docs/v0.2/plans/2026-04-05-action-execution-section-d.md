# Action Execution (Section D) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `executeAction` to accept an `ActionContext` and support review, skip, and delete action types alongside the existing move action.

**Architecture:** Introduce an `ActionContext` interface bundling the IMAP client and well-known folder paths (reviewFolder, trashFolder). The `executeAction` switch statement gains three new cases: `review` reuses `executeMove` targeting the review folder, `skip` returns success immediately with no IMAP calls, and `delete` reuses `executeMove` targeting the trash folder. The single caller in Monitor is updated to construct and pass `ActionContext`.

**Tech Stack:** TypeScript, Vitest, ImapFlow (via `ImapClient` wrapper)

---

### Task 1: Define `ActionContext` and refactor `executeAction` signature (D1, D2)

**Files:**
- Modify: `src/actions/index.ts:1-40`

**Step 1: Write the failing test**

Add new tests that call `executeAction` with the new `ActionContext` signature. The existing tests will also need updating since the signature changes.

Edit `test/unit/actions/actions.test.ts` — replace the `makeMockClient` helper and all test calls to use `ActionContext`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../../src/actions/index.js';
import type { ActionContext } from '../../../src/actions/index.js';
import type { Rule } from '../../../src/config/index.js';
import type { EmailMessage } from '../../../src/imap/index.js';
import type { ImapClient } from '../../../src/imap/index.js';

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 42,
    messageId: '<msg-42@example.com>',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    subject: 'Test message',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive/Test' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    client: {
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient,
    reviewFolder: 'Review',
    trashFolder: 'Trash',
    ...overrides,
  };
}

describe('executeAction', () => {
  it('moves a message to the target folder', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const msg = makeMessage();
    const rule = makeRule();

    const result = await executeAction(ctx, msg, rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(result.folder).toBe('Archive/Test');
    expect(result.messageUid).toBe(42);
    expect(result.messageId).toBe('<msg-42@example.com>');
    expect(result.rule).toBe('test-rule');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(moveMessage).toHaveBeenCalledWith(42, 'Archive/Test');
  });

  it('auto-creates folder and retries when move fails', async () => {
    const ctx = makeCtx({
      client: {
        moveMessage: vi.fn()
          .mockRejectedValueOnce(new Error('Mailbox not found'))
          .mockResolvedValueOnce(undefined),
        createMailbox: vi.fn().mockResolvedValue(undefined),
      } as unknown as ImapClient,
    });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(vi.mocked(ctx.client.createMailbox)).toHaveBeenCalledWith('Archive/Test');
    expect(vi.mocked(ctx.client.moveMessage)).toHaveBeenCalledTimes(2);
  });

  it('returns error when both move and folder creation fail', async () => {
    const ctx = makeCtx({
      client: {
        moveMessage: vi.fn().mockRejectedValue(new Error('Move failed')),
        createMailbox: vi.fn().mockRejectedValue(new Error('Cannot create folder')),
      } as unknown as ImapClient,
    });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.action).toBe('move');
    expect(result.error).toBe('Cannot create folder');
    expect(result.folder).toBe('Archive/Test');
  });

  it('returns error when folder is created but retry move still fails', async () => {
    const ctx = makeCtx({
      client: {
        moveMessage: vi.fn().mockRejectedValue(new Error('Persistent failure')),
        createMailbox: vi.fn().mockResolvedValue(undefined),
      } as unknown as ImapClient,
    });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Persistent failure');
  });

  it('populates all ActionResult fields correctly', async () => {
    const ctx = makeCtx();
    const msg = makeMessage({ uid: 99, messageId: '<special@test.com>' });
    const rule = makeRule({ id: 'my-rule', action: { type: 'move', folder: 'Dev/OSS' } });

    const result = await executeAction(ctx, msg, rule);

    expect(result).toMatchObject({
      success: true,
      messageUid: 99,
      messageId: '<special@test.com>',
      action: 'move',
      folder: 'Dev/OSS',
      rule: 'my-rule',
    });
    expect(result.error).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: FAIL — `ActionContext` is not exported from actions/index.js, and `executeAction` still takes `(client, message, rule)`.

**Step 3: Write minimal implementation**

Update `src/actions/index.ts`:

```typescript
import type { Action, Rule } from '../config/index.js';
import type { ImapClient } from '../imap/index.js';
import type { EmailMessage } from '../imap/index.js';

export interface ActionContext {
  client: ImapClient;
  reviewFolder: string;
  trashFolder: string;
}

export interface ActionResult {
  success: boolean;
  messageUid: number;
  messageId: string;
  action: string;
  folder?: string;
  rule: string;
  timestamp: Date;
  error?: string;
}

/**
 * Execute the action from a matched rule on a message.
 */
export async function executeAction(
  ctx: ActionContext,
  message: EmailMessage,
  rule: Rule,
): Promise<ActionResult> {
  const { action } = rule;
  const base = {
    messageUid: message.uid,
    messageId: message.messageId,
    rule: rule.id,
    timestamp: new Date(),
  };

  switch (action.type) {
    case 'move':
      return executeMove(ctx.client, message, action.folder, base);
    default:
      return { ...base, success: false, action: 'unknown', error: `Unknown action type` };
  }
}

async function executeMove(
  client: ImapClient,
  message: EmailMessage,
  folder: string,
  base: Omit<ActionResult, 'success' | 'action' | 'folder' | 'error'>,
): Promise<ActionResult> {
  try {
    await client.moveMessage(message.uid, folder);
    return { ...base, success: true, action: 'move', folder };
  } catch (firstErr) {
    try {
      await client.createMailbox(folder);
      await client.moveMessage(message.uid, folder);
      return { ...base, success: true, action: 'move', folder };
    } catch (retryErr) {
      const error = retryErr instanceof Error ? retryErr.message : String(retryErr);
      return { ...base, success: false, action: 'move', folder, error };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: PASS — all 5 existing tests pass with new signature.

**Step 5: Commit**

```bash
git add src/actions/index.ts test/unit/actions/actions.test.ts
git commit -m "feat(actions): define ActionContext and refactor executeAction signature (D1-D2)"
```

---

### Task 2: Add review case (D3)

**Files:**
- Modify: `src/actions/index.ts:34-39` (switch statement)
- Modify: `test/unit/actions/actions.test.ts` (add test)

**Step 1: Write the failing test**

Append to the `describe('executeAction')` block in `test/unit/actions/actions.test.ts`:

```typescript
  it('review action moves message to review folder', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'review' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('review');
    expect(result.folder).toBe('Review');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Review');
  });

  it('review action uses rule-specific folder when provided', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'review', folder: 'Review/Important' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('review');
    expect(result.folder).toBe('Review/Important');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Review/Important');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: FAIL — review action hits the `default` branch, returns `action: 'unknown'`.

**Step 3: Write minimal implementation**

Add to the switch statement in `executeAction`, before the `default` case:

```typescript
    case 'review': {
      const folder = action.folder ?? ctx.reviewFolder;
      return executeMove(ctx.client, message, folder, base).then((r) => ({ ...r, action: 'review' }));
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/actions/index.ts test/unit/actions/actions.test.ts
git commit -m "feat(actions): add review action case (D3)"
```

---

### Task 3: Add skip case (D4)

**Files:**
- Modify: `src/actions/index.ts` (switch statement)
- Modify: `test/unit/actions/actions.test.ts` (add test)

**Step 1: Write the failing test**

```typescript
  it('skip action returns success without any IMAP calls', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const createMailbox = vi.mocked(ctx.client.createMailbox);
    const rule = makeRule({ action: { type: 'skip' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('skip');
    expect(result.folder).toBeUndefined();
    expect(moveMessage).not.toHaveBeenCalled();
    expect(createMailbox).not.toHaveBeenCalled();
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: FAIL — skip hits default branch.

**Step 3: Write minimal implementation**

Add to switch statement:

```typescript
    case 'skip':
      return { ...base, success: true, action: 'skip' };
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/actions/index.ts test/unit/actions/actions.test.ts
git commit -m "feat(actions): add skip action case (D4)"
```

---

### Task 4: Add delete case (D5)

**Files:**
- Modify: `src/actions/index.ts` (switch statement)
- Modify: `test/unit/actions/actions.test.ts` (add test)

**Step 1: Write the failing test**

```typescript
  it('delete action moves message to trash folder', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'delete' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('delete');
    expect(result.folder).toBe('Trash');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Trash');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: FAIL — delete hits default branch.

**Step 3: Write minimal implementation**

Add to switch statement:

```typescript
    case 'delete':
      return executeMove(ctx.client, message, ctx.trashFolder, base).then((r) => ({ ...r, action: 'delete' }));
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/actions/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/actions/index.ts test/unit/actions/actions.test.ts
git commit -m "feat(actions): add delete action case (D5)"
```

---

### Task 5: Update Monitor caller (D6)

**Files:**
- Modify: `src/monitor/index.ts:1-10` (imports)
- Modify: `src/monitor/index.ts:117-154` (processMessage)
- Modify: `test/unit/monitor/monitor.test.ts` (update mock calls)

**Step 1: Read the monitor test file to understand its structure**

Read `test/unit/monitor/monitor.test.ts` to see how `executeAction` is mocked.

**Step 2: Update the monitor import and processMessage**

In `src/monitor/index.ts`, change:

```typescript
import { executeAction } from '../actions/index.js';
```
to:
```typescript
import { executeAction } from '../actions/index.js';
import type { ActionContext } from '../actions/index.js';
```

Add `reviewFolder` and `trashFolder` fields to the `Monitor` class and constructor (these will come from config). In `processMessage`, build an `ActionContext` and pass it:

```typescript
const ctx: ActionContext = {
  client: this.client,
  reviewFolder: this.reviewFolder,
  trashFolder: this.trashFolder,
};
const result = await executeAction(ctx, message, matchedRule);
```

The `reviewFolder` and `trashFolder` values come from `config.review.folder` and `config.review.trashFolder` respectively, set in the constructor.

**Step 3: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: PASS — monitor tests may need mock updates for the new signature.

**Step 4: Commit**

```bash
git add src/monitor/index.ts test/unit/monitor/monitor.test.ts
git commit -m "feat(monitor): pass ActionContext to executeAction (D6)"
```

---

### Task 6: Verify all tests pass end-to-end (D7 — covered by Tasks 1-5)

**Files:** None new — the unit tests for D7 were written inline with each action case in Tasks 1-4.

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Final commit if any cleanup needed**

Only commit if adjustments were needed. Otherwise, D7 is already satisfied by the tests written in Tasks 1-4.
