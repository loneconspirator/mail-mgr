import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isEligibleForSweep, resolveSweepDestination, ReviewSweeper } from '../../../src/sweep/index.js';
import type { SweepDeps, SweepState } from '../../../src/sweep/index.js';
import type { SweepConfig, Rule } from '../../../src/config/index.js';
import type { ReviewMessage, ImapClient } from '../../../src/imap/index.js';
import type { ActivityLog } from '../../../src/log/index.js';
import pino from 'pino';

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
    const rule = makeRule({ action: { type: 'move', folder: 'Archive/OSS' } });
    const result = resolveSweepDestination(msg, [rule], defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'Archive/OSS' });
    expect(result.matchedRule).toEqual(rule);
  });

  it('returns trash destination when delete rule matches', () => {
    const msg = makeReviewMessage();
    const rule = makeRule({ action: { type: 'delete' } });
    const result = resolveSweepDestination(msg, [rule], defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'delete' });
    expect(result.matchedRule).toEqual(rule);
  });

  it('returns review rule folder when review rule with folder matches', () => {
    const msg = makeReviewMessage();
    const rule = makeRule({ action: { type: 'review', folder: 'Review/Important' } });
    const result = resolveSweepDestination(msg, [rule], defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'Review/Important' });
    expect(result.matchedRule).toEqual(rule);
  });

  it('filters out review rule without folder and falls through to default', () => {
    const msg = makeReviewMessage();
    const rule = makeRule({ action: { type: 'review' } });
    const result = resolveSweepDestination(msg, [rule], defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'MailingLists' });
    expect(result.matchedRule).toBeNull();
  });

  it('folder-less review rule does not block lower-priority move rule', () => {
    const msg = makeReviewMessage();
    const moveRule = makeRule({ id: 'move-rule', order: 2, action: { type: 'move', folder: 'Archive/Lists' } });
    const rules = [
      makeRule({ id: 'review-rule', order: 1, action: { type: 'review' } }),
      moveRule,
    ];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'Archive/Lists' });
    expect(result.matchedRule).toEqual(moveRule);
  });

  it('filters out skip rules', () => {
    const msg = makeReviewMessage();
    const moveRule = makeRule({ id: 'move-rule', order: 1, action: { type: 'move', folder: 'Archive' } });
    const rules = [
      makeRule({ id: 'skip-rule', order: 0, action: { type: 'skip' } }),
      moveRule,
    ];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'Archive' });
    expect(result.matchedRule).toEqual(moveRule);
  });

  it('returns default archive folder when no rule matches', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ match: { sender: '*@other.com' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'MailingLists' });
    expect(result.matchedRule).toBeNull();
  });

  it('respects rule priority ordering', () => {
    const msg = makeReviewMessage();
    const firstRule = makeRule({ id: 'r1', order: 1, action: { type: 'move', folder: 'First' } });
    const rules = [
      makeRule({ id: 'r2', order: 2, action: { type: 'move', folder: 'Second' } }),
      firstRule,
    ];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'First' });
    expect(result.matchedRule).toEqual(firstRule);
  });

  it('skip-only rules fall through to default archive', () => {
    const msg = makeReviewMessage();
    const rules = [makeRule({ action: { type: 'skip' } })];
    const result = resolveSweepDestination(msg, rules, defaultArchiveFolder);
    expect(result.destination).toEqual({ type: 'move', folder: 'MailingLists' });
    expect(result.matchedRule).toBeNull();
  });
});

const silentLogger = pino({ level: 'silent' });

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

    const state = sweeper.getState();
    expect(state.nextSweepAt).not.toBeNull();

    // fetchAllMessages should not have been called yet
    expect(client.fetchAllMessages).not.toHaveBeenCalled();
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

    vi.advanceTimersByTime(5_000);
    sweeper.restart();
    const secondNext = sweeper.getState().nextSweepAt;

    expect(secondNext).not.toBeNull();
    expect(secondNext).not.toBe(firstNext);
  });
});

describe('ReviewSweeper.runSweep', () => {
  it('fetches review folder, moves eligible messages, logs with sweep source', async () => {
    const oldMsg = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const youngMsg = makeReviewMessage({
      uid: 20,
      flags: new Set(),
      internalDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });

    const client = makeMockClient();
    (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([oldMsg, youngMsg]);

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

    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(10, 'MailingLists', 'Review');

    expect(activityLog.logActivity).toHaveBeenCalledTimes(1);
    expect(activityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, messageUid: 10, action: 'move', folder: 'MailingLists' }),
      expect.objectContaining({ uid: 10 }),
      null,
      'sweep',
    );

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

    const first = sweeper.runSweep();
    const second = sweeper.runSweep();
    await second;

    expect(client.fetchAllMessages).toHaveBeenCalledTimes(1);

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

    expect(client.moveMessage).toHaveBeenCalledTimes(2);
    expect(activityLog.logActivity).toHaveBeenCalledTimes(2);

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
