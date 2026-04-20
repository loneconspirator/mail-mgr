import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureActionFolders } from '../../../src/action-folders/folders.js';
import type { ActionFolderConfig } from '../../../src/config/schema.js';
import type { ImapClient } from '../../../src/imap/client.js';
import type { Logger } from 'pino';

const DEFAULT_CONFIG: ActionFolderConfig = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: '\u2B50 VIP Sender',
    block: '\uD83D\uDEAB Block Sender',
    undoVip: '\u21A9\uFE0F Undo VIP',
    unblock: '\u2705 Unblock Sender',
  },
};

function createMockClient(overrides: Partial<Pick<ImapClient, 'status' | 'createMailbox'>> = {}) {
  return {
    status: vi.fn<(path: string) => Promise<{ messages: number; unseen: number }>>()
      .mockResolvedValue({ messages: 0, unseen: 0 }),
    createMailbox: vi.fn<(path: string | string[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ImapClient;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('ensureActionFolders', () => {
  let mockClient: ImapClient;
  let mockLogger: Logger;

  beforeEach(() => {
    mockClient = createMockClient();
    mockLogger = createMockLogger();
  });

  it('returns true when all 4 folders already exist', async () => {
    // status() succeeds for all folders => they all exist
    const result = await ensureActionFolders(mockClient, DEFAULT_CONFIG, mockLogger);

    expect(result).toBe(true);
    expect((mockClient.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
    expect((mockClient.createMailbox as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('creates folders that do not exist (status throws for missing ones)', async () => {
    // First two folders exist, last two do not
    const statusMock = vi.fn<(path: string) => Promise<{ messages: number; unseen: number }>>();
    statusMock
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })   // vip exists
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })   // block exists
      .mockRejectedValueOnce(new Error('Mailbox not found')) // undoVip missing
      .mockRejectedValueOnce(new Error('Mailbox not found')); // unblock missing

    mockClient = createMockClient({ status: statusMock as unknown as ImapClient['status'] });
    const result = await ensureActionFolders(mockClient, DEFAULT_CONFIG, mockLogger);

    expect(result).toBe(true);
    expect((mockClient.createMailbox as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('passes array-form paths to createMailbox', async () => {
    // All folders missing
    const statusMock = vi.fn().mockRejectedValue(new Error('Mailbox not found'));
    mockClient = createMockClient({ status: statusMock as unknown as ImapClient['status'] });

    await ensureActionFolders(mockClient, DEFAULT_CONFIG, mockLogger);

    const createMock = mockClient.createMailbox as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledWith(['Actions', '\u2B50 VIP Sender']);
    expect(createMock).toHaveBeenCalledWith(['Actions', '\uD83D\uDEAB Block Sender']);
    expect(createMock).toHaveBeenCalledWith(['Actions', '\u21A9\uFE0F Undo VIP']);
    expect(createMock).toHaveBeenCalledWith(['Actions', '\u2705 Unblock Sender']);
  });

  it('returns false and logs error when createMailbox fails (D-09 graceful degradation)', async () => {
    const statusMock = vi.fn().mockRejectedValue(new Error('Mailbox not found'));
    const createMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
    mockClient = createMockClient({
      status: statusMock as unknown as ImapClient['status'],
      createMailbox: createMock as unknown as ImapClient['createMailbox'],
    });

    const result = await ensureActionFolders(mockClient, DEFAULT_CONFIG, mockLogger);

    expect(result).toBe(false);
    expect((mockLogger.error as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('skips creation for existing folders and creates only missing ones', async () => {
    // vip exists, block missing, undoVip exists, unblock missing
    const statusMock = vi.fn<(path: string) => Promise<{ messages: number; unseen: number }>>();
    statusMock
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })    // vip exists
      .mockRejectedValueOnce(new Error('Mailbox not found')) // block missing
      .mockResolvedValueOnce({ messages: 0, unseen: 0 })    // undoVip exists
      .mockRejectedValueOnce(new Error('Mailbox not found')); // unblock missing

    mockClient = createMockClient({ status: statusMock as unknown as ImapClient['status'] });
    const result = await ensureActionFolders(mockClient, DEFAULT_CONFIG, mockLogger);

    expect(result).toBe(true);
    const createMock = mockClient.createMailbox as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenCalledWith(['Actions', '\uD83D\uDEAB Block Sender']);
    expect(createMock).toHaveBeenCalledWith(['Actions', '\u2705 Unblock Sender']);
  });

  it('uses custom prefix in paths', async () => {
    const customConfig: ActionFolderConfig = {
      ...DEFAULT_CONFIG,
      prefix: 'MyActions',
    };
    const statusMock = vi.fn().mockRejectedValue(new Error('Mailbox not found'));
    mockClient = createMockClient({ status: statusMock as unknown as ImapClient['status'] });

    await ensureActionFolders(mockClient, customConfig, mockLogger);

    // status should be called with custom prefix
    expect(statusMock).toHaveBeenCalledWith('MyActions/\u2B50 VIP Sender');

    // createMailbox should use array form with custom prefix
    const createMock = mockClient.createMailbox as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledWith(['MyActions', '\u2B50 VIP Sender']);
  });
});
