import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSender, ActionFolderProcessor } from '../../../src/action-folders/processor.js';
import type { ProcessResult } from '../../../src/action-folders/processor.js';
import type { ConfigRepository } from '../../../src/config/repository.js';
import type { ImapClient } from '../../../src/imap/client.js';
import type { ActivityLog } from '../../../src/log/index.js';
import type { EmailMessage } from '../../../src/imap/messages.js';
import type { ActionFolderConfig, Rule } from '../../../src/config/schema.js';
import type { ActionResult } from '../../../src/actions/index.js';
import type { Logger } from 'pino';

const DEFAULT_CONFIG: ActionFolderConfig = {
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

function createMockClient() {
  return {
    moveMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient;
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
    getActionFolderConfig: vi.fn().mockReturnValue(DEFAULT_CONFIG),
  } as unknown as ConfigRepository;
}

function createMockActivityLog() {
  return {
    logActivity: vi.fn(),
  } as unknown as ActivityLog;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createMessage(overrides?: Partial<EmailMessage>): EmailMessage {
  return {
    uid: 1,
    messageId: '<test@example.com>',
    from: { name: 'Test', address: 'sender@example.com' },
    to: [{ name: '', address: 'me@example.com' }],
    cc: [],
    subject: 'Test',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: 'sender@example.com' },
    action: { type: 'skip' },
    enabled: true,
    order: 0,
    ...overrides,
  } as Rule;
}

describe('extractSender', () => {
  it('returns lowercase email for valid address', () => {
    const msg = createMessage({ from: { name: 'Alice', address: 'alice@example.com' } });
    expect(extractSender(msg)).toBe('alice@example.com');
  });

  it('normalizes uppercase address to lowercase and trims whitespace', () => {
    const msg = createMessage({ from: { name: 'Alice', address: ' Alice@EXAMPLE.COM ' } });
    expect(extractSender(msg)).toBe('alice@example.com');
  });

  it('returns null for empty address', () => {
    const msg = createMessage({ from: { name: '', address: '' } });
    expect(extractSender(msg)).toBeNull();
  });

  it('returns null for address without @', () => {
    const msg = createMessage({ from: { name: '', address: 'not-an-email' } });
    expect(extractSender(msg)).toBeNull();
  });
});

describe('ActionFolderProcessor', () => {
  let mockClient: ImapClient;
  let mockConfigRepo: ConfigRepository;
  let mockActivityLog: ActivityLog;
  let mockLogger: Logger;
  let processor: ActionFolderProcessor;

  beforeEach(() => {
    mockClient = createMockClient();
    mockConfigRepo = createMockConfigRepo();
    mockActivityLog = createMockActivityLog();
    mockLogger = createMockLogger();
    processor = new ActionFolderProcessor(
      mockConfigRepo,
      mockClient,
      mockActivityLog,
      mockLogger,
      'INBOX',
      'Trash',
    );
  });

  describe('processMessage - VIP', () => {
    it('creates a skip rule with correct name, match, action, and order', async () => {
      const msg = createMessage();
      const result = await processor.processMessage(msg, 'vip');

      expect(result.ok).toBe(true);
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'VIP: sender@example.com',
          match: { sender: 'sender@example.com' },
          action: { type: 'skip' },
          enabled: true,
          order: 0,
        }),
      );
    });

    it('moves message to INBOX from action folder', async () => {
      const msg = createMessage();
      await processor.processMessage(msg, 'vip');

      expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        1, 'INBOX', 'Actions/VIP Sender',
      );
    });

    it('logs activity with action-folder source', async () => {
      const msg = createMessage();
      await processor.processMessage(msg, 'vip');

      expect((mockActivityLog.logActivity as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, messageUid: 1, action: 'skip' }),
        msg,
        expect.objectContaining({ id: 'generated-id' }),
        'action-folder',
      );
    });

    it('returns ok with sender and ruleId', async () => {
      const msg = createMessage();
      const result = await processor.processMessage(msg, 'vip');

      expect(result).toMatchObject({
        ok: true,
        action: 'vip',
        sender: 'sender@example.com',
        ruleId: 'generated-id',
      });
    });
  });

  describe('processMessage - Block', () => {
    it('creates a delete rule with correct name and moves to Trash', async () => {
      const msg = createMessage();
      const result = await processor.processMessage(msg, 'block');

      expect(result.ok).toBe(true);
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Block: sender@example.com',
          match: { sender: 'sender@example.com' },
          action: { type: 'delete' },
          enabled: true,
        }),
      );
      expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        1, 'Trash', 'Actions/Block Sender',
      );
    });

    it('logs activity for block action', async () => {
      const msg = createMessage();
      await processor.processMessage(msg, 'block');

      expect((mockActivityLog.logActivity as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, action: 'delete' }),
        msg,
        expect.objectContaining({ id: 'generated-id' }),
        'action-folder',
      );
    });
  });

  describe('processMessage - Undo VIP', () => {
    it('finds and removes skip rule, moves to INBOX', async () => {
      const existingRule = makeRule({ id: 'vip-rule-1', action: { type: 'skip' } as Rule['action'] });
      mockConfigRepo = createMockConfigRepo([existingRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'undoVip');

      expect(result.ok).toBe(true);
      expect((mockConfigRepo.deleteRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('vip-rule-1');
      expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        1, 'INBOX', 'Actions/Undo VIP',
      );
    });

    it('logs removal activity', async () => {
      const existingRule = makeRule({ id: 'vip-rule-1', action: { type: 'skip' } as Rule['action'] });
      mockConfigRepo = createMockConfigRepo([existingRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      await processor.processMessage(msg, 'undoVip');

      expect((mockActivityLog.logActivity as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, action: expect.stringContaining('remove') }),
        msg,
        existingRule,
        'action-folder',
      );
    });
  });

  describe('processMessage - Unblock', () => {
    it('finds and removes delete rule, moves to INBOX', async () => {
      const existingRule = makeRule({ id: 'block-rule-1', action: { type: 'delete' } as Rule['action'] });
      mockConfigRepo = createMockConfigRepo([existingRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'unblock');

      expect(result.ok).toBe(true);
      expect((mockConfigRepo.deleteRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('block-rule-1');
      expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        1, 'INBOX', 'Actions/Unblock Sender',
      );
    });
  });

  describe('processMessage - unparseable sender', () => {
    it('moves to INBOX and returns ok: false for empty From address', async () => {
      const msg = createMessage({ from: { name: '', address: '' } });
      const result = await processor.processMessage(msg, 'vip');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unparseable');
      }
      expect((mockClient.moveMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        1, 'INBOX', 'Actions/VIP Sender',
      );
    });

    it('logs error for unparseable sender', async () => {
      const msg = createMessage({ from: { name: '', address: '' } });
      await processor.processMessage(msg, 'vip');

      expect((mockLogger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  describe('processMessage - conflict resolution', () => {
    it('removes existing Block rule before creating VIP rule (PROC-09)', async () => {
      const blockRule = makeRule({
        id: 'block-rule-1',
        name: 'Block: sender@example.com',
        action: { type: 'delete' } as Rule['action'],
      });
      mockConfigRepo = createMockConfigRepo([blockRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'vip');

      expect(result.ok).toBe(true);
      // Should delete conflicting block rule
      expect((mockConfigRepo.deleteRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('block-rule-1');
      // Should create new VIP rule
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'VIP: sender@example.com',
          action: { type: 'skip' },
        }),
      );
    });

    it('logs two activities for conflict resolution (D-12)', async () => {
      const blockRule = makeRule({
        id: 'block-rule-1',
        action: { type: 'delete' } as Rule['action'],
      });
      mockConfigRepo = createMockConfigRepo([blockRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      await processor.processMessage(msg, 'vip');

      // Two logActivity calls: one for removal, one for creation
      expect((mockActivityLog.logActivity as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    });

    it('removes existing VIP rule before creating Block rule (PROC-09)', async () => {
      const vipRule = makeRule({
        id: 'vip-rule-1',
        name: 'VIP: sender@example.com',
        action: { type: 'skip' } as Rule['action'],
      });
      mockConfigRepo = createMockConfigRepo([vipRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'block');

      expect(result.ok).toBe(true);
      expect((mockConfigRepo.deleteRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('vip-rule-1');
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Block: sender@example.com',
          action: { type: 'delete' },
        }),
      );
    });
  });

  describe('processMessage - multi-field rule preservation', () => {
    it('preserves multi-field rules for same sender (PROC-10)', async () => {
      const multiFieldRule = makeRule({
        id: 'multi-rule-1',
        match: { sender: 'sender@example.com', subject: '*newsletter*' } as Rule['match'],
        action: { type: 'delete' } as Rule['action'],
      });
      mockConfigRepo = createMockConfigRepo([multiFieldRule]);
      processor = new ActionFolderProcessor(mockConfigRepo, mockClient, mockActivityLog, mockLogger, 'INBOX', 'Trash');

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'vip');

      expect(result.ok).toBe(true);
      // Multi-field rule should NOT be deleted (findSenderRule only matches sender-only rules)
      expect((mockConfigRepo.deleteRule as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      // New sender-only rule should still be created
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  describe('processMessage - move failure', () => {
    it('returns ok: false when moveMessage throws, does NOT roll back rule changes (D-16)', async () => {
      (mockClient.moveMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IMAP move failed'));

      const msg = createMessage();
      const result = await processor.processMessage(msg, 'vip');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('move failed');
      }
      // Rule was still created (no rollback)
      expect((mockConfigRepo.addRule as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });
});
