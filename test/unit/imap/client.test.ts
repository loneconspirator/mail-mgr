import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImapClient, type ImapFlowLike, type ImapFlowFactory, type ConnectionState, type ReviewMessage, type AppendResponse } from '../../../src/imap/index.js';
import type { ImapConfig } from '../../../src/config/index.js';

const TEST_CONFIG: ImapConfig = {
  host: 'imap.example.com',
  port: 993,
  tls: true,
  auth: { user: 'test@example.com', pass: 'secret' },
  // FM-002 Phase 34: kept at 300_000 (NOT the new schema default of 90_000)
  // to match existing FM-002 test timer math — the existing tests advance
  // timers by exactly 300_000 to drive cycleIdle. Other tests use the
  // schema default (90_000) elsewhere.
  idleTimeout: 300_000,
  pollInterval: 60_000,
};

function createMockFlow(overrides: Partial<ImapFlowLike> = {}): ImapFlowLike {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    usable: true,
    close: vi.fn(),
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    mailboxOpen: vi.fn(async () => ({})),
    noop: vi.fn(async () => {}),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    list: vi.fn(async () => []),
    append: vi.fn(async () => ({ destination: 'TestFolder', uid: 1, uidValidity: BigInt(1), seq: 1 })),
    search: vi.fn(async () => []),
    messageDelete: vi.fn(async () => true),
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
    // helper to emit events from tests
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    ...overrides,
  } as ImapFlowLike & { emit(event: string, ...args: unknown[]): void };
}

