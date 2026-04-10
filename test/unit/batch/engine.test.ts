import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Rule } from '../../../src/config/index.js';
import type { ImapClient, ReviewMessage } from '../../../src/imap/index.js';
import type { ActivityLog } from '../../../src/log/index.js';
import pino from 'pino';

vi.mock('../../../src/rules/index.js', () => ({
  evaluateRules: vi.fn(),
}));

vi.mock('../../../src/sweep/index.js', () => ({
  isEligibleForSweep: vi.fn(),
  resolveSweepDestination: vi.fn(),
  processSweepMessage: vi.fn(),
}));

import { BatchEngine } from '../../../src/batch/index.js';
import type { BatchDeps, BatchState, DryRunGroup } from '../../../src/batch/index.js';
import { evaluateRules } from '../../../src/rules/index.js';
import { isEligibleForSweep, resolveSweepDestination, processSweepMessage } from '../../../src/sweep/index.js';

const mockedIsEligible = vi.mocked(isEligibleForSweep);
const mockedResolveSweep = vi.mocked(resolveSweepDestination);
const mockedProcessSweepMessage = vi.mocked(processSweepMessage);

const silentLogger = pino({ level: 'silent' });

const mockedEvaluateRules = vi.mocked(evaluateRules);

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 1,
    flags: new Set<string>(),
    internalDate: new Date('2026-03-01T00:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Test Subject',
      messageId: '<msg-1@example.com>',
    },
    ...overrides,
  };
}

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

