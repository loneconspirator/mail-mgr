import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionFolderPoller } from '../../../src/action-folders/poller.js';
import type { ActionFolderPollerDeps } from '../../../src/action-folders/poller.js';
import type { ImapClient } from '../../../src/imap/client.js';
import type { ConfigRepository } from '../../../src/config/repository.js';
import type { ActionFolderProcessor } from '../../../src/action-folders/processor.js';
import type { ActionFolderConfig } from '../../../src/config/schema.js';
import type { ReviewMessage } from '../../../src/imap/messages.js';
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

const EXPECTED_PATHS = [
  'Actions/VIP Sender',
  'Actions/Block Sender',
  'Actions/Undo VIP',
  'Actions/Unblock Sender',
];

function makeReviewMessage(uid: number = 1): ReviewMessage {
  return {
    uid,
    envelope: {
      messageId: `<test-${uid}@example.com>`,
      from: { address: 'sender@test.com', name: 'Sender' },
      to: [{ address: 'me@test.com', name: '' }],
      cc: [],
      subject: 'Test',
    },
    internalDate: new Date(),
    flags: new Set(),
    visibility: 'direct',
  };
}

function createMockClient() {
  return {
    status: vi.fn().mockResolvedValue({ messages: 0, unseen: 0 }),
    fetchAllMessages: vi.fn().mockResolvedValue([]),
  } as unknown as ImapClient;
}

function createMockConfigRepo() {
  return {
    getActionFolderConfig: vi.fn().mockReturnValue(DEFAULT_CONFIG),
  } as unknown as ConfigRepository;
}

