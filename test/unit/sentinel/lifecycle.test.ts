import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectTrackedFolders, reconcileSentinels } from '../../../src/sentinel/lifecycle.js';
import type { Config } from '../../../src/config/schema.js';
import type { FolderPurpose } from '../../../src/sentinel/format.js';
import * as imapOps from '../../../src/sentinel/imap-ops.js';

vi.mock('../../../src/sentinel/imap-ops.js', () => ({
  appendSentinel: vi.fn(),
  findSentinel: vi.fn(),
  deleteSentinel: vi.fn(),
}));

const mockAppendSentinel = vi.mocked(imapOps.appendSentinel);
const mockFindSentinel = vi.mocked(imapOps.findSentinel);
const mockDeleteSentinel = vi.mocked(imapOps.deleteSentinel);

/** Build a minimal Config with overrides for testing. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    imap: {
      host: 'localhost',
      port: 993,
      tls: true,
      auth: { user: 'test', pass: 'test' },
      idleTimeout: 300_000,
      pollInterval: 60_000,
    },
    server: { port: 3000, host: '0.0.0.0' },
    rules: [],
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: true, scanInterval: 30 },
    },
    actionFolders: {
      enabled: true,
      prefix: 'Actions',
      pollInterval: 15,
      folders: {
        vip: '\u2B50 VIP Sender',
        block: '\uD83D\uDEAB Block Sender',
        undoVip: '\u21A9\uFE0F Undo VIP',
        unblock: '\u2705 Unblock Sender',
      },
    },
    ...overrides,
  } as Config;
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    match: { sender: 'test@example.com' },
    action: { type: 'move' as const, folder: 'Archive' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

describe('collectTrackedFolders', () => {
  it('includes move rule target as rule-target', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'Archive' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Archive')).toBe('rule-target');
  });

  it('includes review folder as review', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Review')).toBe('review');
  });

  it('includes review rule with custom folder as review', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'review', folder: 'Review/Special' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Review/Special')).toBe('review');
  });

  it('includes defaultArchiveFolder as sweep-target', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('MailingLists')).toBe('sweep-target');
  });

  it('includes action folder paths when actionFolders enabled', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: {
        enabled: true,
        prefix: 'Actions',
        pollInterval: 15,
        folders: { vip: '\u2B50 VIP Sender', block: '\uD83D\uDEAB Block Sender', undoVip: '\u21A9\uFE0F Undo VIP', unblock: '\u2705 Unblock Sender' },
      },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Actions/\u2B50 VIP Sender')).toBe('action-folder');
    expect(result.get('Actions/\uD83D\uDEAB Block Sender')).toBe('action-folder');
    expect(result.get('Actions/\u21A9\uFE0F Undo VIP')).toBe('action-folder');
    expect(result.get('Actions/\u2705 Unblock Sender')).toBe('action-folder');
  });

  it('excludes action folders when actionFolders disabled', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: {
        enabled: false,
        prefix: 'Actions',
        pollInterval: 15,
        folders: { vip: '\u2B50 VIP Sender', block: '\uD83D\uDEAB Block Sender', undoVip: '\u21A9\uFE0F Undo VIP', unblock: '\u2705 Unblock Sender' },
      },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('Actions/\u2B50 VIP Sender')).toBe(false);
  });

  it('excludes INBOX from move rule targets', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'INBOX' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('INBOX')).toBe(false);
  });

  it('excludes INBOX from review folder (edge case)', () => {
    const config = makeConfig({
      rules: [],
      review: {
        folder: 'INBOX',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
        moveTracking: { enabled: true, scanInterval: 30 },
      },
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('INBOX')).toBe(false);
  });

  it('skips disabled rules', () => {
    const config = makeConfig({
      rules: [makeRule({ enabled: false, action: { type: 'move', folder: 'Archive' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('Archive')).toBe(false);
  });

  it('first purpose wins when multiple sources point to same folder', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'Review' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    // Rules are processed first, so 'Review' should be 'rule-target', not 'review'
    expect(result.get('Review')).toBe('rule-target');
  });

  it('returns review folder + defaultArchiveFolder with empty rules', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.size).toBe(2);
    expect(result.has('Review')).toBe(true);
    expect(result.has('MailingLists')).toBe(true);
  });
});

function createMockClient() {
  return {
    appendMessage: vi.fn(async () => ({ destination: 'test', uid: 1 })),
    searchByHeader: vi.fn(async () => [] as number[]),
    deleteMessage: vi.fn(async () => true),
  };
}

function createMockStore(sentinels: Array<{ messageId: string; folderPath: string; folderPurpose: string; createdAt: string }> = []) {
  return {
    getAll: vi.fn(() => sentinels),
    upsert: vi.fn(),
    getByFolder: vi.fn(),
    getByMessageId: vi.fn(),
    deleteByMessageId: vi.fn(() => true),
    deleteByFolder: vi.fn(() => true),
    updateFolderPath: vi.fn(() => true),
  };
}

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function makeSentinel(folder: string, purpose = 'rule-target', messageId = `<${folder}@sentinel>`) {
  return { messageId, folderPath: folder, folderPurpose: purpose, createdAt: '2026-01-01' };
}

describe('reconcileSentinels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendSentinel.mockResolvedValue({ messageId: '<new@sentinel>', uid: 1 });
    mockFindSentinel.mockResolvedValue(42);
    mockDeleteSentinel.mockResolvedValue(true);
  });

  it('plants missing sentinels', async () => {
    const tracked = new Map<string, FolderPurpose>([['Archive', 'rule-target']]);
    const store = createMockStore([]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockAppendSentinel).toHaveBeenCalledWith(client, 'Archive', 'rule-target', store);
    expect(result.planted).toBe(1);
  });

  it('skips existing sentinels', async () => {
    const tracked = new Map<string, FolderPurpose>([['Archive', 'rule-target']]);
    const store = createMockStore([makeSentinel('Archive')]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockAppendSentinel).not.toHaveBeenCalled();
    expect(result.planted).toBe(0);
  });

  it('removes orphaned sentinels', async () => {
    const tracked = new Map<string, FolderPurpose>();
    const sentinel = makeSentinel('OldFolder');
    const store = createMockStore([sentinel]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockFindSentinel).toHaveBeenCalledWith(client, 'OldFolder', sentinel.messageId);
    expect(mockDeleteSentinel).toHaveBeenCalledWith(client, 'OldFolder', 42, store, sentinel.messageId);
    expect(result.removed).toBe(1);
  });

  it('cleans store only when orphan not found on IMAP', async () => {
    const tracked = new Map<string, FolderPurpose>();
    const sentinel = makeSentinel('OldFolder');
    const store = createMockStore([sentinel]);
    const client = createMockClient();
    const logger = createMockLogger();
    mockFindSentinel.mockResolvedValue(undefined);

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(store.deleteByMessageId).toHaveBeenCalledWith(sentinel.messageId);
    expect(mockDeleteSentinel).not.toHaveBeenCalled();
    expect(result.removed).toBe(1);
  });

  it('plants and removes in one pass', async () => {
    const tracked = new Map<string, FolderPurpose>([['New', 'rule-target']]);
    const store = createMockStore([makeSentinel('Old')]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockAppendSentinel).toHaveBeenCalledWith(client, 'New', 'rule-target', store);
    expect(mockFindSentinel).toHaveBeenCalled();
    expect(result.planted).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('is idempotent when tracked matches store', async () => {
    const tracked = new Map<string, FolderPurpose>([['Archive', 'rule-target']]);
    const store = createMockStore([makeSentinel('Archive')]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockAppendSentinel).not.toHaveBeenCalled();
    expect(mockDeleteSentinel).not.toHaveBeenCalled();
    expect(result).toEqual({ planted: 0, removed: 0, errors: 0 });
  });

  it('continues after individual planting failure', async () => {
    const tracked = new Map<string, FolderPurpose>([['A', 'rule-target'], ['B', 'review']]);
    const store = createMockStore([]);
    const client = createMockClient();
    const logger = createMockLogger();
    mockAppendSentinel
      .mockRejectedValueOnce(new Error('IMAP error'))
      .mockResolvedValueOnce({ messageId: '<b@sentinel>', uid: 2 });

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockAppendSentinel).toHaveBeenCalledTimes(2);
    expect(result.planted).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('continues after individual cleanup failure', async () => {
    const tracked = new Map<string, FolderPurpose>();
    const store = createMockStore([makeSentinel('A'), makeSentinel('B')]);
    const client = createMockClient();
    const logger = createMockLogger();
    mockFindSentinel
      .mockRejectedValueOnce(new Error('IMAP error'))
      .mockResolvedValueOnce(99);

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(mockFindSentinel).toHaveBeenCalledTimes(2);
    expect(result.errors).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('returns correct counts', async () => {
    const tracked = new Map<string, FolderPurpose>([['New1', 'rule-target'], ['New2', 'review']]);
    const store = createMockStore([makeSentinel('Old1'), makeSentinel('Old2')]);
    const client = createMockClient();
    const logger = createMockLogger();

    const result = await reconcileSentinels(tracked, store as any, client as any, logger);
    expect(result).toEqual({ planted: 2, removed: 2, errors: 0 });
  });
});