function makeMockClient(): ImapClient {
  return {
    state: 'connected',
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

function makeDeps(overrides: Partial<BatchDeps> = {}): BatchDeps {
  return {
    client: makeMockClient(),
    activityLog: makeMockActivityLog(),
    rules: [makeRule()],
    trashFolder: 'Trash',
    logger: silentLogger,
    reviewFolder: 'Review',
    reviewConfig: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
    },
    ...overrides,
  };
}

function makeMessages(count: number): ReviewMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeReviewMessage({
      uid: i + 1,
      envelope: {
        from: { name: `Sender ${i}`, address: `sender${i}@example.com` },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        subject: `Message ${i + 1}`,
        messageId: `<msg-${i + 1}@example.com>`,
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BatchEngine state machine', () => {
  it('initial state is idle', () => {
    const engine = new BatchEngine(makeDeps());
    const state = engine.getState();
    expect(state.status).toBe('idle');
    expect(state.totalMessages).toBe(0);
    expect(state.processed).toBe(0);
    expect(state.moved).toBe(0);
    expect(state.skipped).toBe(0);
    expect(state.errors).toBe(0);
    expect(state.cancelled).toBe(false);
    expect(state.dryRunResults).toBeNull();
    expect(state.completedAt).toBeNull();
    expect(state.sourceFolder).toBeNull();
  });

  it('dryRun transitions: idle -> dry-running -> previewing', async () => {
    const deps = makeDeps();
    const messages = makeMessages(2);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    await engine.dryRun('TestFolder');

    const state = engine.getState();
    expect(state.status).toBe('previewing');
  });

  it('execute transitions: idle -> executing -> completed', async () => {
    const deps = makeDeps();
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const engine = new BatchEngine(deps);
    const result = await engine.execute('TestFolder');
    expect(result.status).toBe('completed');

    const state = engine.getState();
    expect(state.status).toBe('completed');
  });

  it('dryRun sets status to error on failure', async () => {
    const deps = makeDeps();
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IMAP error'));

    const engine = new BatchEngine(deps);
    await expect(engine.dryRun('TestFolder')).rejects.toThrow('IMAP error');

    const state = engine.getState();
    expect(state.status).toBe('error');
  });

  it('execute transitions to error on fetch failure', async () => {
    const deps = makeDeps();
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fetch failed'));

    const engine = new BatchEngine(deps);
    const result = await engine.execute('TestFolder');
    expect(result.status).toBe('error');
  });
});

describe('BatchEngine running guard', () => {
  it('calling execute while already executing throws', async () => {
    const deps = makeDeps();
    let resolveFetch!: (value: ReviewMessage[]) => void;
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const engine = new BatchEngine(deps);
    const first = engine.execute('TestFolder');

    await expect(engine.execute('TestFolder')).rejects.toThrow('Batch already running');

    resolveFetch([]);
    await first;
  });

  it('calling dryRun while already running throws', async () => {
    const deps = makeDeps();
    let resolveFetch!: (value: ReviewMessage[]) => void;
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const engine = new BatchEngine(deps);
    const first = engine.execute('TestFolder');

    await expect(engine.dryRun('TestFolder')).rejects.toThrow('Batch already running');

    resolveFetch([]);
    await first;
  });
});

describe('BATC-01: evaluates all messages', () => {
  it('dryRun fetches messages from source folder and evaluates each', async () => {
    const deps = makeDeps();
    const messages = makeMessages(3);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    await engine.dryRun('TestFolder');

    expect(deps.client.fetchAllMessages).toHaveBeenCalledWith('TestFolder');
    expect(mockedEvaluateRules).toHaveBeenCalledTimes(3);
  });

  it('execute fetches messages from source folder and processes each', async () => {
    const deps = makeDeps();
    const messages = makeMessages(2);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule();
    mockedEvaluateRules.mockReturnValue(rule);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    expect(deps.client.fetchAllMessages).toHaveBeenCalledWith('TestFolder');
    expect(mockedEvaluateRules).toHaveBeenCalledTimes(2);
    expect(deps.client.moveMessage).toHaveBeenCalledTimes(2);
  });
});

describe('BATC-02: first-match-wins without age constraints', () => {
  it('only first matching rule action is applied', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const firstRule = makeRule({ id: 'first', name: 'First Rule', order: 1, action: { type: 'move', folder: 'Archive/Lists' } });
    mockedEvaluateRules.mockReturnValue(firstRule);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    expect(deps.client.moveMessage).toHaveBeenCalledWith(1, 'Archive/Lists', 'TestFolder');
  });

  it('processes all messages regardless of age (no isEligibleForSweep)', async () => {
    const deps = makeDeps();
    const oldMsg = makeReviewMessage({
      uid: 1,
      internalDate: new Date('2020-01-01T00:00:00Z'), // very old
    });
    const newMsg = makeReviewMessage({
      uid: 2,
      internalDate: new Date('2026-04-01T00:00:00Z'), // very new
    });
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([oldMsg, newMsg]);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    // Both messages processed regardless of age
    expect(mockedEvaluateRules).toHaveBeenCalledTimes(2);
    const state = engine.getState();
    expect(state.processed).toBe(2);
  });
});

describe('BATC-03: chunked execution with per-message error isolation', () => {
  it('processes 60 messages in chunks with setImmediate between them', async () => {
    const deps = makeDeps();
    const messages = makeMessages(60);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null); // all skip

    const originalSetImmediate = globalThis.setImmediate;
    const setImmediateSpy = vi.fn((fn: () => void) => originalSetImmediate(fn));
    globalThis.setImmediate = setImmediateSpy as unknown as typeof setImmediate;

    try {
      const engine = new BatchEngine(deps);
      await engine.execute('TestFolder');

      // 60 messages / 25 chunk = 3 chunks. setImmediate called between chunks (2 times for first 2 chunks)
      expect(setImmediateSpy).toHaveBeenCalled();
      expect(setImmediateSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.setImmediate = originalSetImmediate;
    }
  });

  it('per-message error isolation: failed message increments errors, others still process', async () => {
    const deps = makeDeps();
    const messages = makeMessages(3);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule();
    mockedEvaluateRules.mockReturnValue(rule);
    (deps.client.moveMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('IMAP timeout'))
      .mockResolvedValueOnce(undefined);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    const state = engine.getState();
    expect(state.processed).toBe(3);
    expect(state.moved).toBe(2);
    expect(state.errors).toBe(1);
    expect(state.status).toBe('completed');
  });

  it('state.processed increments for each message', async () => {
    const deps = makeDeps();
    const messages = makeMessages(5);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    const state = engine.getState();
    expect(state.processed).toBe(5);
    expect(state.skipped).toBe(5);
  });

  it('counts failed moves as errors', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule();
    mockedEvaluateRules.mockReturnValue(rule);
    (deps.client.moveMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Move failed'));

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    const state = engine.getState();
    expect(state.errors).toBe(1);
    expect(state.moved).toBe(0);
  });
});

describe('BATC-05: cancel stops after current chunk', () => {
  it('cancel stops processing and sets status to cancelled', async () => {
    const deps = makeDeps();
    const messages = makeMessages(60);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);

    // We need to cancel between chunks. Hook into setImmediate to cancel.
    const originalSetImmediate = globalThis.setImmediate;
    let callCount = 0;
    globalThis.setImmediate = ((fn: () => void) => {
      callCount++;
      if (callCount === 1) {
        // Cancel after first chunk completes
        engine.cancel();
      }
      return originalSetImmediate(fn);
    }) as unknown as typeof setImmediate;

    try {
      const result = await engine.execute('TestFolder');
      expect(result.status).toBe('cancelled');

      const state = engine.getState();
      expect(state.status).toBe('cancelled');
      // Should have processed first chunk (25) + second chunk (25, since cancel is checked between chunks)
      // Cancel after first chunk -> second chunk won't start
      expect(state.processed).toBeLessThan(60);
    } finally {
      globalThis.setImmediate = originalSetImmediate;
    }
  });

  it('already-moved messages stay moved (no undo)', async () => {
    const deps = makeDeps();
    const messages = makeMessages(30);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule();
    mockedEvaluateRules.mockReturnValue(rule);

    const engine = new BatchEngine(deps);

    const originalSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = ((fn: () => void) => {
      engine.cancel();
      return originalSetImmediate(fn);
    }) as unknown as typeof setImmediate;

    try {
      const result = await engine.execute('TestFolder');
      // First chunk of 25 should have been processed
      expect(result.moved).toBeGreaterThan(0);
      // No undo mechanism — moves are permanent
      expect(result.status).toBe('cancelled');
    } finally {
      globalThis.setImmediate = originalSetImmediate;
    }
  });
});