function createMockProcessor() {
  return {
    processMessage: vi.fn().mockResolvedValue({ ok: true, action: 'vip', sender: 'sender@test.com' }),
  } as unknown as ActionFolderProcessor;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createDeps(overrides?: Partial<ActionFolderPollerDeps>): ActionFolderPollerDeps {
  return {
    client: createMockClient(),
    configRepo: createMockConfigRepo(),
    processor: createMockProcessor(),
    logger: createMockLogger(),
    pollIntervalMs: 15_000,
    ...overrides,
  };
}

describe('ActionFolderPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scanAll - status checks', () => {
    it('calls status() for all 4 action folder paths', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const statusMock = deps.client.status as ReturnType<typeof vi.fn>;
      expect(statusMock).toHaveBeenCalledTimes(4);
      for (const path of EXPECTED_PATHS) {
        expect(statusMock).toHaveBeenCalledWith(path);
      }
    });

    it('constructs folder paths from config prefix and folder names', async () => {
      const customConfig: ActionFolderConfig = {
        enabled: true,
        prefix: 'MyActions',
        pollInterval: 30,
        folders: { vip: 'A', block: 'B', undoVip: 'C', unblock: 'D' },
      };
      const deps = createDeps();
      (deps.configRepo.getActionFolderConfig as ReturnType<typeof vi.fn>).mockReturnValue(customConfig);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const statusMock = deps.client.status as ReturnType<typeof vi.fn>;
      expect(statusMock).toHaveBeenCalledWith('MyActions/A');
      expect(statusMock).toHaveBeenCalledWith('MyActions/B');
      expect(statusMock).toHaveBeenCalledWith('MyActions/C');
      expect(statusMock).toHaveBeenCalledWith('MyActions/D');
    });
  });

  describe('scanAll - fetch and process', () => {
    it('does NOT fetchAllMessages for empty folders and logs sentinel missing', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      // Should log debug with sentinel missing/empty message
      const debugMock = deps.logger.debug as ReturnType<typeof vi.fn>;
      expect(debugMock).toHaveBeenCalledWith(
        expect.objectContaining({ folder: expect.any(String) }),
        expect.stringContaining('sentinel missing'),
      );
    });

    it('does NOT fetchAllMessages when folder has exactly 1 message (sentinel only)', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // vip - sentinel only
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // unblock
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      const debugMock = deps.logger.debug as ReturnType<typeof vi.fn>;
      expect(debugMock).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Actions/VIP Sender' }),
        expect.stringContaining('only sentinel'),
      );
    });

    it('calls fetchAllMessages when folder has 2 messages', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValue({ messages: 0, unseen: 0 }); // re-checks
      const msgs = [makeReviewMessage(1), makeReviewMessage(2)];
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(msgs);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('Actions/VIP Sender');
    });

    it('skips sentinel-only folder but processes folder with real messages', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // vip - sentinel only, skip
        .mockResolvedValueOnce({ messages: 3, unseen: 0 }) // block - has real messages
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValue({ messages: 0, unseen: 0 }); // re-checks
      const msgs = [makeReviewMessage(1), makeReviewMessage(2), makeReviewMessage(3)];
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(msgs);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      // Only block folder should have fetchAllMessages called
      const fetchMock = deps.client.fetchAllMessages as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('Actions/Block Sender');
      expect(fetchMock).not.toHaveBeenCalledWith('Actions/VIP Sender');
    });

    it('calls fetchAllMessages for folders with messages > 0', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock — first pass
        .mockResolvedValue({ messages: 0, unseen: 0 }); // re-checks
      const msgs = [makeReviewMessage(1), makeReviewMessage(2)];
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(msgs);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('Actions/VIP Sender');
    });

    it('converts ReviewMessage via reviewMessageToEmailMessage and calls processor.processMessage', async () => {
      const deps = createDeps();
      const msg1 = makeReviewMessage(5);
      const msg2 = makeReviewMessage(6);
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip - 2 messages so it won't be skipped
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValue({ messages: 0, unseen: 0 }); // re-checks
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([msg1, msg2]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const processMock = deps.processor.processMessage as ReturnType<typeof vi.fn>;
      expect(processMock).toHaveBeenCalledTimes(2);
      // The converted EmailMessage should have the same uid
      expect(processMock).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 5, messageId: '<test-5@example.com>' }),
        'vip',
      );
    });

    it('processes messages from multiple non-empty folders', async () => {
      const deps = createDeps();
      // Call order: vip initial -> vip re-check -> block initial -> block re-check -> undoVip -> unblock
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial (2 = sentinel + real)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // block initial (2 = sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip re-check
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // block re-check
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeReviewMessage(1), makeReviewMessage(10)])
        .mockResolvedValueOnce([makeReviewMessage(2), makeReviewMessage(20)]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const processMock = deps.processor.processMessage as ReturnType<typeof vi.fn>;
      expect(processMock).toHaveBeenCalledTimes(4);
      expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ uid: 1 }), 'vip');
      expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ uid: 2 }), 'block');
    });
  });

  describe('scanAll - always-empty invariant', () => {
    it('does a STATUS re-check after processing a non-empty folder', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial (sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // vip re-check
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([makeReviewMessage(1), makeReviewMessage(2)]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const statusMock = deps.client.status as ReturnType<typeof vi.fn>;
      // 4 initial + 1 re-check = 5
      expect(statusMock).toHaveBeenCalledTimes(5);
    });

    it('retries once if messages remain after first processing pass', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial (sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip re-check: still has messages
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // vip final check after retry
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeReviewMessage(1), makeReviewMessage(10)])  // first pass
        .mockResolvedValueOnce([makeReviewMessage(2)]); // retry pass
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      // fetchAllMessages called twice for VIP folder (original + retry)
      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
      // processMessage called 3 times (2 first pass + 1 retry)
      expect(deps.processor.processMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
    });

    it('logs a warning if messages still remain after retry', async () => {
      const deps = createDeps();
      // Call order: vip initial -> block -> undoVip -> unblock -> vip re-check -> vip final
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial (sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip re-check: still has messages
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }); // vip final check: STILL has messages
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>)
        .mockResolvedValue([makeReviewMessage(1), makeReviewMessage(2)]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const warnMock = deps.logger.warn as ReturnType<typeof vi.fn>;
      // Should warn twice: once for retry, once for persistent messages
      expect(warnMock).toHaveBeenCalledTimes(2);
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Actions/VIP Sender' }),
        expect.stringContaining('remain'),
      );
    });

    it('does not retry if re-check shows 0 messages', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial (sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // unblock
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }); // vip re-check: all clear
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([makeReviewMessage(1), makeReviewMessage(2)]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      // fetchAllMessages called only once (no retry)
      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    });
  });

  describe('scanAll - overlap guard', () => {
    it('returns immediately if already processing (no-op)', async () => {
      // Use real timers for this test — fake timers interfere with hanging promises
      vi.useRealTimers();
      const deps = createDeps();
      // Collect all resolve callbacks so we can resolve them all at cleanup
      const resolvers: Array<(val: { messages: number; unseen: number }) => void> = [];
      (deps.client.status as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );
      const poller = new ActionFolderPoller(deps);

      // Start first scanAll (will hang on first status call)
      const first = poller.scanAll();

      // Give microtask queue a tick so the first call enters processing
      await Promise.resolve();

      // Second scanAll should return immediately
      await poller.scanAll();

      // Only 1 status call (from the first scan that's still in progress)
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);

      // Clean up: resolve all hanging promises so scanAll can complete
      for (const resolve of resolvers) resolve({ messages: 0, unseen: 0 });
      // Replace with simple mock so remaining calls resolve immediately
      (deps.client.status as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: 0, unseen: 0 });
      await first;
      vi.useFakeTimers();
    });

    it('logs debug message when skipping due to overlap', async () => {
      vi.useRealTimers();
      const deps = createDeps();
      const resolvers: Array<(val: { messages: number; unseen: number }) => void> = [];
      (deps.client.status as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );
      const poller = new ActionFolderPoller(deps);

      const first = poller.scanAll();
      await Promise.resolve();
      await poller.scanAll();

      expect(deps.logger.debug as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.stringContaining('skipped'),
      );

      // Clean up
      for (const resolve of resolvers) resolve({ messages: 0, unseen: 0 });
      (deps.client.status as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: 0, unseen: 0 });
      await first;
      vi.useFakeTimers();
    });

    it('resets processing flag after scanAll completes (allows next call)', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();
      await poller.scanAll();

      // Both calls should have run (8 status calls total = 4 + 4)
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(8);
    });
  });

  describe('scanAll - error handling', () => {
    it('continues to next folder when one folder errors', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('IMAP error on vip'))  // vip fails
        .mockResolvedValueOnce({ messages: 2, unseen: 0 })       // block has messages (sentinel + real)
        .mockResolvedValueOnce({ messages: 0, unseen: 0 })       // undoVip
        .mockResolvedValueOnce({ messages: 0, unseen: 0 })       // unblock
        .mockResolvedValue({ messages: 0, unseen: 0 });          // re-checks
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([makeReviewMessage(1), makeReviewMessage(2)]);
      const poller = new ActionFolderPoller(deps);

      // Should not throw
      await poller.scanAll();

      // Block folder was still processed
      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('Actions/Block Sender');
      // Error was logged
      expect(deps.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Actions/VIP Sender' }),
        expect.stringContaining('Error'),
      );
    });

    it('skips processing if config.enabled is false', async () => {
      const deps = createDeps();
      const disabledConfig = { ...DEFAULT_CONFIG, enabled: false };
      (deps.configRepo.getActionFolderConfig as ReturnType<typeof vi.fn>).mockReturnValue(disabledConfig);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.status as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('resets processing flag even when error occurs', async () => {
      const deps = createDeps();
      (deps.configRepo.getActionFolderConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Config error');
      });
      const poller = new ActionFolderPoller(deps);

      // The config error propagates, but finally block resets processing flag
      await expect(poller.scanAll()).rejects.toThrow('Config error');

      // After error, processing flag should be reset so next call works
      (deps.configRepo.getActionFolderConfig as ReturnType<typeof vi.fn>).mockReturnValue(DEFAULT_CONFIG);
      await poller.scanAll();
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(4);
    });
  });

  describe('start/stop', () => {
    it('start() creates an interval that calls scanAll periodically', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      poller.start();

      // Advance timer by one interval
      await vi.advanceTimersByTimeAsync(15_000);

      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalled();

      poller.stop();
    });

    it('stop() clears the interval timer', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      poller.start();
      poller.stop();

      // Advance timer — scanAll should NOT be called
      await vi.advanceTimersByTimeAsync(15_000);

      expect(deps.client.status as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('start() calls .unref() on the timer', () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      // Spy on setInterval to verify unref
      const mockTimer = { unref: vi.fn() };
      const origSetInterval = globalThis.setInterval;
      vi.spyOn(globalThis, 'setInterval').mockReturnValue(mockTimer as unknown as ReturnType<typeof setInterval>);

      poller.start();

      expect(mockTimer.unref).toHaveBeenCalled();

      // Restore
      globalThis.setInterval = origSetInterval;
      poller.stop();
    });

    it('stop() is safe to call when no timer is active', () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      // Should not throw
      expect(() => poller.stop()).not.toThrow();
    });
  });
});
