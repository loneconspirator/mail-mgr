import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DestinationResolver } from '../../../src/tracking/destinations.js';
import type { DestinationResolverDeps } from '../../../src/tracking/destinations.js';

/** Helper to build a mock flow that returns messages for specific folders. */
function createMockDeps(folderMessages: Record<string, string[]>): DestinationResolverDeps {
  const fetchImpl = async (folder: string, fn: (flow: unknown) => Promise<unknown>) => {
    const messages = folderMessages[folder] ?? [];
    const flow = {
      fetch: async function* (_range: string, _query: Record<string, unknown>) {
        for (const messageId of messages) {
          yield { uid: Math.floor(Math.random() * 10000), envelope: { messageId } };
        }
      },
    };
    return fn(flow);
  };
  const mockClient = {
    withMailboxLock: vi.fn(fetchImpl),
    withMailboxSwitch: vi.fn(fetchImpl),
  };

  const mockActivityLog = {
    getRecentFolders: vi.fn((_limit: number): string[] => []),
  };

  const allFolders = Object.keys(folderMessages).map((path) => ({
    path,
    flags: [] as string[],
  }));

  const mockListFolders = vi.fn(async () => allFolders);

  return {
    client: mockClient as unknown as DestinationResolverDeps['client'],
    activityLog: mockActivityLog as unknown as DestinationResolverDeps['activityLog'],
    listFolders: mockListFolders,
  };
}

