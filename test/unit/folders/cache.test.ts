import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderCache } from '../../../src/folders/index.js';
import type { FolderNode } from '../../../src/shared/types.js';
import type { ImapClient } from '../../../src/imap/index.js';

const SAMPLE_TREE: FolderNode[] = [
  {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    flags: ['\\HasNoChildren'],
    specialUse: '\\Inbox',
    children: [],
  },
  {
    path: 'Archive',
    name: 'Archive',
    delimiter: '/',
    flags: ['\\HasChildren'],
    children: [
      {
        path: 'Archive/2024',
        name: '2024',
        delimiter: '/',
        flags: [],
        children: [],
      },
    ],
  },
  {
    path: 'Sent',
    name: 'Sent',
    delimiter: '/',
    flags: [],
    specialUse: '\\Sent',
    children: [],
  },
];

function createMockImapClient(overrides: Partial<ImapClient> = {}): ImapClient {
  return {
    listFolders: vi.fn(async () => SAMPLE_TREE),
    ...overrides,
  } as unknown as ImapClient;
}

describe('FolderCache', () => {
  let mockClient: ImapClient;
  let cache: FolderCache;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = createMockImapClient();
    cache = new FolderCache({ imapClient: mockClient, ttlMs: 300_000 });
  });

  describe('getTree', () => {
    it('fetches from IMAP on first call', async () => {
      const result = await cache.getTree();

      expect(mockClient.listFolders).toHaveBeenCalledOnce();
      expect(result).toEqual(SAMPLE_TREE);
    });

    it('returns cached data when TTL is fresh', async () => {
      await cache.getTree();
      vi.advanceTimersByTime(100_000); // 100s, well within 300s TTL
      const result = await cache.getTree();

      expect(mockClient.listFolders).toHaveBeenCalledOnce(); // only one call
      expect(result).toEqual(SAMPLE_TREE);
    });

    it('refreshes when TTL is stale', async () => {
      await cache.getTree();
      vi.advanceTimersByTime(300_000); // exactly at TTL boundary
      await cache.getTree();

      expect(mockClient.listFolders).toHaveBeenCalledTimes(2);
    });

    it('forces refresh regardless of TTL when forceRefresh is true', async () => {
      await cache.getTree();
      await cache.getTree(true);

      expect(mockClient.listFolders).toHaveBeenCalledTimes(2);
    });

    it('returns stale cache when IMAP is disconnected but cache exists', async () => {
      await cache.getTree(); // populate cache
      vi.advanceTimersByTime(400_000); // past TTL

      // Make listFolders throw on next call
      (mockClient.listFolders as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Not connected'),
      );

      const result = await cache.getTree();
      expect(result).toEqual(SAMPLE_TREE);
    });

    it('throws when disconnected and no cache exists', async () => {
      (mockClient.listFolders as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Not connected'),
      );

      await expect(cache.getTree()).rejects.toThrow('Not connected');
    });
  });

  describe('hasFolder', () => {
    it('returns true for exact path match', async () => {
      await cache.getTree();
      expect(cache.hasFolder('Archive')).toBe(true);
    });

    it('returns true for nested path match', async () => {
      await cache.getTree();
      expect(cache.hasFolder('Archive/2024')).toBe(true);
    });

    it('returns false for nonexistent path', async () => {
      await cache.getTree();
      expect(cache.hasFolder('Nonexistent')).toBe(false);
    });

    it('returns true for INBOX case-insensitive', async () => {
      await cache.getTree();
      expect(cache.hasFolder('inbox')).toBe(true);
      expect(cache.hasFolder('Inbox')).toBe(true);
      expect(cache.hasFolder('INBOX')).toBe(true);
    });

    it('returns false when cache is empty', () => {
      expect(cache.hasFolder('INBOX')).toBe(false);
    });

    it('is case-sensitive for non-INBOX folders', async () => {
      await cache.getTree();
      expect(cache.hasFolder('archive')).toBe(false);
      expect(cache.hasFolder('Archive')).toBe(true);
    });
  });

  describe('getResponse', () => {
    it('returns correct FolderTreeResponse shape', async () => {
      vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));
      await cache.getTree();

      const response = cache.getResponse();

      expect(response.folders).toEqual(SAMPLE_TREE);
      expect(response.cachedAt).toBe('2026-04-06T12:00:00.000Z');
      expect(response.stale).toBe(false);
    });

    it('reports stale when past TTL', async () => {
      await cache.getTree();
      vi.advanceTimersByTime(300_000);

      const response = cache.getResponse();
      expect(response.stale).toBe(true);
    });

    it('returns empty folders and stale true when no cache', () => {
      const response = cache.getResponse();

      expect(response.folders).toEqual([]);
      expect(response.stale).toBe(true);
    });
  });
});
