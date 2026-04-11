# ReviewSweeper (Section E) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `ReviewSweeper` that periodically scans the Review mailbox folder, identifies messages past their age threshold, resolves where each should go (archive folder from rules, or trash, or global default), moves them, and logs the activity with `source: 'sweep'`.

**Architecture:** Two pure functions (`isEligibleForSweep`, `resolveSweepDestination`) handle decision logic with no dependencies. A `ReviewSweeper` class owns a repeating timer, fetches the Review folder contents via `ImapClient.withMailboxSwitch`, runs the pure functions over each message, executes moves via `executeAction`-style IMAP calls, and logs results. A serialization guard prevents overlapping runs. State is exposed via `getState()` for the API layer.

**Tech Stack:** TypeScript, Vitest, pino logger, `ImapClient` (withMailboxSwitch, moveMessage, fetchAllMessages), `ActivityLog` (logActivity with sweep source), `evaluateRules` from rules module, `reviewMessageToEmailMessage` from imap/messages

---

### Task 1: Create `SweepDeps` and `SweepState` interfaces (E1)

**Files:**
- Create: `src/sweep/index.ts`

**Step 1: Write the failing test**

Create `test/unit/sweep/sweep.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SweepDeps, SweepState } from '../../../src/sweep/index.js';

describe('SweepDeps and SweepState', () => {
  it('SweepState has the expected shape', () => {
    const state: SweepState = {
      folder: 'Review',
      totalMessages: 0,
      unreadMessages: 0,
      readMessages: 0,
      nextSweepAt: null,
      lastSweep: null,
    };
    expect(state.folder).toBe('Review');
    expect(state.lastSweep).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: FAIL — module `src/sweep/index.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/sweep/index.ts`:

```typescript
import type { ImapClient } from '../imap/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Rule, ReviewConfig } from '../config/index.js';
import type pino from 'pino';

export interface SweepDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  rules: Rule[];
  reviewConfig: ReviewConfig;
  trashFolder: string;
  logger?: pino.Logger;
}

export interface SweepState {
  folder: string;
  totalMessages: number;
  unreadMessages: number;
  readMessages: number;
  nextSweepAt: string | null;
  lastSweep: {
    completedAt: string;
    messagesArchived: number;
    errors: number;
  } | null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sweep/index.ts test/unit/sweep/sweep.test.ts
git commit -m "feat(sweep): add SweepDeps and SweepState interfaces (E1)"
```

---

### Task 2: Implement `isEligibleForSweep` pure function (E2)

**Files:**
- Modify: `src/sweep/index.ts`
- Modify: `test/unit/sweep/sweep.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/sweep/sweep.test.ts`:

```typescript
import { isEligibleForSweep } from '../../../src/sweep/index.js';
import type { SweepConfig } from '../../../src/config/index.js';
import type { ReviewMessage } from '../../../src/imap/index.js';

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 1,
    flags: new Set<string>(),
    internalDate: new Date('2026-03-01T00:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Test',
      messageId: '<msg-1@example.com>',
    },
    ...overrides,
  };
}

const defaultSweepConfig: SweepConfig = {
  intervalHours: 6,
  readMaxAgeDays: 7,
  unreadMaxAgeDays: 14,
};

describe('isEligibleForSweep', () => {
  const now = new Date('2026-04-01T00:00:00Z');

  it('read message older than readMaxAgeDays is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-20T00:00:00Z'), // 12 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('read message younger than readMaxAgeDays is not eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-28T00:00:00Z'), // 4 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(false);
  });

  it('unread message older than unreadMaxAgeDays is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-10T00:00:00Z'), // 22 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('unread message younger than unreadMaxAgeDays is not eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-25T00:00:00Z'), // 7 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(false);
  });

  it('read message exactly at readMaxAgeDays boundary is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-25T00:00:00Z'), // exactly 7 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('unread message exactly at unreadMaxAgeDays boundary is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-18T00:00:00Z'), // exactly 14 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: FAIL — `isEligibleForSweep` is not exported.

**Step 3: Write minimal implementation**

Add to `src/sweep/index.ts`:

```typescript
import type { SweepConfig } from '../config/index.js';
import type { ReviewMessage } from '../imap/index.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isEligibleForSweep(
  message: ReviewMessage,
  config: SweepConfig,
  now: Date,
): boolean {
  const ageDays = (now.getTime() - message.internalDate.getTime()) / MS_PER_DAY;
  const isRead = message.flags.has('\\Seen');
  const threshold = isRead ? config.readMaxAgeDays : config.unreadMaxAgeDays;
  return ageDays >= threshold;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sweep/index.ts test/unit/sweep/sweep.test.ts
git commit -m "feat(sweep): implement isEligibleForSweep pure function (E2)"
```

