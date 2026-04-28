/**
 * Integration test for IX-007 — Action folder polling and message dispatch.
 *
 * Spec: specs/integrations/ix-007-action-folder-polling-and-dispatch.md
 *
 * This file exercises the ActionFolderPoller in isolation from the rule
 * mutation logic — the poller is wired to a stub processor so we can prove
 * each named interaction without the noise of IX-008's rule logic. IX-008
 * has its own end-to-end coverage in
 * test/acceptance/uc_002_action_folder_drag_creates_or_removes_rule.test.ts.
 *
 * Named-interaction coverage:
 *   IX-007.1 — timer fires (manual scanAll() stands in for the tick); the
 *              single-flight guard short-circuits an overlapping scan.
 *   IX-007.2 — config drives behavior; disabled config skips the IMAP layer.
 *   IX-007.3 — four folder paths are resolved from `<prefix>/<folderName>`
 *              and used as-is on the IMAP client.
 *   IX-007.4 — STATUS-based skip: count===0 (sentinel missing) and count===1
 *              (sentinel only) bypass FETCH; count>1 triggers FETCH.
 *   IX-007.5 — when count>1, fetchAllMessages() is called and each message
 *              is dispatched to the processor with the resolved actionType.
 *   IX-007.6 — sentinel handling on the dispatch side: the processor's
 *              sentinel guard is invoked for every dispatched message; we
 *              assert the poller hands the processor whatever STATUS+FETCH
 *              produced and lets the processor classify it.
 *   IX-007.7 — recheck after process: the poller calls STATUS again after
 *              processing a non-empty folder; if remaining count exceeds the
 *              known sentinel count, it performs one retry pass.
 *   IX-007.8 — per-folder error isolation: an error scanning one folder
 *              does not abort the rest of the scan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionFolderPoller } from '../../src/action-folders/poller.js';
import type { ActionFolderPollerDeps } from '../../src/action-folders/poller.js';
import type { ImapClient } from '../../src/imap/client.js';
import type { ConfigRepository } from '../../src/config/repository.js';
import type { ActionFolderProcessor } from '../../src/action-folders/processor.js';
import type { ActionFolderConfig } from '../../src/config/schema.js';
import type { ReviewMessage } from '../../src/imap/messages.js';
import type { Logger } from 'pino';

const DEFAULT_CONFIG: ActionFolderConfig = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: 'VIP',
    block: 'Block',
    undoVip: 'UndoVIP',
    unblock: 'Unblock',
  },
};

const VIP_PATH = 'Actions/VIP';
const BLOCK_PATH = 'Actions/Block';
const UNDO_VIP_PATH = 'Actions/UndoVIP';
const UNBLOCK_PATH = 'Actions/Unblock';
const ALL_PATHS = [VIP_PATH, BLOCK_PATH, UNDO_VIP_PATH, UNBLOCK_PATH];

function makeReviewMessage(uid: number): ReviewMessage {
  return {
    uid,
    envelope: {
      messageId: `<msg-${uid}@example.com>`,
      from: { address: 'sender@example.com', name: 'Sender' },
      to: [{ address: 'me@example.com', name: '' }],
      cc: [],
      subject: `Test ${uid}`,
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

function createMockConfigRepo(config: ActionFolderConfig = DEFAULT_CONFIG) {
  return {
    getActionFolderConfig: vi.fn().mockReturnValue(config),
  } as unknown as ConfigRepository;
}

function createStubProcessor() {
  return {
    processMessage: vi
      .fn()
      .mockResolvedValue({ ok: true, action: 'vip', sender: 'sender@example.com' }),
  } as unknown as ActionFolderProcessor;
}

function createSilentLogger(): Logger {
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
    processor: createStubProcessor(),
    logger: createSilentLogger(),
    pollIntervalMs: 15_000,
    ...overrides,
  };
}

describe('IX-007 — Action folder polling and message dispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('IX-007.1: timer firing and single-flight guard', () => {
    it('IX-007.1: start() schedules scanAll on the configured interval', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      poller.start();
      await vi.advanceTimersByTimeAsync(15_000);

      // After one interval, the poller has reached out to IMAP — proxy for
      // "the tick fired and scanAll ran".
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalled();
      poller.stop();
    });

    it('IX-007.1: an overlapping scanAll is skipped while one is in flight', async () => {
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

      // Only the first scan reached the IMAP layer; the second was skipped.
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);

      for (const resolve of resolvers) resolve({ messages: 0, unseen: 0 });
      (deps.client.status as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: 0, unseen: 0 });
      await first;
      vi.useFakeTimers();
    });
  });

  describe('IX-007.2: config gating', () => {
    it('IX-007.2: config is read from the repository on every scan', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();
      await poller.scanAll();

      expect(deps.configRepo.getActionFolderConfig as ReturnType<typeof vi.fn>)
        .toHaveBeenCalledTimes(2);
    });

    it('IX-007.2: enabled=false short-circuits before any IMAP call', async () => {
      const deps = createDeps({
        configRepo: createMockConfigRepo({ ...DEFAULT_CONFIG, enabled: false }),
      });
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.status as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
  });

  describe('IX-007.3: folder path resolution', () => {
    it('IX-007.3: resolves all four <prefix>/<folder> paths from config', async () => {
      const deps = createDeps();
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const statusMock = deps.client.status as ReturnType<typeof vi.fn>;
      for (const p of ALL_PATHS) {
        expect(statusMock).toHaveBeenCalledWith(p);
      }
    });

    it('IX-007.3: prefix and folder names from config are used verbatim', async () => {
      const customConfig: ActionFolderConfig = {
        enabled: true,
        prefix: 'mail-mgr',
        pollInterval: 30,
        folders: { vip: 'VIP Sender', block: 'Block Sender', undoVip: 'Undo VIP', unblock: 'Unblock Sender' },
      };
      const deps = createDeps({ configRepo: createMockConfigRepo(customConfig) });
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const statusMock = deps.client.status as ReturnType<typeof vi.fn>;
      expect(statusMock).toHaveBeenCalledWith('mail-mgr/VIP Sender');
      expect(statusMock).toHaveBeenCalledWith('mail-mgr/Block Sender');
      expect(statusMock).toHaveBeenCalledWith('mail-mgr/Undo VIP');
      expect(statusMock).toHaveBeenCalledWith('mail-mgr/Unblock Sender');
    });
  });

  describe('IX-007.4: STATUS-based skip logic', () => {
    it('IX-007.4: count===0 (sentinel missing) does not call FETCH', async () => {
      const deps = createDeps();
      // Default mock returns messages: 0 for every status call.
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('IX-007.4: count===1 (sentinel only) does not call FETCH', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // vip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('IX-007.4: count>1 triggers FETCH on that folder only', async () => {
      const deps = createDeps();
      // STATUS is called inline per folder: initial → (if work) recheck.
      // Sequence: vip(2) → vip recheck(0) → block(1) → undoVip(0) → unblock(1).
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial — has real message
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip recheck — clean
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block — sentinel only
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // undoVip — empty
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock — sentinel only
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage(1),
        makeReviewMessage(2),
      ]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const fetchMock = deps.client.fetchAllMessages as ReturnType<typeof vi.fn>;
      // Only the VIP folder met the count>1 condition; FETCH ran once.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(VIP_PATH);
    });
  });

  describe('IX-007.5: dispatch to processor with resolved actionType', () => {
    it('IX-007.5: each fetched message is handed to the processor with the folder\'s actionType', async () => {
      const deps = createDeps();
      // Sequence: vip initial → vip recheck → block → undoVip → unblock.
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip recheck — clean
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage(7),
        makeReviewMessage(8),
      ]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      const processMock = deps.processor.processMessage as ReturnType<typeof vi.fn>;
      expect(processMock).toHaveBeenCalledTimes(2);
      expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ uid: 7 }), 'vip');
      expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ uid: 8 }), 'vip');
    });

    it('IX-007.5: a non-empty Block folder dispatches with actionType=block', async () => {
      const deps = createDeps();
      // Sequence: vip → block initial → block recheck → undoVip → unblock.
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // vip
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // block initial
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // block recheck — clean
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage(9),
      ]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.processor.processMessage as ReturnType<typeof vi.fn>)
        .toHaveBeenCalledWith(expect.objectContaining({ uid: 9 }), 'block');
    });
  });

  describe('IX-007.6: sentinel handling on dispatch', () => {
    it('IX-007.6: every fetched message is forwarded to the processor — sentinel classification is the processor\'s job', async () => {
      // The poller does not pre-filter sentinels; it dispatches everything
      // FETCH returns and trusts the processor's sentinel guard. We assert
      // that a fetched batch containing what *would* be a sentinel still
      // reaches the processor (the processor records the sentinel hit so
      // the poller can distinguish "sentinel residue" from "stuck message").
      const deps = createDeps();
      // Sequence: vip initial → vip recheck → block → undoVip → unblock.
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip recheck — clean (no retry)
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      const sentinelLike = makeReviewMessage(1);
      const real = makeReviewMessage(2);
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([sentinelLike, real]);
      // Stub: processor reports the first as a sentinel hit, the second as a
      // real action-folder message.
      const processor = createStubProcessor();
      (processor.processMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, sentinel: true })
        .mockResolvedValueOnce({ ok: true, action: 'vip', sender: 'sender@example.com' });
      const poller = new ActionFolderPoller({ ...deps, processor });

      await poller.scanAll();

      expect(processor.processMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    });
  });

  describe('IX-007.7: recheck and retry', () => {
    it('IX-007.7: STATUS is called again after processing a non-empty folder', async () => {
      const deps = createDeps();
      // Sequence: vip initial → vip recheck → block → undoVip → unblock.
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip recheck — clean
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage(1),
      ]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      // 4 initial + 1 re-check on vip = 5
      expect(deps.client.status as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(5);
    });

    it('IX-007.7: a single retry pass runs when residual count exceeds sentinel count', async () => {
      const deps = createDeps();
      // Sequence: vip initial → vip recheck (still has) → vip final → block → undoVip → unblock.
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip initial
        .mockResolvedValueOnce({ messages: 2, unseen: 0 }) // vip recheck: stuck message
        .mockResolvedValueOnce({ messages: 0, unseen: 0 }) // vip final check after retry
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // block
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }) // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 }); // unblock
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeReviewMessage(1)])
        .mockResolvedValueOnce([makeReviewMessage(2)]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
      // First pass + retry = 2 dispatches.
      expect(deps.processor.processMessage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    });
  });

  describe('IX-007.8: per-folder error isolation', () => {
    it('IX-007.8: a STATUS error on one folder does not abort the rest of the scan', async () => {
      const deps = createDeps();
      (deps.client.status as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('IMAP error on vip'))   // vip explodes
        .mockResolvedValueOnce({ messages: 2, unseen: 0 })       // block has work
        .mockResolvedValueOnce({ messages: 1, unseen: 0 })       // undoVip
        .mockResolvedValueOnce({ messages: 1, unseen: 0 })       // unblock
        .mockResolvedValue({ messages: 0, unseen: 0 });          // re-checks
      (deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage(11),
      ]);
      const poller = new ActionFolderPoller(deps);

      await poller.scanAll();

      // Block was still processed despite vip's failure.
      expect(deps.client.fetchAllMessages as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(BLOCK_PATH);
      expect(deps.processor.processMessage as ReturnType<typeof vi.fn>)
        .toHaveBeenCalledWith(expect.objectContaining({ uid: 11 }), 'block');
      // The error was logged.
      expect(deps.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.objectContaining({ folder: VIP_PATH }),
        expect.stringContaining('Error'),
      );
    });
  });
});