describe('BATC-06: dry-run mode', () => {
  it('dryRun does NOT call moveMessage', async () => {
    const deps = makeDeps();
    const messages = makeMessages(3);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(makeRule());

    const engine = new BatchEngine(deps);
    await engine.dryRun('TestFolder');

    expect(deps.client.moveMessage).not.toHaveBeenCalled();
  });

  it('dryRun returns DryRunGroup[] with destination, action, count, messages', async () => {
    const deps = makeDeps();
    const messages = makeMessages(2);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule({ name: 'Move Rule', action: { type: 'move', folder: 'Archive/Lists' } });
    mockedEvaluateRules.mockReturnValue(rule);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('TestFolder');

    expect(groups.length).toBeGreaterThan(0);
    const group = groups[0];
    expect(group.destination).toBe('Archive/Lists');
    expect(group.action).toBe('move');
    expect(group.count).toBe(2);
    expect(group.messages).toHaveLength(2);
    expect(group.messages[0]).toHaveProperty('uid');
    expect(group.messages[0]).toHaveProperty('from');
    expect(group.messages[0]).toHaveProperty('subject');
    expect(group.messages[0]).toHaveProperty('date');
    expect(group.messages[0]).toHaveProperty('ruleName');
  });

  it('unmatched messages grouped as no-match', async () => {
    const deps = makeDeps();
    const messages = makeMessages(2);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('TestFolder');

    const noMatch = groups.find((g) => g.action === 'no-match');
    expect(noMatch).toBeDefined();
    expect(noMatch!.destination).toBe('No match');
    expect(noMatch!.count).toBe(2);
  });

  it('groups include per-message detail with ruleName', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule({ name: 'My Named Rule' });
    mockedEvaluateRules.mockReturnValue(rule);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('TestFolder');

    expect(groups[0].messages[0].ruleName).toBe('My Named Rule');
  });

  it('dryRun groups by action type and destination', async () => {
    const deps = makeDeps();
    const messages = makeMessages(3);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);

    const moveRule = makeRule({ name: 'Move Rule', action: { type: 'move', folder: 'Archive/Lists' } });
    const deleteRule = makeRule({ name: 'Delete Rule', action: { type: 'delete' } });
    mockedEvaluateRules
      .mockReturnValueOnce(moveRule)
      .mockReturnValueOnce(deleteRule)
      .mockReturnValueOnce(moveRule);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('TestFolder');

    // Should have 2 groups: move to Archive/Lists, delete to Trash
    expect(groups.length).toBe(2);
    const moveGroup = groups.find((g) => g.action === 'move');
    const deleteGroup = groups.find((g) => g.action === 'delete');
    expect(moveGroup!.count).toBe(2);
    expect(deleteGroup!.count).toBe(1);
  });
});