---

### Task 3: Implement `resolveSweepDestination` pure function (E3)

**Files:**
- Modify: `src/sweep/index.ts`
- Modify: `test/unit/sweep/sweep.test.ts`

The resolution logic is a 3-step priority chain:
1. Find first matching rule with `move` or `delete` action → use that action's folder (or trash for delete)
2. Find first matching rule with `review` action that has a `folder` → use that folder
3. Fall back to `defaultArchiveFolder`
4. Rules with `skip` action are filtered out entirely

**Step 1: Write the failing tests**

Append to `test/unit/sweep/sweep.test.ts`:

```typescript
import { resolveSweepDestination } from '../../../src/sweep/index.js';
import { reviewMessageToEmailMessage } from '../../../src/imap/index.js';
import type { Rule } from '../../../src/config/index.js';

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive/Lists' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

describe('resolveSweepDestination', () => {
  const defaultArchiveFolder = 'MailingLists';

  it('returns move rule folder when move rule matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'move', folder: 'Archive/OSS' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'Archive/OSS' });
  });

  it('returns trash destination when delete rule matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'delete' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'delete' });
  });

  it('returns review rule folder when review rule with folder matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'review', folder: 'Review/Important' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'Review/Important' });
  });

  it('returns default archive folder when review rule without folder matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'review' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'MailingLists' });
  });

  it('filters out skip rules', () => {
    const msg = makeReviewMessage();
    const rules = [
      makeRule({ id: 'skip-rule', order: 0, action: { type: 'skip' } }),
      makeRule({ id: 'move-rule', order: 1, action: { type: 'move', folder: 'Archive' } }),
    ];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'Archive' });
  });

  it('returns default archive folder when no rule matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ match: { sender: '*@other.com' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'MailingLists' });
  });

  it('respects rule priority ordering', () => {
    const msg = makeReviewMessage();
    const rules = [
      makeRule({ id: 'r2', order: 2, action: { type: 'move', folder: 'Second' } }),
      makeRule({ id: 'r1', order: 1, action: { type: 'move', folder: 'First' } }),
    ];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'First' });
  });

  it('skip-only rules fall through to default archive', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'skip' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result).toEqual({ type: 'move', folder: 'MailingLists' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: FAIL — `resolveSweepDestination` is not exported.

**Step 3: Write minimal implementation**

Add to `src/sweep/index.ts`:

```typescript
import type { EmailMessage } from '../imap/index.js';
import { reviewMessageToEmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';

export type SweepDestination =
  | { type: 'move'; folder: string }
  | { type: 'delete' };

export function resolveSweepDestination(
  message: ReviewMessage,
  rules: Rule[],
  defaultArchiveFolder: string,
): SweepDestination {
  // Filter out skip rules, then evaluate
  const candidates = rules.filter((r) => r.action.type !== 'skip');
  const emailMsg = reviewMessageToEmailMessage(message);
  const matched = evaluateRules(candidates, emailMsg);

  if (!matched) {
    return { type: 'move', folder: defaultArchiveFolder };
  }

  switch (matched.action.type) {
    case 'move':
      return { type: 'move', folder: matched.action.folder };
    case 'delete':
      return { type: 'delete' };
    case 'review': {
      const folder = matched.action.folder ?? defaultArchiveFolder;
      return { type: 'move', folder };
    }
    default:
      return { type: 'move', folder: defaultArchiveFolder };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sweep/index.ts test/unit/sweep/sweep.test.ts
git commit -m "feat(sweep): implement resolveSweepDestination pure function (E3)"
```

---

### Task 4: Implement `ReviewSweeper` class — constructor, `getState()`, `start()`, `stop()`, `restart()` (E4, E5, E6)

**Files:**
- Modify: `src/sweep/index.ts`
- Modify: `test/unit/sweep/sweep.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/sweep/sweep.test.ts`:

```typescript
import { vi, beforeEach, afterEach } from 'vitest';
import { ReviewSweeper } from '../../../src/sweep/index.js';
import type { ImapClient } from '../../../src/imap/index.js';
import type { ActivityLog } from '../../../src/log/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeMockClient(): ImapClient {
  return {
    state: 'connected',
    withMailboxSwitch: vi.fn().mockResolvedValue([]),
    fetchAllMessages: vi.fn().mockResolvedValue([]),
    moveMessage: vi.fn().mockResolvedValue(undefined),
    createMailbox: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient;
}

function makeMockActivityLog(): ActivityLog {
  return {
    logActivity: vi.fn(),
  } as unknown as ActivityLog;
}

describe('ReviewSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getState returns initial state before any sweep', () => {
    const sweeper = new ReviewSweeper({
      client: makeMockClient(),
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    const state = sweeper.getState();
    expect(state.folder).toBe('Review');
    expect(state.totalMessages).toBe(0);
    expect(state.unreadMessages).toBe(0);
    expect(state.readMessages).toBe(0);
    expect(state.lastSweep).toBeNull();
    expect(state.nextSweepAt).toBeNull();
  });

  it('start schedules first sweep after 30s delay', () => {
    const client = makeMockClient();
    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();

    // nextSweepAt should be set
    const state = sweeper.getState();
    expect(state.nextSweepAt).not.toBeNull();

    // fetchAllMessages should not have been called yet
    expect(client.fetchAllMessages).not.toHaveBeenCalled();

    // After 30s, the sweep should run
    vi.advanceTimersByTime(30_000);
    // fetchAllMessages is called via withMailboxSwitch — the mock returns []
    // so no moves happen, but the sweep ran
  });

  it('stop clears timers and nulls nextSweepAt', () => {
    const sweeper = new ReviewSweeper({
      client: makeMockClient(),
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();
    expect(sweeper.getState().nextSweepAt).not.toBeNull();

    sweeper.stop();
    expect(sweeper.getState().nextSweepAt).toBeNull();
  });

  it('restart stops then starts again', () => {
    const sweeper = new ReviewSweeper({
      client: makeMockClient(),
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();
    const firstNext = sweeper.getState().nextSweepAt;

    // Advance a bit so next timestamp changes
    vi.advanceTimersByTime(5_000);
    sweeper.restart();
    const secondNext = sweeper.getState().nextSweepAt;

    expect(secondNext).not.toBeNull();
    expect(secondNext).not.toBe(firstNext);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: FAIL — `ReviewSweeper` is not exported.

**Step 3: Write minimal implementation**

Add to `src/sweep/index.ts`:

```typescript
import pinoLib from 'pino';

const INITIAL_DELAY_MS = 30_000;

export class ReviewSweeper {
  private readonly client: ImapClient;
  private readonly activityLog: ActivityLog;
  private rules: Rule[];
  private readonly reviewConfig: ReviewConfig;
  private readonly trashFolder: string;
  private readonly logger: pinoLib.Logger;

  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private state: SweepState;

  constructor(deps: SweepDeps) {
    this.client = deps.client;
    this.activityLog = deps.activityLog;
    this.rules = deps.rules;
    this.reviewConfig = deps.reviewConfig;
    this.trashFolder = deps.trashFolder;
    this.logger = deps.logger ?? pinoLib({ name: 'sweep' });

    this.state = {
      folder: this.reviewConfig.folder,
      totalMessages: 0,
      unreadMessages: 0,
      readMessages: 0,
      nextSweepAt: null,
      lastSweep: null,
    };
  }

  getState(): SweepState {
    return { ...this.state };
  }

  updateRules(rules: Rule[]): void {
    this.rules = rules;
  }

  start(): void {
    this.stop();

    const intervalMs = this.reviewConfig.sweep.intervalHours * 60 * 60 * 1000;

    this.state.nextSweepAt = new Date(Date.now() + INITIAL_DELAY_MS).toISOString();

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.runSweep();

      this.state.nextSweepAt = new Date(Date.now() + intervalMs).toISOString();
      this.intervalTimer = setInterval(() => {
        this.state.nextSweepAt = new Date(Date.now() + intervalMs).toISOString();
        this.runSweep();
      }, intervalMs);
    }, INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.state.nextSweepAt = null;
  }

  restart(): void {
    this.stop();
    this.start();
  }

  // runSweep stub — implemented in next task
  async runSweep(): Promise<void> {
    // placeholder
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sweep/index.ts test/unit/sweep/sweep.test.ts
git commit -m "feat(sweep): add ReviewSweeper class with start/stop/restart (E4-E6)"
```

---

### Task 5: Implement `runSweep` with serialization guard and error handling (E7, E8, E9)

**Files:**
- Modify: `src/sweep/index.ts`
- Modify: `test/unit/sweep/sweep.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/sweep/sweep.test.ts`:

```typescript
describe('ReviewSweeper.runSweep', () => {
  it('fetches review folder, moves eligible messages, logs with sweep source', async () => {
    const oldMsg = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old, read
    });
    const youngMsg = makeReviewMessage({
      uid: 20,
      flags: new Set(),
      internalDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
    });

    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([oldMsg, youngMsg]);

    const activityLog = makeMockActivityLog();
    const rules: Rule[] = [];

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules,
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    // Only oldMsg should be moved (to default archive since no rules match)
    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(10, 'MailingLists', 'Review');

    // Activity logged with 'sweep' source
    expect(activityLog.logActivity).toHaveBeenCalledTimes(1);
    expect(activityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, messageUid: 10, action: 'move', folder: 'MailingLists' }),
      expect.objectContaining({ uid: 10 }),
      null,
      'sweep',
    );

    // State updated
    const state = sweeper.getState();
    expect(state.totalMessages).toBe(2);
    expect(state.readMessages).toBe(1);
    expect(state.unreadMessages).toBe(1);
    expect(state.lastSweep).not.toBeNull();
    expect(state.lastSweep!.messagesArchived).toBe(1);
    expect(state.lastSweep!.errors).toBe(0);
  });

  it('resolves destination via matching rule', async () => {
    const oldMsg = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([oldMsg]);

    const rules = [makeRule({ action: { type: 'move', folder: 'Archive/OSS' } })];

    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules,
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    expect(client.moveMessage).toHaveBeenCalledWith(10, 'Archive/OSS', 'Review');
  });

  it('resolves delete destination to trash folder', async () => {
    const oldMsg = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([oldMsg]);

    const rules = [makeRule({ action: { type: 'delete' } })];

    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules,
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    expect(client.moveMessage).toHaveBeenCalledWith(10, 'Trash', 'Review');
  });

  it('skips cycle when already running (serialization guard)', async () => {
    const client = makeMockClient();
    // Make fetchAllMessages take time to resolve
    let resolveFetch!: (value: ReviewMessage[]) => void;
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    // Start first sweep (will hang on fetchAllMessages)
    const first = sweeper.runSweep();

    // Start second sweep while first is running — should be skipped
    const second = sweeper.runSweep();
    await second;

    // fetchAllMessages should only be called once (the second call was skipped)
    expect(client.fetchAllMessages).toHaveBeenCalledTimes(1);

    // Resolve the first sweep
    resolveFetch([]);
    await first;
  });

  it('continues processing remaining messages when one move fails', async () => {
    const msg1 = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const msg2 = makeReviewMessage({
      uid: 20,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([msg1, msg2]);
    (client.moveMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Move failed'))
      .mockResolvedValueOnce(undefined);

    const activityLog = makeMockActivityLog();

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    // Both messages attempted
    expect(client.moveMessage).toHaveBeenCalledTimes(2);
    // Both logged
    expect(activityLog.logActivity).toHaveBeenCalledTimes(2);

    // State reflects 1 archived and 1 error
    const state = sweeper.getState();
    expect(state.lastSweep!.messagesArchived).toBe(1);
    expect(state.lastSweep!.errors).toBe(1);
  });

  it('skips sweep when client is disconnected', async () => {
    const client = makeMockClient();
    Object.defineProperty(client, 'state', { value: 'disconnected' });

    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    expect(client.fetchAllMessages).not.toHaveBeenCalled();
  });

  it('handles empty review folder gracefully', async () => {
    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const sweeper = new ReviewSweeper({
      client,
      activityLog: makeMockActivityLog(),
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    const state = sweeper.getState();
    expect(state.totalMessages).toBe(0);
    expect(state.lastSweep).not.toBeNull();
    expect(state.lastSweep!.messagesArchived).toBe(0);
    expect(state.lastSweep!.errors).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: FAIL — `runSweep` is a stub that does nothing.

**Step 3: Write minimal implementation**

Replace the `runSweep` stub in `src/sweep/index.ts` with the full implementation:

```typescript
  async runSweep(): Promise<void> {
    // Serialization guard
    if (this.running) {
      this.logger.debug('Sweep already running, skipping');
      return;
    }

    // Connection check
    if (this.client.state !== 'connected') {
      this.logger.debug('Client not connected, skipping sweep');
      return;
    }

    this.running = true;
    const now = new Date();
    let archived = 0;
    let errors = 0;

    try {
      const messages = await this.client.fetchAllMessages(this.reviewConfig.folder);

      // Update folder stats
      const readCount = messages.filter((m) => m.flags.has('\\Seen')).length;
      this.state.totalMessages = messages.length;
      this.state.readMessages = readCount;
      this.state.unreadMessages = messages.length - readCount;

      for (const msg of messages) {
        if (!isEligibleForSweep(msg, this.reviewConfig.sweep, now)) {
          continue;
        }

        const dest = resolveSweepDestination(msg, this.rules, this.reviewConfig.defaultArchiveFolder);
        const folder = dest.type === 'delete' ? this.trashFolder : dest.folder;
        const emailMsg = reviewMessageToEmailMessage(msg);

        try {
          await this.client.moveMessage(msg.uid, folder, this.reviewConfig.folder);

          const result = {
            success: true,
            messageUid: msg.uid,
            messageId: msg.envelope.messageId,
            action: dest.type === 'delete' ? 'delete' : 'move',
            folder,
            rule: '',
            timestamp: new Date(),
          };
          this.activityLog.logActivity(result, emailMsg, null, 'sweep');
          archived++;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.logger.error({ uid: msg.uid, error }, 'Failed to move message during sweep');

          const result = {
            success: false,
            messageUid: msg.uid,
            messageId: msg.envelope.messageId,
            action: dest.type === 'delete' ? 'delete' : 'move',
            folder,
            rule: '',
            timestamp: new Date(),
            error,
          };
          this.activityLog.logActivity(result, emailMsg, null, 'sweep');
          errors++;
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Sweep fetch failed');
    } finally {
      this.running = false;
      this.state.lastSweep = {
        completedAt: new Date().toISOString(),
        messagesArchived: archived,
        errors,
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/sweep/sweep.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sweep/index.ts test/unit/sweep/sweep.test.ts
git commit -m "feat(sweep): implement runSweep with serialization guard and error handling (E7-E9)"
```

---

### Task 6: Integration test — sweep lifecycle (E12)

**Files:**
- Create: `test/integration/sweep.test.ts`

This test uses fake timers to verify the full lifecycle: timer fires → fetch → move → log.

**Step 1: Write the test**

Create `test/integration/sweep.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ReviewSweeper } from '../../src/sweep/index.js';
import type { ReviewMessage } from '../../src/imap/index.js';
import type { ImapClient } from '../../src/imap/index.js';
import { ActivityLog } from '../../src/log/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 1,
    flags: new Set<string>(),
    internalDate: new Date('2026-03-01T00:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Test',
      messageId: '<msg-1@example.com>',
    },
    ...overrides,
  };
}

let tmpDir: string;
let activityLog: ActivityLog;

beforeEach(() => {
  vi.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailmgr-sweep-'));
  activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
});

afterEach(() => {
  vi.useRealTimers();
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Sweep lifecycle integration', () => {
  it('timer fires → fetches review folder → moves eligible → logs to DB', async () => {
    const oldMsg = makeReviewMessage({
      uid: 5,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([oldMsg]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();

    // Advance past initial 30s delay
    await vi.advanceTimersByTimeAsync(30_000);

    // Verify fetch and move happened
    expect(client.fetchAllMessages).toHaveBeenCalledWith('Review');
    expect(client.moveMessage).toHaveBeenCalledWith(5, 'MailingLists', 'Review');

    // Verify activity persisted in real DB
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].message_uid).toBe(5);
    expect(entries[0].action).toBe('move');
    expect(entries[0].folder).toBe('MailingLists');
    expect(entries[0].source).toBe('sweep');

    // Verify state
    const state = sweeper.getState();
    expect(state.lastSweep).not.toBeNull();
    expect(state.lastSweep!.messagesArchived).toBe(1);

    sweeper.stop();
  });

  it('repeated timer fires produce multiple sweeps', async () => {
    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();

    // Initial sweep after 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.fetchAllMessages).toHaveBeenCalledTimes(1);

    // Second sweep after 1 hour
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(client.fetchAllMessages).toHaveBeenCalledTimes(2);

    sweeper.stop();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run test/integration/sweep.test.ts`
Expected: PASS (this test exercises the full integration from Task 5's implementation).

**Step 3: Commit**

```bash
git add test/integration/sweep.test.ts
git commit -m "test(sweep): add lifecycle integration tests (E12-E14)"
```

---

### Task 7: Run full test suite and verify TypeScript compilation

**Files:** None — verification only.

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit if any cleanup was needed**

Only commit if adjustments were required.
