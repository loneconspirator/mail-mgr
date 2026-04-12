import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Monitor } from '../../../src/monitor/index.js';
import { ImapClient } from '../../../src/imap/index.js';
import type { ImapFlowLike } from '../../../src/imap/index.js';
import { ActivityLog } from '../../../src/log/index.js';
import type { Config, Rule } from '../../../src/config/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeConfig(rules: Rule[] = []): Config {
  return {
    imap: {
      host: 'localhost',
      port: 993,
      tls: true,
      auth: { user: 'test', pass: 'test' },
      idleTimeout: 300000,
      pollInterval: 60000,
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
});
