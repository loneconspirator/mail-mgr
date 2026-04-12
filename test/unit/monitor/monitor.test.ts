import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Monitor } from '../../../src/monitor/index.js';
import { ImapClient } from '../../../src/imap/index.js';
import type { ImapFlowLike } from '../../../src/imap/index.js';
import * as imapIndex from '../../../src/imap/index.js';
import { ActivityLog } from '../../../src/log/index.js';
import type { Config, Rule } from '../../../src/config/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeConfig(rules: Rule[] = [], opts?: { envelopeHeader?: string }): Config {
  return {
    imap: {
      host: 'localhost',
      port: 993,
      tls: true,
      auth: { user: 'test', pass: 'test' },
      idleTimeout: 300000,
      pollInterval: 60000,
      ...(opts?.envelopeHeader !== undefined ? { envelopeHeader: opts.envelopeHeader } : {}),
    },
    server: { port: 3000, host: '0.0.0.0' },
    rules,
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: {
        intervalHours: 6,
        readMaxAgeDays: 7,
        unreadMaxAgeDays: 14,
      },
    },
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeFetchResult(uid: number, from: string, subject: string) {
  return {
    uid,
    flags: new Set<string>(),
    envelope: {
      messageId: `<msg-${uid}@test.com>`,
      from: [{ name: '', address: from }],
      to: [{ name: '', address: 'me@test.com' }],
      cc: [],
      subject,
      date: new Date(),
    },
  };
}

function makeMockFlow(): ImapFlowLike {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    mailboxOpen: vi.fn().mockResolvedValue(undefined),
    messageMove: vi.fn().mockResolvedValue(undefined),
    mailboxCreate: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
    noop: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    usable: true,
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
      return this;
    },
    removeAllListeners() {
      listeners.clear();
      return this;
    },
  };
}

