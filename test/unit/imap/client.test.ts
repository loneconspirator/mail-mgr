import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImapClient, type ImapFlowLike, type ImapFlowFactory, type ConnectionState } from '../../../src/imap/index.js';
import type { ImapConfig } from '../../../src/config/index.js';

const TEST_CONFIG: ImapConfig = {
  host: 'imap.example.com',
  port: 993,
  tls: true,
  auth: { user: 'test@example.com', pass: 'secret' },
  idleTimeout: 300_000,
  pollInterval: 60_000,
};

function createMockFlow(overrides: Partial<ImapFlowLike> = {}): ImapFlowLike {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    usable: true,
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    mailboxOpen: vi.fn(async () => ({})),
    noop: vi.fn(async () => {}),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    list: vi.fn(async () => []),
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
});
