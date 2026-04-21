import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImapClient, type ImapFlowLike, type ImapFlowFactory } from '../../../src/imap/index.js';
import { FolderCache } from '../../../src/folders/cache.js';
import type { ImapConfig } from '../../../src/config/index.js';

const TEST_CONFIG: ImapConfig = {
  host: 'imap.example.com',
  port: 993,
  tls: true,
  auth: { user: 'test@example.com', pass: 'secret' },
  idleTimeout: 300_000,
  pollInterval: 60_000,
};

function createMockFlow(overrides: Partial<ImapFlowLike> = {}): ImapFlowLike & { emit(event: string, ...args: unknown[]): void } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    usable: true,
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    mailboxOpen: vi.fn(async () => ({})),
    noop: vi.fn(async () => {}),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    mailboxCreate: vi.fn(async () => ({})),
    mailboxRename: vi.fn(async () => ({})),
    messageMove: vi.fn(async () => ({})),
    fetch: vi.fn(async function* () {}),
    list: vi.fn(async () => []),
    status: vi.fn(async () => ({ messages: 0, unseen: 0 })),
    listTree: vi.fn(async () => ({ folders: [] })),
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
      return this;
    },
    removeAllListeners(event?: string) {
      if (event) listeners.delete(event);
      else listeners.clear();
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    ...overrides,
  } as ImapFlowLike & { emit(event: string, ...args: unknown[]): void };
}

describe('ImapClient.renameFolder', () => {
  let mockFlow: ReturnType<typeof createMockFlow>;
  let factory: ImapFlowFactory;
  let client: ImapClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFlow = createMockFlow();
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls flow.mailboxRename with correct old/new paths', async () => {
    await client.connect();

    await client.renameFolder('OldFolder', 'NewFolder');

    expect(mockFlow.mailboxRename).toHaveBeenCalledWith('OldFolder', 'NewFolder');
  });

  it('acquires INBOX lock before renaming', async () => {
    await client.connect();

    await client.renameFolder('OldFolder', 'NewFolder');

    expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('INBOX');
  });

  it('throws if not connected (flow is null)', async () => {
    // Don't connect - flow is null
    await expect(client.renameFolder('Old', 'New')).rejects.toThrow('Not connected');
  });
});

describe('FolderCache.renameFolder', () => {
  it('calls imapClient.renameFolder then calls refresh()', async () => {
    const mockImapClient = {
      renameFolder: vi.fn(async () => {}),
      listFolders: vi.fn(async () => []),
    } as any;

    const cache = new FolderCache({ imapClient: mockImapClient, ttlMs: 60_000 });

    await cache.renameFolder('OldPath', 'NewPath');

    expect(mockImapClient.renameFolder).toHaveBeenCalledWith('OldPath', 'NewPath');
    expect(mockImapClient.listFolders).toHaveBeenCalled(); // refresh() calls listFolders
  });

  it('propagates errors from imapClient.renameFolder', async () => {
    const mockImapClient = {
      renameFolder: vi.fn(async () => { throw new Error('IMAP rename failed'); }),
      listFolders: vi.fn(async () => []),
    } as any;

    const cache = new FolderCache({ imapClient: mockImapClient, ttlMs: 60_000 });

    await expect(cache.renameFolder('Old', 'New')).rejects.toThrow('IMAP rename failed');
  });
});
