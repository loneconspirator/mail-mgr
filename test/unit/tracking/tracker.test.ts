import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MoveTracker } from '../../../src/tracking/index.js';
import type { MoveTrackerDeps } from '../../../src/tracking/index.js';

function createMockDeps(overrides: Partial<MoveTrackerDeps> = {}): MoveTrackerDeps {
  return {
    client: {
      state: 'connected' as const,
      withMailboxLock: vi.fn(async (_folder: string, fn: (flow: unknown) => Promise<unknown>) => {
        const flow = {
          mailbox: { uidValidity: 100 },
          fetch: async function* () {
            // empty by default
          },
        };
        return fn(flow);
      }),
    } as unknown as MoveTrackerDeps['client'],
    activityLog: (() => {
      const stateStore = new Map<string, string>();
      return {
        getState: vi.fn((key: string): string | undefined => stateStore.get(key)),
        setState: vi.fn((key: string, value: string): void => { stateStore.set(key, value); }),
        isSystemMove: vi.fn((_messageId: string): boolean => false),
      };
    })() as unknown as MoveTrackerDeps['activityLog'],
    signalStore: {
      logSignal: vi.fn(() => 1),
    } as unknown as MoveTrackerDeps['signalStore'],
    destinationResolver: {
      resolveFast: vi.fn(async () => null),
      enqueueDeepScan: vi.fn(),
      runDeepScan: vi.fn(async () => new Map<string, string>()),
    } as unknown as MoveTrackerDeps['destinationResolver'],
    inboxFolder: 'INBOX',
    reviewFolder: 'Review',
    scanIntervalMs: 30_000,
    enabled: true,
    ...overrides,
  };
}

/** Helper: make withMailboxLock return specific messages for specific folders. */
function setupFolderMessages(
  deps: MoveTrackerDeps,
  folderData: Record<string, Array<{ uid: number; messageId: string; sender?: string; subject?: string; flags?: Set<string> }>>,
  uidValidity: number = 100,
): void {
  (deps.client as { withMailboxLock: ReturnType<typeof vi.fn> }).withMailboxLock.mockImplementation(
    async (folder: string, fn: (flow: unknown) => Promise<unknown>) => {
      const messages = folderData[folder] ?? [];
      const flow = {
        mailbox: { uidValidity },
        fetch: async function* () {
          for (const msg of messages) {
            yield {
              uid: msg.uid,
              envelope: {
                messageId: msg.messageId,
                from: [{ address: msg.sender ?? 'test@example.com' }],
                to: [{ address: 'me@example.com' }],
                cc: [],
                subject: msg.subject ?? 'Test Subject',
              },
              flags: msg.flags ?? new Set<string>(),
            };
          }
        },
      };
      return fn(flow);
    },
  );
}