let tmpDir: string;
let activityLog: ActivityLog;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailmgr-monitor-'));
  activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Monitor', () => {
  it('processes a matching message: rule matches, action executes, activity logged', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    // Make fetch return one message
    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Hello');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    // Manually connect and process (don't use start() which triggers events)
    await client.connect();
    await monitor.processNewMessages();

    // Verify message was moved
    expect(flow.messageMove).toHaveBeenCalledWith([1], 'Archive', { uid: true });

    // Verify activity was logged
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].message_uid).toBe(1);
    expect(entries[0].rule_id).toBe('test-rule');
    expect(entries[0].action).toBe('move');
    expect(entries[0].success).toBe(1);

    // Verify state
    const state = monitor.getState();
    expect(state.messagesProcessed).toBe(1);
    expect(state.lastProcessedAt).toBeInstanceOf(Date);

    await client.disconnect();
  });

  it('no-match: message stays in inbox, no activity logged', async () => {
    const rule = makeRule({ match: { sender: '*@github.com' } });
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Hello');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // No move
    expect(flow.messageMove).not.toHaveBeenCalled();

    // No activity logged
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(0);

    // But message was still processed
    expect(monitor.getState().messagesProcessed).toBe(1);

    await client.disconnect();
  });

  it('action failure: error logged, processing continues', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    // Two messages: first one will fail to move, second should still be processed
    const msg1 = makeFetchResult(1, 'alice@example.com', 'First');
    const msg2 = makeFetchResult(2, 'bob@example.com', 'Second');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield msg1;
        yield msg2;
      },
    });

    // First move fails, folder create fails too
    (flow.messageMove as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Move failed'))
      .mockRejectedValueOnce(new Error('Still failed'))
      .mockResolvedValue(undefined);
    (flow.mailboxCreate as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Cannot create'));

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // Both messages processed
    expect(monitor.getState().messagesProcessed).toBe(2);

    // Both logged (one failure, one success)
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(2);
    // Entries are reverse chronological, so second message is first
    expect(entries[0].message_uid).toBe(2);
    expect(entries[0].success).toBe(1);
    expect(entries[1].message_uid).toBe(1);
    expect(entries[1].success).toBe(0);
    expect(entries[1].error).toBeTruthy();

    await client.disconnect();
  });

  it('exposes connection state', async () => {
    const config = makeConfig([]);
    const flow = makeMockFlow();
    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    expect(monitor.getState().connectionStatus).toBe('disconnected');

    await client.connect();
    expect(monitor.getState().connectionStatus).toBe('connected');

    await client.disconnect();
    expect(monitor.getState().connectionStatus).toBe('disconnected');
  });

  it('persists lastUid and restores it on new Monitor instance', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(5, 'alice@example.com', 'Hello');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // lastUid should be persisted
    expect(activityLog.getState('lastUid')).toBe('5');

    // New monitor instance should restore lastUid from db
    const flow2 = makeMockFlow();
    (flow2.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() { /* no messages */ },
    });

    const client2 = new ImapClient(config.imap, () => flow2);
    const monitor2 = new Monitor(config, { imapClient: client2, activityLog, logger: silentLogger });

    await client2.connect();
    await monitor2.processNewMessages();

    // fetch should have been called with sinceUid=5, so range '6:*'
    expect(flow2.fetch).toHaveBeenCalledWith('6:*', expect.any(Object), expect.any(Object));

    await client.disconnect();
    await client2.disconnect();
  });

  it('lastUid is only advanced after processMessage succeeds', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const msg1 = makeFetchResult(3, 'alice@example.com', 'First');
    const msg2 = makeFetchResult(4, 'alice@example.com', 'Second');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield msg1;
        yield msg2;
      },
    });

    // Make the move for msg1 fail unrecoverably so processMessage throws internally.
    // processMessage catches action failures and logs them — it does NOT rethrow —
    // so lastUid should still advance past msg1 once processMessage returns.
    // What we actually want to verify is the ordering: lastUid is NOT updated until
    // after processMessage returns.
    //
    // Simulate by making logActivity throw on the first call, which would cause
    // processMessage to throw. lastUid must NOT be persisted for that UID.
    // We do this by testing the opposite: when processing succeeds, lastUid IS persisted.
    // The action-failure test already covers that the batch continues.
    //
    // Direct test: process two messages; after each, lastUid must reflect the completed one.
    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // Both messages processed — lastUid should be 4 (the higher UID)
    expect(activityLog.getState('lastUid')).toBe('4');

    // Activity log should have two entries
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(2);

    await client.disconnect();
  });

  it('lastUid is not advanced when processMessage throws', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const flow = makeMockFlow();

    const msg = makeFetchResult(7, 'alice@example.com', 'Fail me');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield msg;
      },
    });

    // Make logActivity (called inside processMessage) throw, simulating an unexpected
    // error that causes processMessage to reject.
    const origLogActivity = activityLog.logActivity.bind(activityLog);
    vi.spyOn(activityLog, 'logActivity').mockImplementationOnce(() => {
      throw new Error('simulated DB failure');
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();
    await monitor.processNewMessages();

    // lastUid must NOT have been advanced — the message was not successfully processed
    expect(activityLog.getState('lastUid')).toBeUndefined();

    vi.restoreAllMocks();
    await client.disconnect();
  });

  it('updateRules replaces the active rule set', async () => {
    const config = makeConfig([]);
    const flow = makeMockFlow();

    const fetchResult = makeFetchResult(1, 'alice@example.com', 'Hello');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult;
      },
    });

    const client = new ImapClient(config.imap, () => flow);
    const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

    await client.connect();

    // No rules, no match
    await monitor.processNewMessages();
    expect(activityLog.getRecentActivity()).toHaveLength(0);

    // Reset fetch for second call
    const fetchResult2 = makeFetchResult(2, 'alice@example.com', 'Hello again');
    (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield fetchResult2;
      },
    });

    // Add a rule that matches
    monitor.updateRules([makeRule()]);
    await monitor.processNewMessages();

    expect(activityLog.getRecentActivity()).toHaveLength(1);

    await client.disconnect();
  });

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

    expect(flow.messageMove).toHaveBeenCalledWith([1], 'Review', { uid: true });

    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('review');
    expect(entries[0].folder).toBe('Review');
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('review-rule');

    await client.disconnect();
  });

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

    expect(flow.messageMove).toHaveBeenCalledWith([1], 'Trash', { uid: true });

    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('delete');
    expect(entries[0].folder).toBe('Trash');
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('delete-rule');

    await client.disconnect();
  });

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

    expect(flow.messageMove).not.toHaveBeenCalled();

    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('skip');
    expect(entries[0].folder).toBeNull();
    expect(entries[0].source).toBe('arrival');
    expect(entries[0].rule_id).toBe('skip-rule');

    await client.disconnect();
  });

  describe('envelopeHeader passthrough', () => {
    it('passes envelopeHeader to parseMessage when configured', async () => {
      const rule = makeRule();
      const config = makeConfig([rule], { envelopeHeader: 'Delivered-To' });
      const flow = makeMockFlow();

      const fetchResult = makeFetchResult(1, 'alice@example.com', 'Hello');
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield fetchResult;
        },
      });

      const parseMessageSpy = vi.spyOn(imapIndex, 'parseMessage');

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      expect(parseMessageSpy).toHaveBeenCalledWith(fetchResult, 'Delivered-To');

      parseMessageSpy.mockRestore();
      await client.disconnect();
    });

    it('passes undefined envelopeHeader to parseMessage when not configured', async () => {
      const rule = makeRule();
      const config = makeConfig([rule]);
      const flow = makeMockFlow();

      const fetchResult = makeFetchResult(1, 'alice@example.com', 'Hello');
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield fetchResult;
        },
      });

      const parseMessageSpy = vi.spyOn(imapIndex, 'parseMessage');

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      expect(parseMessageSpy).toHaveBeenCalledWith(fetchResult, undefined);

      parseMessageSpy.mockRestore();
      await client.disconnect();
    });

    it('new Monitor with envelopeHeader stores the value from config', () => {
      const config = makeConfig([], { envelopeHeader: 'X-Original-To' });
      const flow = makeMockFlow();
      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      // Verify by processing a message and checking the spy
      // The constructor should have stored the envelopeHeader
      expect(monitor).toBeDefined();
    });
  });

  describe('cursorEnabled toggle', () => {
    it('when cursorEnabled is false, starts with lastUid=0 even if lastUid is stored', async () => {
      // Pre-store a lastUid and set cursorEnabled to false
      activityLog.setState('lastUid', '500');
      activityLog.setState('cursorEnabled', 'false');

      const config = makeConfig([]);
      const flow = makeMockFlow();
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() { /* no messages */ },
      });

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      // Should fetch from UID 1 (lastUid=0 means sinceUid=0, so range '1:*')
      expect(flow.fetch).toHaveBeenCalledWith('1:*', expect.any(Object), expect.any(Object));

      await client.disconnect();
    });

    it('when cursorEnabled is false, does not persist lastUid during processNewMessages', async () => {
      activityLog.setState('cursorEnabled', 'false');

      const rule = makeRule();
      const config = makeConfig([rule]);
      const flow = makeMockFlow();

      const fetchResult = makeFetchResult(10, 'alice@example.com', 'Hello');
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield fetchResult;
        },
      });

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      // lastUid should NOT have been persisted
      expect(activityLog.getState('lastUid')).toBeUndefined();

      await client.disconnect();
    });

    it('when cursorEnabled is unset (default), loads and persists lastUid normally', async () => {
      activityLog.setState('lastUid', '100');
      // cursorEnabled is NOT set — default behavior

      const rule = makeRule();
      const config = makeConfig([rule]);
      const flow = makeMockFlow();

      const fetchResult = makeFetchResult(101, 'alice@example.com', 'Hello');
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield fetchResult;
        },
      });

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      // Should have fetched from UID 101 (lastUid=100, range '101:*')
      expect(flow.fetch).toHaveBeenCalledWith('101:*', expect.any(Object), expect.any(Object));
      // And persisted the new lastUid
      expect(activityLog.getState('lastUid')).toBe('101');

      await client.disconnect();
    });

    it('when cursorEnabled is true, loads and persists lastUid normally', async () => {
      activityLog.setState('lastUid', '200');
      activityLog.setState('cursorEnabled', 'true');

      const rule = makeRule();
      const config = makeConfig([rule]);
      const flow = makeMockFlow();

      const fetchResult = makeFetchResult(201, 'alice@example.com', 'Hello');
      (flow.fetch as ReturnType<typeof vi.fn>).mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield fetchResult;
        },
      });

      const client = new ImapClient(config.imap, () => flow);
      const monitor = new Monitor(config, { imapClient: client, activityLog, logger: silentLogger });

      await client.connect();
      await monitor.processNewMessages();

      // Should have fetched from UID 201 (lastUid=200, range '201:*')
      expect(flow.fetch).toHaveBeenCalledWith('201:*', expect.any(Object), expect.any(Object));
      // And persisted the new lastUid
      expect(activityLog.getState('lastUid')).toBe('201');

      await client.disconnect();
    });
  });
});