describe('DestinationResolver', () => {
  describe('fast pass', () => {
    it('finds message in a recent folder returned by activityLog.getRecentFolders(10)', async () => {
      const deps = createMockDeps({
        'Projects': ['<msg-1@test.com>'],
        'INBOX': [],
      });
      (deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue(['Projects']);

      const resolver = new DestinationResolver(deps);
      const result = await resolver.resolveFast('<msg-1@test.com>', 'INBOX');

      expect(result).toBe('Projects');
    });

    it('finds message in hardcoded common folder "Archive"', async () => {
      const deps = createMockDeps({
        'Archive': ['<msg-2@test.com>'],
        'INBOX': [],
      });

      const resolver = new DestinationResolver(deps);
      const result = await resolver.resolveFast('<msg-2@test.com>', 'INBOX');

      expect(result).toBe('Archive');
    });

    it('returns null when message not found in any fast-pass candidate', async () => {
      const deps = createMockDeps({
        'Archive': [],
        'Trash': [],
        'INBOX': ['<msg-3@test.com>'],
      });

      const resolver = new DestinationResolver(deps);
      const result = await resolver.resolveFast('<msg-3@test.com>', 'INBOX');

      expect(result).toBeNull();
    });

    it('deduplicates candidates (recent folder overlapping with common names)', async () => {
      const deps = createMockDeps({
        'Archive': ['<msg-4@test.com>'],
        'INBOX': [],
      });
      (deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue(['Archive']);

      const resolver = new DestinationResolver(deps);
      await resolver.resolveFast('<msg-4@test.com>', 'INBOX');

      // Archive should only be searched once even though it appears in both recent and common
      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const archiveCalls = switchCalls.filter((c: unknown[]) => c[0] === 'Archive');
      expect(archiveCalls).toHaveLength(1);
    });

    it('skips source folder in candidate list', async () => {
      const deps = createMockDeps({
        'INBOX': ['<msg-5@test.com>'],
        'Archive': [],
      });
      (deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue(['INBOX']);

      const resolver = new DestinationResolver(deps);
      await resolver.resolveFast('<msg-5@test.com>', 'INBOX');

      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const inboxCalls = switchCalls.filter((c: unknown[]) => c[0] === 'INBOX');
      expect(inboxCalls).toHaveLength(0);
    });
  });

  describe('deep scan', () => {
    it('finds message in an uncommon folder not in fast-pass list', async () => {
      const deps = createMockDeps({
        'Receipts/2024': ['<msg-6@test.com>'],
        'INBOX': [],
      });

      const resolver = new DestinationResolver(deps);
      resolver.enqueueDeepScan('<msg-6@test.com>', 'INBOX');
      const results = await resolver.runDeepScan();

      expect(results.get('<msg-6@test.com>')).toBe('Receipts/2024');
    });

    it('returns empty map when nothing found (D-06: dropped)', async () => {
      const deps = createMockDeps({
        'SomeFolder': [],
        'INBOX': [],
      });

      const resolver = new DestinationResolver(deps);
      resolver.enqueueDeepScan('<msg-7@test.com>', 'INBOX');
      const results = await resolver.runDeepScan();

      expect(results.size).toBe(0);
    });

    it('skips non-selectable folders', async () => {
      const allFolders = [
        { path: 'NonSelectable', flags: ['\\Noselect'] },
        { path: 'Selectable', flags: [] },
      ];
      const deps = createMockDeps({
        'NonSelectable': ['<msg-8@test.com>'],
        'Selectable': [],
        'INBOX': [],
      });
      (deps.listFolders as ReturnType<typeof vi.fn>).mockResolvedValue(allFolders);

      const resolver = new DestinationResolver(deps);
      resolver.enqueueDeepScan('<msg-8@test.com>', 'INBOX');
      const results = await resolver.runDeepScan();

      // Should not find it because NonSelectable is skipped
      expect(results.size).toBe(0);
    });

    it('skips source folder in deep scan', async () => {
      const deps = createMockDeps({
        'INBOX': ['<msg-9@test.com>'],
        'OtherFolder': [],
      });

      const resolver = new DestinationResolver(deps);
      resolver.enqueueDeepScan('<msg-9@test.com>', 'INBOX');
      const results = await resolver.runDeepScan();

      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const inboxCalls = switchCalls.filter((c: unknown[]) => c[0] === 'INBOX');
      expect(inboxCalls).toHaveLength(0);
      expect(results.size).toBe(0);
    });
  });

  describe('INBOX exclusion (260430-msg)', () => {
    it('excludes INBOX from fast-pass candidates even when getRecentFolders returns it', async () => {
      // Source is the review folder; INBOX is in recentFolders pool (seeded by
      // VIP/undoVip/unblock action-folder activity). Both INBOX and Projects
      // contain the message-id, but resolver must pick Projects, never INBOX.
      const deps = createMockDeps({
        'INBOX': ['<msg-inbox-1@test.com>'],
        'Projects': ['<msg-inbox-1@test.com>'],
      });
      (deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue(['INBOX', 'Projects']);

      const resolver = new DestinationResolver(deps);
      const result = await resolver.resolveFast('<msg-inbox-1@test.com>', 'Review');

      expect(result).toBe('Projects');

      // Belt-and-suspenders: ensure INBOX was NEVER searched in fast-pass.
      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const inboxCalls = switchCalls.filter((c: unknown[]) => c[0] === 'INBOX');
      expect(inboxCalls).toHaveLength(0);
    });

    it('excludes INBOX from deep-scan candidates even when listFolders returns it', async () => {
      // listFolders returns INBOX + Projects, but only INBOX has the message.
      // Per D-06: when no non-INBOX folder matches, the message is dropped
      // (results map has no entry for it).
      const allFolders = [
        { path: 'INBOX', flags: [] as string[] },
        { path: 'Projects', flags: [] as string[] },
      ];
      const deps = createMockDeps({
        'INBOX': ['<msg-inbox-2@test.com>'],
        'Projects': [],
      });
      (deps.listFolders as ReturnType<typeof vi.fn>).mockResolvedValue(allFolders);

      const resolver = new DestinationResolver(deps);
      resolver.enqueueDeepScan('<msg-inbox-2@test.com>', 'Review');
      const results = await resolver.runDeepScan();

      // INBOX must not appear as the resolved destination.
      expect(results.has('<msg-inbox-2@test.com>')).toBe(false);

      // INBOX must not be searched at all in deep scan.
      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const inboxCalls = switchCalls.filter((c: unknown[]) => c[0] === 'INBOX');
      expect(inboxCalls).toHaveLength(0);
    });

    it('excludes lowercase "inbox" case-insensitively from fast-pass', async () => {
      // Case-insensitive guard catches non-canonical 'inbox' / 'Inbox' too.
      const deps = createMockDeps({
        'inbox': ['<msg-inbox-3@test.com>'],
        'Projects': ['<msg-inbox-3@test.com>'],
      });
      (deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue(['inbox', 'Projects']);

      const resolver = new DestinationResolver(deps);
      const result = await resolver.resolveFast('<msg-inbox-3@test.com>', 'Review');

      expect(result).toBe('Projects');
      const switchCalls = (deps.client as { withMailboxSwitch: ReturnType<typeof vi.fn> }).withMailboxSwitch.mock.calls;
      const lowerInboxCalls = switchCalls.filter((c: unknown[]) => c[0] === 'inbox');
      expect(lowerInboxCalls).toHaveLength(0);
    });
  });
});