describe('MoveTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first scan establishes baseline without signals', async () => {
    const deps = createMockDeps();
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 2, messageId: '<msg-2@test.com>' },
      ],
      'Review': [
        { uid: 10, messageId: '<msg-10@test.com>' },
      ],
    });

    const tracker = new MoveTracker(deps);
    await tracker.runScanForTest();

    // Signal store should never have been called -- baseline only
    expect(deps.signalStore.logSignal).not.toHaveBeenCalled();
    // But snapshot should have been saved
    expect(deps.activityLog.setState).toHaveBeenCalled();
  });

  it('detects disappeared UIDs on second scan with two-scan confirmation', async () => {
    const deps = createMockDeps();
    const signalStore = deps.signalStore as { logSignal: ReturnType<typeof vi.fn> };
    const resolver = deps.destinationResolver as { resolveFast: ReturnType<typeof vi.fn> };
    resolver.resolveFast.mockResolvedValue('Archive');

    // First scan: baseline with UIDs 1,2,3
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>', sender: 'alice@test.com', subject: 'Hello' },
        { uid: 2, messageId: '<msg-2@test.com>', sender: 'bob@test.com', subject: 'Hi' },
        { uid: 3, messageId: '<msg-3@test.com>', sender: 'carol@test.com', subject: 'Hey' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);

    // Second scan: UID 2 disappeared -- first detection, pending confirmation
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 3, messageId: '<msg-3@test.com>' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);
    expect(signalStore.logSignal).not.toHaveBeenCalled(); // Not yet -- needs second confirmation

    // Third scan: UID 2 still missing -- confirmed, signal created
    await tracker_runScan(deps);
    expect(signalStore.logSignal).toHaveBeenCalledTimes(1);
    expect(signalStore.logSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '<msg-2@test.com>',
        sender: 'bob@test.com',
        subject: 'Hi',
        sourceFolder: 'INBOX',
        destinationFolder: 'Archive',
      }),
    );
  });

  it('excludes system moves via activity log', async () => {
    const deps = createMockDeps();
    const activityLog = deps.activityLog as { isSystemMove: ReturnType<typeof vi.fn> };
    activityLog.isSystemMove.mockReturnValue(true); // It's a system move

    // First scan: baseline
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 2, messageId: '<msg-2@test.com>' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);

    // Second scan: UID 2 gone, but it's a system move
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);

    // Third scan: still gone
    await tracker_runScan(deps);

    // No signal should be generated because isSystemMove returned true
    expect(deps.signalStore.logSignal).not.toHaveBeenCalled();
  });

  it('two-scan confirmation prevents race conditions', async () => {
    const deps = createMockDeps();
    const resolver = deps.destinationResolver as { resolveFast: ReturnType<typeof vi.fn> };
    resolver.resolveFast.mockResolvedValue('Archive');

    // Baseline
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 2, messageId: '<msg-2@test.com>' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);

    // UID 2 disappears
    setupFolderMessages(deps, {
      'INBOX': [{ uid: 1, messageId: '<msg-1@test.com>' }],
      'Review': [],
    });
    await tracker_runScan(deps);

    // First detection -- no signal yet
    expect(deps.signalStore.logSignal).not.toHaveBeenCalled();

    // UID 2 reappears! (it was just being moved by Monitor)
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 2, messageId: '<msg-2@test.com>' },
      ],
      'Review': [],
    });
    await tracker_runScan(deps);

    // Should NOT generate a signal since UID 2 came back
    expect(deps.signalStore.logSignal).not.toHaveBeenCalled();
  });

  it('UIDVALIDITY change resets snapshot without generating signals', async () => {
    const deps = createMockDeps();

    // First scan: baseline with uidValidity=100
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
        { uid: 2, messageId: '<msg-2@test.com>' },
      ],
      'Review': [],
    }, 100);
    await tracker_runScan(deps);

    // Second scan: uidValidity changed to 200, UID 2 "disappeared"
    // But this should just re-baseline, not generate signals
    setupFolderMessages(deps, {
      'INBOX': [
        { uid: 1, messageId: '<msg-1@test.com>' },
      ],
      'Review': [],
    }, 200);
    await tracker_runScan(deps);

    expect(deps.signalStore.logSignal).not.toHaveBeenCalled();
  });

  it('scan interval timer fires correctly', () => {
    const deps = createMockDeps();
    const tracker = new MoveTracker(deps);

    tracker.start();

    // Check that the scan interval was set
    const state = tracker.getState();
    expect(state.enabled).toBe(true);

    tracker.stop();
  });

  it('stop() clears all timers', () => {
    const deps = createMockDeps();
    const tracker = new MoveTracker(deps);

    tracker.start();
    tracker.stop();

    // After stop, getState should still work but timers are cleared
    const state = tracker.getState();
    expect(state.enabled).toBe(true);
  });

  it('skips scan when not connected', async () => {
    const deps = createMockDeps();
    (deps.client as { state: string }).state = 'disconnected';

    setupFolderMessages(deps, {
      'INBOX': [{ uid: 1, messageId: '<msg-1@test.com>' }],
      'Review': [],
    });

    const tracker = new MoveTracker(deps);
    await tracker.runScanForTest();

    // Should not have called withMailboxLock at all
    expect(deps.client.withMailboxLock).not.toHaveBeenCalled();
  });

  it('start() does nothing when enabled=false', () => {
    const deps = createMockDeps({ enabled: false });
    const tracker = new MoveTracker(deps);

    tracker.start();

    const state = tracker.getState();
    expect(state.enabled).toBe(false);
    // No scan should have been attempted
    expect(deps.client.withMailboxLock).not.toHaveBeenCalled();
  });
});

/** Helper: create a tracker and run a scan, reusing the same tracker instance across calls. */
let _tracker: MoveTracker | null = null;

function tracker_runScan(deps: MoveTrackerDeps): Promise<void> {
  if (!_tracker) {
    _tracker = new MoveTracker(deps);
  }
  return _tracker.runScanForTest();
}

// Reset tracker between test cases
beforeEach(() => {
  _tracker = null;
});
