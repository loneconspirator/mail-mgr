/**
 * Smoke tests for the core pipeline.
 *
 * These verify that the most basic behaviors work end-to-end through
 * the unit-level wiring — the kind of tests that, if missing, let
 * show-stopper regressions like the duplicate-delete activity flood
 * ship undetected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionFolderPoller } from '../../src/action-folders/poller.js';
import { ActionFolderProcessor } from '../../src/action-folders/processor.js';
import type { ActionFolderPollerDeps } from '../../src/action-folders/poller.js';
import type { ImapClient } from '../../src/imap/client.js';
import type { ConfigRepository } from '../../src/config/repository.js';
import type { ActivityLog } from '../../src/log/index.js';
import type { ReviewMessage } from '../../src/imap/messages.js';
import type { ActionFolderConfig, Rule } from '../../src/config/schema.js';
import type { Logger } from 'pino';

const DEFAULT_AF_CONFIG: ActionFolderConfig = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: 'VIP Sender',
    block: 'Block Sender',
    undoVip: 'Undo VIP',
    unblock: 'Unblock Sender',
  },
};

function makeSentinelMessage(uid: number = 99): ReviewMessage {
  return {
    uid,
    envelope: {
      messageId: '<sentinel-uuid@mail-manager.sentinel>',
      from: { address: 'mail-manager@localhost', name: 'Mail Manager' },
      to: [{ address: 'mail-manager@localhost', name: '' }],
      cc: [],
      subject: '[Mail Manager] Sentinel: Actions/Block Sender',
    },
    internalDate: new Date(),
    flags: new Set(['\\Seen']),
    headers: new Map([['x-mail-mgr-sentinel', '<sentinel-uuid@mail-manager.sentinel>']]),
  };
}

function makeRealMessage(uid: number, sender: string): ReviewMessage {
  return {
    uid,
    envelope: {
      messageId: `<msg-${uid}@example.com>`,
      from: { address: sender, name: sender.split('@')[0] },
      to: [{ address: 'me@example.com', name: '' }],
      cc: [],
      subject: `Test message ${uid}`,
    },
    internalDate: new Date(),
    flags: new Set(),
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createMockClient() {
  return {
    status: vi.fn().mockResolvedValue({ messages: 0, unseen: 0 }),
    fetchAllMessages: vi.fn().mockResolvedValue([]),
    moveMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient;
}

function createMockActivityLog() {
  return {
    logActivity: vi.fn(),
  } as unknown as ActivityLog;
}

function createMockConfigRepo(rules: Rule[] = []) {
  return {
    getRules: vi.fn().mockReturnValue(rules),
    addRule: vi.fn().mockImplementation((input: Omit<Rule, 'id'>) => ({
      ...input,
      id: 'generated-id',
    })),
    deleteRule: vi.fn().mockReturnValue(true),
    nextOrder: vi.fn().mockReturnValue(rules.length),
    getActionFolderConfig: vi.fn().mockReturnValue(DEFAULT_AF_CONFIG),
  } as unknown as ConfigRepository;
}

describe('Smoke: sentinel-only action folders do not flood activity log', () => {
  let mockClient: ImapClient;
  let mockConfigRepo: ConfigRepository;
  let mockActivityLog: ActivityLog;
  let mockLogger: Logger;

  beforeEach(() => {
    mockClient = createMockClient();
    mockConfigRepo = createMockConfigRepo();
    mockActivityLog = createMockActivityLog();
    mockLogger = createMockLogger();
  });

  it('sentinel in action folder produces zero activity entries', async () => {
    const processor = new ActionFolderProcessor(
      mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash',
    );

    // Simulate: Block Sender folder has 1 sentinel message
    (mockClient.status as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // vip
      .mockResolvedValueOnce({ messages: 1, unseen: 0 })  // block — has sentinel
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // undoVip
      .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // unblock
    (mockClient.fetchAllMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeSentinelMessage()]);

    const poller = new ActionFolderPoller({
      client: mockClient,
      configRepo: mockConfigRepo,
      processor,
      logger: mockLogger,
      pollIntervalMs: 15_000,
    });

    await poller.scanAll();

    // The critical assertion: NO activity entries should be logged
    expect(mockActivityLog.logActivity).not.toHaveBeenCalled();

    // No rules should be created
    expect(mockConfigRepo.addRule).not.toHaveBeenCalled();

    // Sentinel should NOT be moved
    expect(mockClient.moveMessage).not.toHaveBeenCalled();
  });

  it('sentinel-only folder skips FOLD-02 retry', async () => {
    const processor = new ActionFolderProcessor(
      mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash',
    );

    // Block Sender has 1 sentinel; status always returns 1 because sentinel stays
    (mockClient.status as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // vip
      .mockResolvedValueOnce({ messages: 1, unseen: 0 })  // block — has sentinel
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // undoVip
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // unblock
      .mockResolvedValue({ messages: 1, unseen: 0 });      // any re-checks

    (mockClient.fetchAllMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeSentinelMessage()]);

    const poller = new ActionFolderPoller({
      client: mockClient,
      configRepo: mockConfigRepo,
      processor,
      logger: mockLogger,
      pollIntervalMs: 15_000,
    });

    await poller.scanAll();

    // fetchAllMessages should NOT be called — sentinel-only folder skipped at status check
    expect((mockClient.fetchAllMessages as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('multiple poll cycles with sentinel-only folder produce zero cumulative activity entries', async () => {
    const processor = new ActionFolderProcessor(
      mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash',
    );

    // Every status check for block returns 1 (sentinel always there)
    (mockClient.status as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === 'Actions/Block Sender') return { messages: 1, unseen: 0 };
      return { messages: 0, unseen: 0 };
    });
    (mockClient.fetchAllMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeSentinelMessage()]);

    const poller = new ActionFolderPoller({
      client: mockClient,
      configRepo: mockConfigRepo,
      processor,
      logger: mockLogger,
      pollIntervalMs: 15_000,
    });

    // Simulate 10 poll cycles
    for (let i = 0; i < 10; i++) {
      await poller.scanAll();
    }

    // After 10 cycles: ZERO activity entries, ZERO rules created
    expect(mockActivityLog.logActivity).not.toHaveBeenCalled();
    expect(mockConfigRepo.addRule).not.toHaveBeenCalled();
  });
});

describe('Smoke: action folder processes real messages correctly', () => {
  let mockClient: ImapClient;
  let mockActivityLog: ActivityLog;
  let mockLogger: Logger;

  beforeEach(() => {
    mockClient = createMockClient();
    mockActivityLog = createMockActivityLog();
    mockLogger = createMockLogger();
  });

  it('block action creates delete rule and logs with correct action type', async () => {
    const mockConfigRepo = createMockConfigRepo();
    const processor = new ActionFolderProcessor(
      mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash',
    );

    const msg = makeRealMessage(1, 'spammer@evil.com');

    // Only block folder has messages (real msg + sentinel = 2, so it won't be skipped)
    (mockClient.status as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // vip
      .mockResolvedValueOnce({ messages: 2, unseen: 0 })  // block — sentinel + real msg
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // undoVip
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })  // unblock
      .mockResolvedValue({ messages: 0, unseen: 0 });
    (mockClient.fetchAllMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeSentinelMessage(), msg]);

    const poller = new ActionFolderPoller({
      client: mockClient,
      configRepo: mockConfigRepo,
      processor,
      logger: mockLogger,
      pollIntervalMs: 15_000,
    });

    await poller.scanAll();

    // Rule should be created with type: delete
    expect(mockConfigRepo.addRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Block: spammer@evil.com',
        action: { type: 'delete' },
      }),
    );

    // Activity should be logged with action 'delete', not 'duplicate-delete'
    expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', success: true }),
      expect.anything(),
      expect.anything(),
      'action-folder',
    );

    // Message should be moved to Trash
    expect(mockClient.moveMessage).toHaveBeenCalledWith(
      1, 'Trash', 'Actions/Block Sender',
    );
  });

  it('existing delete rule for sender logs duplicate-delete but does NOT create new rule', async () => {
    const existingBlockRule: Rule = {
      id: 'existing-block',
      name: 'Block: repeat@sender.com',
      match: { sender: 'repeat@sender.com' },
      action: { type: 'delete' },
      enabled: true,
      order: 0,
    } as Rule;
    const mockConfigRepo = createMockConfigRepo([existingBlockRule]);

    const processor = new ActionFolderProcessor(
      mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash',
    );

    const rawMsg = makeRealMessage(5, 'repeat@sender.com');
    const { reviewMessageToEmailMessage } = await import('../../src/imap/messages.js');
    const msg = reviewMessageToEmailMessage(rawMsg);
    const result = await processor.processMessage(msg, 'block');
    expect(result.ok).toBe(true);
    // No new rule created
    expect(mockConfigRepo.addRule).not.toHaveBeenCalled();
    // Activity logged as duplicate-delete
    expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'duplicate-delete' }),
      expect.anything(),
      expect.objectContaining({ id: 'existing-block' }),
      'action-folder',
    );
  });
});