describe('BatchEngine getState and updateRules', () => {
  it('getState returns a copy, not a reference', () => {
    const engine = new BatchEngine(makeDeps());
    const state1 = engine.getState();
    const state2 = engine.getState();
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2);
  });

  it('updateRules replaces the internal rules array', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);

    const newRule = makeRule({ id: 'new-rule', name: 'New Rule' });
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    engine.updateRules([newRule]);
    await engine.dryRun('TestFolder');

    // evaluateRules should be called with the new rules
    expect(mockedEvaluateRules).toHaveBeenCalledWith([newRule], expect.anything());
  });
});

describe('BatchEngine logActivity', () => {
  it('logs activity with batch source on successful execute', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const rule = makeRule();
    mockedEvaluateRules.mockReturnValue(rule);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    expect(deps.activityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, action: 'move', folder: 'Archive/Lists' }),
      expect.anything(),
      rule,
      'batch',
    );
  });
});

describe('BatchEngine review rule resolution', () => {
  it('review rules with folder resolve to that folder, not the review folder', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const reviewRule = makeRule({ name: 'Review Rule', action: { type: 'review', folder: 'Newsletters' } });
    mockedEvaluateRules.mockReturnValue(reviewRule);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    expect(deps.client.moveMessage).toHaveBeenCalledWith(1, 'Newsletters', 'TestFolder');
  });

  it('review rules without folder are skipped (message stays in source folder)', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const reviewRule = makeRule({ name: 'Review Rule', action: { type: 'review' } });
    mockedEvaluateRules.mockReturnValue(reviewRule);

    const engine = new BatchEngine(deps);
    await engine.execute('TestFolder');

    expect(deps.client.moveMessage).not.toHaveBeenCalled();
    const state = engine.getState();
    expect(state.skipped).toBe(1);
    expect(state.moved).toBe(0);
  });

  it('dry-run shows final destination for review rules, not review folder', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const reviewRule = makeRule({ name: 'Review Rule', action: { type: 'review', folder: 'Newsletters' } });
    mockedEvaluateRules.mockReturnValue(reviewRule);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('TestFolder');

    expect(groups[0].destination).toBe('Newsletters');
  });
});