describe('ImapClient', () => {
  let mockFlow: ReturnType<typeof createMockFlow> & { emit(event: string, ...args: unknown[]): void };
  let factory: ImapFlowFactory;
  let client: ImapClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFlow = createMockFlow() as ReturnType<typeof createMockFlow> & { emit(event: string, ...args: unknown[]): void };
    factory = vi.fn(() => mockFlow);
    client = new ImapClient(TEST_CONFIG, factory);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('connects, selects INBOX, and emits connected', async () => {
      const connected = vi.fn();
      client.on('connected', connected);

      await client.connect();

      expect(factory).toHaveBeenCalledWith(TEST_CONFIG);
      expect(mockFlow.connect).toHaveBeenCalled();
      expect(mockFlow.mailboxOpen).toHaveBeenCalledWith('INBOX');
      expect(client.state).toBe('connected');
      expect(connected).toHaveBeenCalledOnce();
    });

    it('does nothing if already connected', async () => {
      await client.connect();
      await client.connect();

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('does nothing if currently connecting', async () => {
      // Make connect hang so we stay in connecting state
      const hangingFlow = createMockFlow({
        connect: vi.fn(() => new Promise(() => {})),
      });
      const hangFactory = vi.fn(() => hangingFlow);
      const c = new ImapClient(TEST_CONFIG, hangFactory);

      // Don't await — it'll never resolve
      c.connect();
      c.connect();

      expect(hangFactory).toHaveBeenCalledTimes(1);
    });

    it('emits error and schedules reconnect on connection failure', async () => {
      const error = new Error('Connection refused');
      const failFlow = createMockFlow({
        connect: vi.fn(async () => { throw error; }),
      });
      const failFactory = vi.fn(() => failFlow);
      const c = new ImapClient(TEST_CONFIG, failFactory);

      const errorHandler = vi.fn();
      c.on('error', errorHandler);

      await c.connect();

      expect(c.state).toBe('error');
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    // FM-002 Phase 34 Task 3 (R3): a wedge during reconnect — TLS handshake
    // or SELECT INBOX hanging forever — must not leave the client stuck in
    // 'connecting'. CONNECT_TIMEOUT_MS bounds both calls; the existing
    // catch block routes the timeout to error/emit/scheduleReconnect.
    it('rejects and schedules reconnect when flow.connect hangs past CONNECT_TIMEOUT_MS', async () => {
      const hangFlow = createMockFlow({
        connect: vi.fn(() => new Promise<void>(() => {})), // never resolves
      });
      const f = vi.fn(() => hangFlow);
      const c = new ImapClient(TEST_CONFIG, f);
      const errorSpy = vi.fn();
      c.on('error', errorSpy);

      const connectPromise = c.connect();
      // CONNECT_TIMEOUT_MS = 30_000
      await vi.advanceTimersByTimeAsync(30_000);
      await connectPromise;

      expect(c.state).toBe('error');
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].message).toMatch(/timed out/i);

      // Reconnect happens after backoff (1s).
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('rejects and schedules reconnect when mailboxOpen hangs past CONNECT_TIMEOUT_MS', async () => {
      const hangFlow = createMockFlow({
        mailboxOpen: vi.fn(() => new Promise(() => {})),
      });
      const f = vi.fn(() => hangFlow);
      const c = new ImapClient(TEST_CONFIG, f);
      const errorSpy = vi.fn();
      c.on('error', errorSpy);

      const connectPromise = c.connect();
      await vi.advanceTimersByTimeAsync(30_000);
      await connectPromise;

      expect(c.state).toBe('error');
      expect(errorSpy.mock.calls[0][0].message).toMatch(/SELECT INBOX.*timed out/i);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(f).toHaveBeenCalledTimes(2);
    });
  });

  describe('disconnect', () => {
    it('logs out, cleans up, and emits disconnected', async () => {
      await client.connect();

      const disconnected = vi.fn();
      client.on('disconnected', disconnected);

      await client.disconnect();

      expect(mockFlow.logout).toHaveBeenCalled();
      expect(client.state).toBe('disconnected');
      expect(disconnected).toHaveBeenCalledWith('manual');
    });

    it('handles logout errors gracefully', async () => {
      const failLogout = createMockFlow({
        logout: vi.fn(async () => { throw new Error('logout fail'); }),
      });
      const f = vi.fn(() => failLogout);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();
      await c.disconnect();

      expect(c.state).toBe('disconnected');
    });

    it('prevents auto-reconnect after explicit disconnect', async () => {
      await client.connect();
      await client.disconnect();

      // Simulate unexpected close — should NOT trigger reconnect
      const connectSpy = vi.fn();
      client.on('connected', connectSpy);

      vi.advanceTimersByTime(120_000);

      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('state transitions', () => {
    it('starts disconnected', () => {
      expect(client.state).toBe('disconnected');
    });

    it('transitions disconnected -> connecting -> connected', async () => {
      const states: ConnectionState[] = [];

      // We track state via events since setState is private
      const origConnect = client.connect.bind(client);

      await origConnect();
      expect(client.state).toBe('connected');
    });

    it('transitions to error on connection failure', async () => {
      const failFlow = createMockFlow({
        connect: vi.fn(async () => { throw new Error('fail'); }),
      });
      const c = new ImapClient(TEST_CONFIG, vi.fn(() => failFlow));
      c.on('error', () => {}); // prevent unhandled error throw

      await c.connect();
      expect(c.state).toBe('error');
    });
  });

  describe('auto-reconnect with exponential backoff', () => {
    it('reconnects after unexpected close with exponential backoff', async () => {
      await client.connect();

      // Simulate unexpected disconnect
      mockFlow.emit('close');

      expect(client.state).toBe('disconnected');

      // First reconnect at 1s
      const newFlow = createMockFlow();
      (factory as ReturnType<typeof vi.fn>).mockReturnValueOnce(newFlow);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('doubles backoff on repeated failures', async () => {
      let callCount = 0;
      const failFactory = vi.fn(() => {
        callCount++;
        return createMockFlow({
          connect: vi.fn(async () => { throw new Error(`fail ${callCount}`); }),
        });
      });
      const c = new ImapClient(TEST_CONFIG, failFactory);
      c.on('error', () => {}); // prevent unhandled error throw

      await c.connect(); // first attempt fails
      expect(c.getBackoffMs()).toBe(2_000); // backoff doubled to 2s

      await vi.advanceTimersByTimeAsync(1_000); // 1s reconnect fires
      expect(failFactory).toHaveBeenCalledTimes(2);
      expect(c.getBackoffMs()).toBe(4_000); // backoff doubled to 4s

      await vi.advanceTimersByTimeAsync(2_000); // 2s reconnect fires
      expect(failFactory).toHaveBeenCalledTimes(3);
      expect(c.getBackoffMs()).toBe(8_000);
    });

    it('caps backoff at 60 seconds', async () => {
      const failFactory = vi.fn(() =>
        createMockFlow({
          connect: vi.fn(async () => { throw new Error('fail'); }),
        })
      );
      const c = new ImapClient(TEST_CONFIG, failFactory);
      c.on('error', () => {}); // prevent unhandled error throw

      await c.connect();

      // Run through many retry cycles to exceed 60s
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }

      expect(c.getBackoffMs()).toBe(60_000);
    });

    it('resets backoff on successful connection', async () => {
      const failFactory = vi.fn(() =>
        createMockFlow({
          connect: vi.fn(async () => { throw new Error('fail'); }),
        })
      );
      const c = new ImapClient(TEST_CONFIG, failFactory);
      c.on('error', () => {}); // prevent unhandled error throw

      // Fail a few times to build up backoff
      await c.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);

      // Now make the next attempt succeed
      failFactory.mockReturnValueOnce(createMockFlow());

      await vi.advanceTimersByTimeAsync(4_000);

      expect(c.getBackoffMs()).toBe(1_000); // reset
    });
  });

  describe('events', () => {
    it('emits newMail when exists count increases', async () => {
      await client.connect();

      const newMail = vi.fn();
      client.on('newMail', newMail);

      mockFlow.emit('exists', { count: 15, prevCount: 12 });

      expect(newMail).toHaveBeenCalledWith(3);
    });

    it('does not emit newMail when count does not increase', async () => {
      await client.connect();

      const newMail = vi.fn();
      client.on('newMail', newMail);

      mockFlow.emit('exists', { count: 10, prevCount: 10 });

      expect(newMail).not.toHaveBeenCalled();
    });

    it('forwards flow errors as error events', async () => {
      await client.connect();

      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      const err = new Error('socket error');
      mockFlow.emit('error', err);

      expect(errorHandler).toHaveBeenCalledWith(err);
      expect(client.state).toBe('error');
    });
  });

  describe('IDLE cycling', () => {
    it('sends NOOP after idleTimeout to cycle IDLE', async () => {
      await client.connect();

      expect(mockFlow.noop).not.toHaveBeenCalled();

      // Advance past idleTimeout (300_000ms)
      await vi.advanceTimersByTimeAsync(300_000);

      expect(mockFlow.noop).toHaveBeenCalledTimes(1);
    });

    it('reschedules IDLE cycle after each NOOP', async () => {
      await client.connect();

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockFlow.noop).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockFlow.noop).toHaveBeenCalledTimes(2);
    });

    it('stops IDLE cycling on disconnect', async () => {
      await client.connect();

      await client.disconnect();

      await vi.advanceTimersByTimeAsync(600_000);
      expect(mockFlow.noop).not.toHaveBeenCalled();
    });

    it('stops IDLE cycling on unexpected close', async () => {
      await client.connect();

      mockFlow.emit('close');

      // Create a new flow for the reconnect attempt
      const newFlow = createMockFlow();
      (factory as ReturnType<typeof vi.fn>).mockReturnValueOnce(newFlow);

      // The old NOOP should not fire during the backoff period
      expect(mockFlow.noop).not.toHaveBeenCalled();
    });

    it('handles NOOP failure gracefully', async () => {
      const noopFail = createMockFlow({
        noop: vi.fn(async () => { throw new Error('noop failed'); }),
      });
      const f = vi.fn(() => noopFail);
      const c = new ImapClient(TEST_CONFIG, f);
      c.on('error', () => {});

      await c.connect();
      // Should not throw
      await vi.advanceTimersByTimeAsync(300_000);

      await c.disconnect();
    });
  });

  describe('polling fallback', () => {
    it('polls when IDLE is not supported', async () => {
      const noIdleFlow = createMockFlow({ idleSupported: false }) as ReturnType<typeof createMockFlow> & { emit(event: string, ...args: unknown[]): void };
      const f = vi.fn(() => noIdleFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();

      expect(c.idleSupported).toBe(false);

      // Should poll at pollInterval (60_000ms)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(noIdleFlow.noop).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(noIdleFlow.noop).toHaveBeenCalledTimes(2);

      await c.disconnect();
    });

    it('does not use IDLE cycling when polling', async () => {
      const noIdleFlow = createMockFlow({ idleSupported: false }) as ReturnType<typeof createMockFlow> & { emit(event: string, ...args: unknown[]): void };
      const f = vi.fn(() => noIdleFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();

      // At 60s (pollInterval), should have 1 poll NOOP
      await vi.advanceTimersByTimeAsync(60_000);
      expect(noIdleFlow.noop).toHaveBeenCalledTimes(1);

      // At 120s, should have 2 poll NOOPs (not an IDLE cycle at 300s)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(noIdleFlow.noop).toHaveBeenCalledTimes(2);

      await c.disconnect();
    });

    it('stops polling on disconnect', async () => {
      const noIdleFlow = createMockFlow({ idleSupported: false }) as ReturnType<typeof createMockFlow> & { emit(event: string, ...args: unknown[]): void };
      const f = vi.fn(() => noIdleFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();
      await c.disconnect();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(noIdleFlow.noop).not.toHaveBeenCalled();
    });
  });

  describe('withMailboxLock', () => {
    it('acquires lock on the specified folder', async () => {
      await client.connect();

      const result = await client.withMailboxLock('SomeFolder', async () => 'done');

      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('SomeFolder');
      expect(result).toBe('done');
    });

    it('releases lock even if callback throws', async () => {
      await client.connect();
      const releaseSpy = vi.fn();
      (mockFlow.getMailboxLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ release: releaseSpy });

      await expect(
        client.withMailboxLock('INBOX', async () => { throw new Error('boom'); }),
      ).rejects.toThrow('boom');

      expect(releaseSpy).toHaveBeenCalled();
    });

    it('throws when not connected', async () => {
      await expect(
        client.withMailboxLock('INBOX', async () => 'nope'),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('moveMessage', () => {
    it('acquires lock on INBOX by default', async () => {
      mockFlow = createMockFlow({
        messageMove: vi.fn(async () => ({})),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      await client.moveMessage(42, 'Archive');

      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('INBOX');
      expect(mockFlow.messageMove).toHaveBeenCalledWith([42], 'Archive', { uid: true });
    });

    it('acquires lock on custom source folder when specified', async () => {
      mockFlow = createMockFlow({
        messageMove: vi.fn(async () => ({})),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      await client.moveMessage(42, 'Archive', 'Review');

      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');
      expect(mockFlow.messageMove).toHaveBeenCalledWith([42], 'Archive', { uid: true });
    });
  });

  describe('getSpecialUseFolder', () => {
    it('returns folder name when special-use attribute found', async () => {
      mockFlow = createMockFlow({
        list: vi.fn(async () => [
          { path: 'INBOX', specialUse: undefined },
          { path: 'Sent', specialUse: '\\Sent' },
          { path: 'Junk', specialUse: '\\Junk' },
          { path: 'MyTrash', specialUse: '\\Trash' },
        ]),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();

      const result = await client.getSpecialUseFolder('\\Trash');
      expect(result).toBe('MyTrash');
    });

    it('returns null when special-use attribute not found', async () => {
      mockFlow = createMockFlow({
        list: vi.fn(async () => [
          { path: 'INBOX', specialUse: undefined },
          { path: 'Sent', specialUse: '\\Sent' },
        ]),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();

      const result = await client.getSpecialUseFolder('\\Trash');
      expect(result).toBeNull();
    });

    it('caches results for connection lifetime', async () => {
      mockFlow = createMockFlow({
        list: vi.fn(async () => [
          { path: 'MyTrash', specialUse: '\\Trash' },
        ]),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();

      const first = await client.getSpecialUseFolder('\\Trash');
      const second = await client.getSpecialUseFolder('\\Trash');

      expect(first).toBe('MyTrash');
      expect(second).toBe('MyTrash');
      expect(mockFlow.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchMessagesRaw', () => {
    it('fetches messages from flow and returns array', async () => {
      const messages = [
        { uid: 1, flags: new Set(), envelope: {} },
        { uid: 2, flags: new Set(['\\Seen']), envelope: {} },
      ];
      mockFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* messages;
        } as unknown as ImapFlowLike['fetch']),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const results = await client.fetchMessagesRaw('1:*', { uid: true, flags: true });

      expect(results).toHaveLength(2);
      expect(mockFlow.fetch).toHaveBeenCalledWith('1:*', { uid: true, flags: true }, { uid: true });
    });

    it('throws when not connected', async () => {
      await expect(
        client.fetchMessagesRaw('1:*', { uid: true }),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('fetchAllMessages', () => {
    it('acquires lock on folder and returns ReviewMessage array', async () => {
      const rawMessages = [
        {
          uid: 10,
          flags: new Set(['\\Seen']),
          internalDate: new Date('2026-03-01T12:00:00Z'),
          envelope: {
            from: [{ name: 'Alice', address: 'alice@test.com' }],
            to: [{ name: 'Bob', address: 'bob@test.com' }],
            cc: [],
            subject: 'Hello',
            messageId: '<msg-10@test.com>',
          },
        },
        {
          uid: 20,
          flags: new Set<string>(),
          internalDate: new Date('2026-03-10T12:00:00Z'),
          envelope: {
            from: [{ name: 'Charlie', address: 'charlie@test.com' }],
            to: [{ name: 'Bob', address: 'bob@test.com' }],
            cc: [],
            subject: 'World',
            messageId: '<msg-20@test.com>',
          },
        },
      ];

      mockFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* rawMessages;
        } as unknown as ImapFlowLike['fetch']),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const results = await client.fetchAllMessages('Review');

      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');
      expect(results).toHaveLength(2);
      expect(results[0].uid).toBe(10);
      expect(results[0].flags).toEqual(new Set(['\\Seen']));
      expect(results[0].internalDate).toEqual(new Date('2026-03-01T12:00:00Z'));
      expect(results[0].envelope.from).toEqual({ name: 'Alice', address: 'alice@test.com' });
      expect(results[1].uid).toBe(20);
    });
  });

  describe('withMailboxSwitch', () => {
    it('pauses IDLE, locks folder, executes fn, reopens INBOX, resumes IDLE', async () => {
      await client.connect();

      const callOrder: string[] = [];
      (mockFlow.getMailboxLock as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        callOrder.push(`lock:${path}`);
        return { release: () => callOrder.push('unlock') };
      });
      (mockFlow.mailboxOpen as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        callOrder.push(`open:${path}`);
        return {};
      });

      const result = await client.withMailboxSwitch('Review', async () => {
        callOrder.push('callback');
        return 'sweep-result';
      });

      expect(result).toBe('sweep-result');
      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Review');
      expect(callOrder).toContain('lock:Review');
      expect(callOrder).toContain('callback');
      expect(callOrder).toContain('unlock');
      expect(callOrder).toContain('open:INBOX');

      // Verify ordering: lock before callback, callback before unlock, unlock before INBOX reopen
      const lockIdx = callOrder.indexOf('lock:Review');
      const cbIdx = callOrder.indexOf('callback');
      const unlockIdx = callOrder.indexOf('unlock');
      const reopenIdx = callOrder.indexOf('open:INBOX');
      expect(lockIdx).toBeLessThan(cbIdx);
      expect(cbIdx).toBeLessThan(unlockIdx);
      expect(unlockIdx).toBeLessThan(reopenIdx);

      // IDLE should resume — verify by advancing timers past idleTimeout
      (mockFlow.noop as ReturnType<typeof vi.fn>).mockClear();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockFlow.noop).toHaveBeenCalled();
    });

    it('reopens INBOX and resumes IDLE even if callback throws', async () => {
      await client.connect();

      await expect(
        client.withMailboxSwitch('Review', async () => {
          throw new Error('sweep failed');
        }),
      ).rejects.toThrow('sweep failed');

      // INBOX should still be reopened
      expect(mockFlow.mailboxOpen).toHaveBeenLastCalledWith('INBOX');

      // IDLE should resume
      (mockFlow.noop as ReturnType<typeof vi.fn>).mockClear();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockFlow.noop).toHaveBeenCalled();
    });

    it('throws when not connected', async () => {
      await expect(
        client.withMailboxSwitch('Review', async () => 'nope'),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('appendMessage', () => {
    it('calls flow.append with folder, raw, and flags', async () => {
      await client.connect();
      await client.appendMessage('Folder', 'raw-content', ['\\Seen']);
      expect(mockFlow.append).toHaveBeenCalledWith('Folder', 'raw-content', ['\\Seen']);
    });

    it('returns AppendResponse from flow', async () => {
      await client.connect();
      const result = await client.appendMessage('Folder', 'raw-content', ['\\Seen']);
      expect(result).toHaveProperty('destination', 'TestFolder');
      expect(result).toHaveProperty('uid', 1);
    });

    it('throws when not connected', async () => {
      await expect(
        client.appendMessage('Folder', 'raw-content', ['\\Seen']),
      ).rejects.toThrow('Not connected');
    });

    it('throws when append returns false', async () => {
      mockFlow = createMockFlow({
        append: vi.fn(async () => false),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      await expect(
        client.appendMessage('Folder', 'raw-content', ['\\Seen']),
      ).rejects.toThrow();
    });
  });

  describe('searchByHeader', () => {
    it('searches with header query and uid option', async () => {
      await client.connect();
      await client.searchByHeader('Folder', 'X-Mail-Mgr-Sentinel', '<test@id>');
      expect(mockFlow.search).toHaveBeenCalledWith(
        { header: { 'X-Mail-Mgr-Sentinel': '<test@id>' } },
        { uid: true },
      );
      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Folder');
    });

    it('returns UIDs from search result', async () => {
      mockFlow = createMockFlow({
        search: vi.fn(async () => [42, 99]),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const result = await client.searchByHeader('Folder', 'X-Test', 'val');
      expect(result).toEqual([42, 99]);
    });

    it('returns empty array when search returns false', async () => {
      mockFlow = createMockFlow({
        search: vi.fn(async () => false),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const result = await client.searchByHeader('Folder', 'X-Test', 'val');
      expect(result).toEqual([]);
    });

    it('throws when not connected', async () => {
      await expect(
        client.searchByHeader('Folder', 'X-Test', 'val'),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('deleteMessage', () => {
    it('calls messageDelete with uid array and uid option', async () => {
      await client.connect();
      await client.deleteMessage('Folder', 42);
      expect(mockFlow.messageDelete).toHaveBeenCalledWith([42], { uid: true });
      expect(mockFlow.getMailboxLock).toHaveBeenCalledWith('Folder');
    });

    it('returns boolean from messageDelete', async () => {
      await client.connect();
      const result = await client.deleteMessage('Folder', 42);
      expect(result).toBe(true);
    });

    it('throws when not connected', async () => {
      await expect(
        client.deleteMessage('Folder', 42),
      ).rejects.toThrow('Not connected');
    });
  });

  describe('getHeaderFields', () => {
    it('always includes X-Mail-Mgr-Sentinel even without envelopeHeader config', async () => {
      // Config without envelopeHeader
      const noEnvConfig: ImapConfig = { ...TEST_CONFIG };
      delete (noEnvConfig as Record<string, unknown>).envelopeHeader;
      const fetchFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield { uid: 1, envelope: {}, flags: new Set() };
        } as unknown as ImapFlowLike['fetch']),
      });
      const f = vi.fn(() => fetchFlow);
      const c = new ImapClient(noEnvConfig, f);

      await c.connect();
      await c.fetchNewMessages(0);

      // Verify the fetch query includes headers with X-Mail-Mgr-Sentinel
      const fetchCall = (fetchFlow.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers).toEqual(['X-Mail-Mgr-Sentinel']);
    });

    it('includes envelopeHeader and List-Id when envelopeHeader is configured', async () => {
      const envConfig: ImapConfig = { ...TEST_CONFIG, envelopeHeader: 'Delivered-To' };
      const fetchFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield { uid: 1, envelope: {}, flags: new Set() };
        } as unknown as ImapFlowLike['fetch']),
      });
      const f = vi.fn(() => fetchFlow);
      const c = new ImapClient(envConfig, f);

      await c.connect();
      await c.fetchNewMessages(0);

      const fetchCall = (fetchFlow.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers).toEqual(['X-Mail-Mgr-Sentinel', 'Delivered-To', 'List-Id']);
    });
  });

  describe('parseRawToReviewMessage headers', () => {
    it('populates headers field when raw headers Buffer is present', async () => {
      const rawMessages = [
        {
          uid: 10,
          flags: new Set(['\\Seen']),
          internalDate: new Date('2026-03-01T12:00:00Z'),
          headers: Buffer.from('X-Mail-Mgr-Sentinel: <test@mail-manager.sentinel>\r\nFrom: alice@test.com\r\n'),
          envelope: {
            from: [{ name: 'Alice', address: 'alice@test.com' }],
            to: [{ name: 'Bob', address: 'bob@test.com' }],
            cc: [],
            subject: 'Hello',
            messageId: '<msg-10@test.com>',
          },
        },
      ];

      mockFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* rawMessages;
        } as unknown as ImapFlowLike['fetch']),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const results = await client.fetchAllMessages('Review');

      expect(results[0].headers).toBeDefined();
      expect(results[0].headers).toBeInstanceOf(Map);
      expect(results[0].headers!.has('x-mail-mgr-sentinel')).toBe(true);
      expect(results[0].headers!.get('from')).toBe('alice@test.com');
    });

    it('headers is undefined when no raw headers Buffer', async () => {
      const rawMessages = [
        {
          uid: 10,
          flags: new Set(['\\Seen']),
          internalDate: new Date('2026-03-01T12:00:00Z'),
          envelope: {
            from: [{ name: 'Alice', address: 'alice@test.com' }],
            to: [{ name: 'Bob', address: 'bob@test.com' }],
            cc: [],
            subject: 'Hello',
            messageId: '<msg-10@test.com>',
          },
        },
      ];

      mockFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* rawMessages;
        } as unknown as ImapFlowLike['fetch']),
      }) as typeof mockFlow;
      factory = vi.fn(() => mockFlow);
      client = new ImapClient(TEST_CONFIG, factory);

      await client.connect();
      const results = await client.fetchAllMessages('Review');

      expect(results[0].headers).toBeUndefined();
    });
  });

  describe('UID dedup', () => {
    it('fetchNewMessages only returns messages above sinceUid', async () => {
      const messages = [
        { uid: 1, envelope: {}, flags: new Set() },
        { uid: 2, envelope: {}, flags: new Set() },
        { uid: 5, envelope: {}, flags: new Set() },
      ];
      const fetchFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* messages;
        } as unknown as ImapFlowLike['fetch']),
      });
      const f = vi.fn(() => fetchFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();

      // Fetch since UID 2 — should only get UID 5
      const results = await c.fetchNewMessages(2);
      expect(results).toHaveLength(1);
      expect((results[0] as { uid: number }).uid).toBe(5);

      await c.disconnect();
    });

    it('fetchNewMessages returns all when sinceUid is 0', async () => {
      const messages = [
        { uid: 1, envelope: {}, flags: new Set() },
        { uid: 3, envelope: {}, flags: new Set() },
      ];
      const fetchFlow = createMockFlow({
        fetch: vi.fn(function* () {
          yield* messages;
        } as unknown as ImapFlowLike['fetch']),
      });
      const f = vi.fn(() => fetchFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();

      const results = await c.fetchNewMessages(0);
      expect(results).toHaveLength(2);

      await c.disconnect();
    });
  });

  // FM-002: half-open IMAP socket detection. Both the IDLE cycler and
  // listFolders had been observed hanging silently against a wedged
  // connection in production. These tests pin the new behavior:
  // - cycleIdle force-closes (triggering reconnect) when usable=false
  // - cycleIdle force-closes when noop hangs past NOOP_TIMEOUT_MS
  // - listFolders rejects when usable=false
  // - listFolders rejects when listTree hangs past LIST_TIMEOUT_MS
  describe('FM-002 wedged connection detection', () => {
    it('cycleIdle reconnects when flow.usable becomes false', async () => {
      await client.connect();
      expect(client.state).toBe('connected');

      // Wedge the socket: still "connected" from the client's POV, but the
      // underlying flow is unusable.
      (mockFlow as unknown as { usable: boolean }).usable = false;

      // Replace factory so the reconnect attempt observes a fresh flow.
      const reconnectFlow = createMockFlow();
      (factory as ReturnType<typeof vi.fn>).mockReturnValueOnce(reconnectFlow);

      // Trigger cycleIdle by advancing past idleTimeout.
      await vi.advanceTimersByTimeAsync(300_000);

      // handleClose should have fired, scheduling a reconnect.
      // After backoff (1s), reconnect happens.
      await vi.advanceTimersByTimeAsync(1_000);

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('cycleIdle reconnects when noop hangs past timeout', async () => {
      const hangFlow = createMockFlow({
        noop: vi.fn(() => new Promise<void>(() => {})), // never resolves
      });
      const f = vi.fn(() => hangFlow);
      const c = new ImapClient(TEST_CONFIG, f);
      c.on('error', () => {});

      await c.connect();

      // Trigger cycleIdle.
      await vi.advanceTimersByTimeAsync(300_000);
      // Advance past the NOOP timeout (30s).
      await vi.advanceTimersByTimeAsync(30_000);

      // After the timeout fires, handleClose runs and a reconnect is
      // scheduled. Advance the backoff so the new factory call happens.
      await vi.advanceTimersByTimeAsync(1_000);

      expect(f).toHaveBeenCalledTimes(2);
    });

    it('listFolders throws when flow.usable is false', async () => {
      await client.connect();
      (mockFlow as unknown as { usable: boolean }).usable = false;

      await expect(client.listFolders()).rejects.toThrow(/not usable/i);
    });

    it('listFolders throws when listTree hangs past timeout', async () => {
      const hangFlow = createMockFlow({
        listTree: vi.fn(() => new Promise(() => {})), // never resolves
      });
      const f = vi.fn(() => hangFlow);
      const c = new ImapClient(TEST_CONFIG, f);

      await c.connect();

      const promise = c.listFolders();
      // Attach a synchronous catch handler so the timeout rejection is
      // observed as soon as fake-timer flushes fire it. Without this,
      // vitest's fake-timer driver reports a benign "unhandled rejection"
      // before the await below has a chance to attach.
      const settled = promise.catch((e) => e);
      // Drive past the LIST timeout (15s).
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await settled;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/timed out/i);

      await c.disconnect();
    });

    it('listFolders throws when not connected', async () => {
      await expect(client.listFolders()).rejects.toThrow('Not connected');
    });

    // FM-002 Phase 34 Task 2: cleanupFlow must drain in-flight imapflow ops
    // by calling flow.close() before nulling the reference. Without this,
    // requestTagMap entries and pending locks in the abandoned imapflow
    // instance never reject — old wedged callers stay stuck forever.
    // (See node_modules/imapflow/lib/imap-flow.js:1673-1759.)
    it('cleanupFlow calls flow.close before nulling the reference', async () => {
      await client.connect();

      // Wedge: usable=false will cause cycleIdle -> handleClose -> cleanupFlow
      (mockFlow as unknown as { usable: boolean }).usable = false;

      // Replace factory for the reconnect attempt
      const reconnectFlow = createMockFlow();
      (factory as ReturnType<typeof vi.fn>).mockReturnValueOnce(reconnectFlow);

      // Drive cycleIdle past idleTimeout — usable check trips, handleClose
      // runs, cleanupFlow runs, flow.close() should have been called.
      await vi.advanceTimersByTimeAsync(300_000);

      expect(mockFlow.close).toHaveBeenCalled();
    });

    it('cleanupFlow swallows errors from flow.close', async () => {
      const throwingClose = vi.fn(() => {
        throw new Error('boom');
      });
      const wedgeFlow = createMockFlow({ close: throwingClose });
      const f = vi.fn(() => wedgeFlow);
      const c = new ImapClient(TEST_CONFIG, f);
      c.on('error', () => {});

      await c.connect();

      // Wedge — trip cycleIdle so handleClose -> cleanupFlow -> flow.close()
      (wedgeFlow as unknown as { usable: boolean }).usable = false;
      await vi.advanceTimersByTimeAsync(300_000);

      // close() threw, but cleanupFlow swallowed it; reconnect should still
      // have been scheduled. Advance the backoff so the new factory fires.
      await vi.advanceTimersByTimeAsync(1_000);

      expect(throwingClose).toHaveBeenCalled();
      expect(f).toHaveBeenCalledTimes(2);
    });

    // FM-002 Phase 34 Plan 02 Task 3 (R6): the matrix.
    //
    // For every public op listed below, two tests run against a fresh
    // ImapClient + mock flow:
    //   A) flow.usable=false → op rejects with /not usable/i
    //   B) the op's underlying imapflow call never resolves → op rejects
    //      with /timed out/i within its op-class timeout window.
    //
    // Each iteration constructs its own client to avoid state leakage,
    // attaches a no-op error handler so the auto-reconnect path's emit('error')
    // doesn't trip vitest's unhandled-error guard, and disconnects in the
    // assertion epilogue.
    interface OpCase {
      label: string;
      hangMockKey: keyof ImapFlowLike;
      hangMockValue: () => unknown;
      timeoutMs: number;
      invoke: (c: ImapClient) => Promise<unknown>;
    }

    const OP_CASES: OpCase[] = [
      {
        label: 'listMailboxes',
        hangMockKey: 'list',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.listMailboxes(),
      },
      {
        label: 'listFolders',
        hangMockKey: 'listTree',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.listFolders(),
      },
      {
        label: 'status',
        hangMockKey: 'status',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.status('INBOX'),
      },
      {
        label: 'createMailbox',
        hangMockKey: 'mailboxCreate',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.createMailbox('Foo'),
      },
      {
        label: 'renameFolder',
        hangMockKey: 'mailboxRename',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.renameFolder('Foo', 'Bar'),
      },
      {
        label: 'appendMessage',
        hangMockKey: 'append',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 30_000,
        invoke: (c) => c.appendMessage('INBOX', 'raw', []),
      },
      {
        label: 'searchByHeader',
        hangMockKey: 'search',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 30_000,
        invoke: (c) => c.searchByHeader('Sent', 'Message-ID', '<x@y>'),
      },
      {
        label: 'deleteMessage',
        hangMockKey: 'messageDelete',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.deleteMessage('Sent', 1),
      },
      {
        label: 'moveMessage(INBOX)',
        hangMockKey: 'messageMove',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 30_000,
        invoke: (c) => c.moveMessage(1, 'Archive', 'INBOX'),
      },
      {
        label: 'moveMessage(non-INBOX)',
        hangMockKey: 'messageMove',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 30_000,
        invoke: (c) => c.moveMessage(1, 'Archive', 'Sent'),
      },
      {
        label: 'fetchNewMessages',
        hangMockKey: 'fetch',
        hangMockValue: () => vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        })),
        timeoutMs: 30_000,
        invoke: (c) => c.fetchNewMessages(0),
      },
      {
        label: 'fetchAllMessages(INBOX)',
        hangMockKey: 'fetch',
        hangMockValue: () => vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        })),
        timeoutMs: 120_000,
        invoke: (c) => c.fetchAllMessages('INBOX'),
      },
      {
        label: 'fetchAllMessages(non-INBOX)',
        hangMockKey: 'fetch',
        hangMockValue: () => vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        })),
        timeoutMs: 120_000,
        invoke: (c) => c.fetchAllMessages('Review'),
      },
      {
        label: 'getSpecialUseFolder',
        hangMockKey: 'list',
        hangMockValue: () => vi.fn(() => new Promise<never>(() => {})),
        timeoutMs: 15_000,
        invoke: (c) => c.getSpecialUseFolder('\\Trash'),
      },
      {
        label: 'fetchMessagesRaw',
        hangMockKey: 'fetch',
        hangMockValue: () => vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        })),
        timeoutMs: 120_000,
        invoke: (c) => c.fetchMessagesRaw('1:*', { uid: true }),
      },
    ];

    // Lock-acquisition matrix: getMailboxLock itself hangs (the SELECT inside
    // processLocks can stall — see RESEARCH Pitfall 3). The op label in the
    // rejection message must contain "getMailboxLock" so operators can route
    // the wedge to the right code path.
    interface LockHangCase {
      label: string;
      invoke: (c: ImapClient) => Promise<unknown>;
    }
    const LOCK_HANG_CASES: LockHangCase[] = [
      {
        label: 'withMailboxLock-acquisition (via fetchNewMessages)',
        invoke: (c) => c.fetchNewMessages(0),
      },
      {
        label: 'withMailboxSwitch-acquisition (via searchByHeader)',
        invoke: (c) => c.searchByHeader('Sent', 'Message-ID', '<x@y>'),
      },
    ];

    it.each(OP_CASES.map((c) => [c.label, c] as const))(
      '%s rejects with /not usable/i when flow.usable is false',
      async (_label, op) => {
        // Per-case fresh client — avoids state leakage between iterations.
        const f = createMockFlow();
        const cFactory = vi.fn(() => f);
        const c = new ImapClient(TEST_CONFIG, cFactory);
        c.on('error', () => {}); // swallow — handleClose path emits during the wedge
        await c.connect();
        (f as unknown as { usable: boolean }).usable = false;
        await expect(op.invoke(c)).rejects.toThrow(/not usable/i);
        await c.disconnect();
      },
    );

    it.each(OP_CASES.map((c) => [c.label, c] as const))(
      '%s rejects with /timed out/i when inner imapflow call hangs',
      async (_label, op) => {
        const hangFlow = createMockFlow({
          [op.hangMockKey]: op.hangMockValue(),
        } as unknown as Partial<ImapFlowLike>);
        const f = vi.fn(() => hangFlow);
        const c = new ImapClient(TEST_CONFIG, f);
        c.on('error', () => {});
        await c.connect();

        const settled = op.invoke(c).catch((e) => e);
        await vi.advanceTimersByTimeAsync(op.timeoutMs);

        const result = await settled;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/timed out/i);

        await c.disconnect();
      },
      180_000, // per-test timeout ceiling — must exceed BULK_FETCH_TIMEOUT_MS=120_000
    );

    it.each(LOCK_HANG_CASES.map((c) => [c.label, c] as const))(
      '%s rejects with /timed out/i when getMailboxLock hangs',
      async (_label, op) => {
        const hangFlow = createMockFlow({
          getMailboxLock: vi.fn(() => new Promise<never>(() => {})),
        });
        const f = vi.fn(() => hangFlow);
        const c = new ImapClient(TEST_CONFIG, f);
        c.on('error', () => {});
        await c.connect();

        const settled = op.invoke(c).catch((e) => e);
        await vi.advanceTimersByTimeAsync(15_000); // LOCK_TIMEOUT_MS

        const result = await settled;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/timed out/i);
        expect((result as Error).message).toMatch(/getMailboxLock/);

        await c.disconnect();
      },
      60_000,
    );

    // FM-002 Phase 34 Plan 02 Task 3 (R4): the in-flight rejection
    // verification. Starts a fetchAllMessages against a never-yielding
    // async iterator, trips the wedge (usable=false → cycleIdle →
    // handleClose → cleanupFlow → flow.close()), and asserts both that
    // close() was actually called AND that the in-flight promise rejected.
    // The BULK_FETCH_TIMEOUT_MS bound is the belt-and-suspenders backstop
    // — whichever rejection path fires first wins.
    it('R4: in-flight fetchAllMessages rejects when handleClose fires mid-flight', async () => {
      let usable = true;
      const hangFlow = createMockFlow({
        fetch: vi.fn(() => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        }) as unknown as ImapFlowLike['fetch']),
        close: vi.fn(() => { usable = false; }),
      });
      Object.defineProperty(hangFlow, 'usable', {
        get: () => usable,
        set: (v: boolean) => { usable = v; },
        configurable: true,
      });
      const f = vi.fn(() => hangFlow);
      const c = new ImapClient(TEST_CONFIG, f);
      c.on('error', () => {});
      await c.connect();

      const inflight = c.fetchAllMessages('Review').catch((e) => e);

      // Trip the wedge — usable=false causes cycleIdle to call handleClose,
      // which in cleanupFlow now calls flow.close().
      usable = false;
      // Drive past idleTimeout (300_000 — TEST_CONFIG kept at 300_000).
      await vi.advanceTimersByTimeAsync(300_000);
      // Backstop: drive past BULK_FETCH_TIMEOUT_MS so guardedOp's timeout
      // also fires. Whichever fires first wins.
      await vi.advanceTimersByTimeAsync(120_000);

      const result = await inflight;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/not usable|timed out|not connected/i);
      // R4 verification: flow.close() was actually called by cleanupFlow
      expect(hangFlow.close).toHaveBeenCalled();

      await c.disconnect();
    }, 600_000);
  });

  // FM-002 Task 1 (Phase 34): foundation pieces — mock factory now provides
  // close() so the upcoming cleanupFlow.close() refactor type-checks. Pinned
  // here so future regressions of the mock surface fail loudly.
  describe('FM-002 Task 1 foundation: mock factory close()', () => {
    it('createMockFlow default returns an object whose close is a vi.fn', () => {
      const flow = createMockFlow();
      expect(flow.close).toBeDefined();
      expect(typeof flow.close).toBe('function');
      // vi.fn instances expose mock metadata
      expect((flow.close as unknown as { mock?: unknown }).mock).toBeDefined();
    });

    it('createMockFlow honors a close override', () => {
      const customSpy = vi.fn();
      const flow = createMockFlow({ close: customSpy });
      expect(flow.close).toBe(customSpy);
      flow.close();
      expect(customSpy).toHaveBeenCalledOnce();
    });
  });
});