describe('BatchEngine INBOX mode', () => {
  it('review actions route to review folder when source is INBOX', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const reviewRule = makeRule({ name: 'Review Rule', action: { type: 'review', folder: 'Newsletters' } });
    mockedEvaluateRules.mockReturnValue(reviewRule);

    const engine = new BatchEngine(deps);
    await engine.execute('INBOX');

    expect(deps.client.moveMessage).toHaveBeenCalledWith(1, 'Review', 'INBOX');
  });

  it('skip actions leave message in INBOX', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const skipRule = makeRule({ name: 'Skip Rule', action: { type: 'skip' } });
    mockedEvaluateRules.mockReturnValue(skipRule);

    const engine = new BatchEngine(deps);
    await engine.execute('INBOX');

    expect(deps.client.moveMessage).not.toHaveBeenCalled();
    const state = engine.getState();
    expect(state.skipped).toBe(1);
  });

  it('no-match messages stay in INBOX', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedEvaluateRules.mockReturnValue(null);

    const engine = new BatchEngine(deps);
    await engine.execute('INBOX');

    expect(deps.client.moveMessage).not.toHaveBeenCalled();
    const state = engine.getState();
    expect(state.skipped).toBe(1);
  });

  it('move actions work normally in INBOX mode', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const moveRule = makeRule({ name: 'Move Rule', action: { type: 'move', folder: 'Archive/Lists' } });
    mockedEvaluateRules.mockReturnValue(moveRule);

    const engine = new BatchEngine(deps);
    await engine.execute('INBOX');

    expect(deps.client.moveMessage).toHaveBeenCalledWith(1, 'Archive/Lists', 'INBOX');
  });

  it('dry-run INBOX shows review folder for review actions', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    const reviewRule = makeRule({ name: 'Review Rule', action: { type: 'review', folder: 'Newsletters' } });
    mockedEvaluateRules.mockReturnValue(reviewRule);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('INBOX');

    expect(groups[0].destination).toBe('Review');
  });
});

describe('BatchEngine Review mode', () => {
  it('ineligible messages are skipped', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedIsEligible.mockReturnValue(false);

    const engine = new BatchEngine(deps);
    await engine.execute('Review');

    expect(deps.client.moveMessage).not.toHaveBeenCalled();
    const state = engine.getState();
    expect(state.skipped).toBe(1);
  });

  it('eligible messages use processSweepMessage', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedIsEligible.mockReturnValue(true);
    mockedProcessSweepMessage.mockResolvedValue({ action: 'moved', destination: 'Archive/Lists' });

    const engine = new BatchEngine(deps);
    await engine.execute('Review');

    expect(mockedProcessSweepMessage).toHaveBeenCalledWith(
      messages[0],
      expect.objectContaining({
        client: deps.client,
        trashFolder: 'Trash',
        sourceFolder: 'Review',
        source: 'batch',
        defaultArchiveFolder: 'MailingLists',
      }),
    );
    const state = engine.getState();
    expect(state.moved).toBe(1);
  });

  it('eligible delete destination routes to trash via processSweepMessage', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedIsEligible.mockReturnValue(true);
    mockedProcessSweepMessage.mockResolvedValue({ action: 'moved', destination: 'Trash' });

    const engine = new BatchEngine(deps);
    await engine.execute('Review');

    expect(mockedProcessSweepMessage).toHaveBeenCalled();
    const state = engine.getState();
    expect(state.moved).toBe(1);
  });

  it('dry-run Review shows Not yet eligible for ineligible messages', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedIsEligible.mockReturnValue(false);

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('Review');

    expect(groups[0].action).toBe('skip');
    expect(groups[0].destination).toBe('Not yet eligible');
  });

  it('dry-run Review shows resolved destination for eligible messages', async () => {
    const deps = makeDeps();
    const messages = makeMessages(1);
    (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(messages);
    mockedIsEligible.mockReturnValue(true);
    mockedResolveSweep.mockReturnValue({
      destination: { type: 'move', folder: 'Archive/Lists' },
      matchedRule: makeRule(),
    });

    const engine = new BatchEngine(deps);
    const groups = await engine.dryRun('Review');

    expect(groups[0].destination).toBe('Archive/Lists');
  });
});
