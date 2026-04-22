import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/sentinel/imap-ops.js', () => ({
  findSentinel: vi.fn(),
}));

import { SentinelScanner } from '../../../src/sentinel/scanner.js';
import type { ScanResult, ScanReport, SentinelScannerDeps } from '../../../src/sentinel/scanner.js';
import { findSentinel } from '../../../src/sentinel/imap-ops.js';

const mockFindSentinel = vi.mocked(findSentinel);

function createMockClient(state = 'connected' as string) {
  return {
    state,
    listMailboxes: vi.fn(async () => [
      { path: 'INBOX', flags: [] },
      { path: 'Archive', flags: [] },
      { path: 'Work', flags: [] },
      { path: 'Personal', flags: [] },
    ]),
  };
}

function createMockStore(sentinels: Array<{ messageId: string; folderPath: string; folderPurpose: string; createdAt: string }> = []) {
  return {
    getAll: vi.fn(() => sentinels),
    getByMessageId: vi.fn(),
    getByFolder: vi.fn(),
    upsert: vi.fn(),
    updateFolderPath: vi.fn(),
    deleteByMessageId: vi.fn(),
    deleteByFolder: vi.fn(),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

function makeDeps(overrides: Partial<SentinelScannerDeps> = {}): SentinelScannerDeps {
  return {
    client: createMockClient() as any,
    sentinelStore: createMockStore() as any,
    scanIntervalMs: 60_000,
    enabled: true,
    logger: createMockLogger() as any,
    ...overrides,
  };
}

describe('SentinelScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFindSentinel.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── ScanResult types ──────────────────────────────────────────────────
  describe('ScanResult types', () => {
    it('produces found-in-place result with expected fields', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results).toHaveLength(1);
      const r = report.results[0];
      expect(r.status).toBe('found-in-place');
      expect(r.messageId).toBe('<s1@test>');
      expect(r.expectedFolder).toBe('Archive');
      expect(r.folderPurpose).toBe('rule-target');
    });

    it('produces found-in-different-folder result with actualFolder', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      // Not found in expected folder
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // Found in Work folder during deep scan
      mockFindSentinel.mockResolvedValueOnce(99);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results).toHaveLength(1);
      const r = report.results[0] as ScanResult & { actualFolder: string };
      expect(r.status).toBe('found-in-different-folder');
      expect(r.messageId).toBe('<s1@test>');
      expect(r.expectedFolder).toBe('Archive');
      expect(r.actualFolder).toBeDefined();
      expect(r.folderPurpose).toBe('rule-target');
    });

    it('produces not-found result when sentinel missing everywhere', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(undefined);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results).toHaveLength(1);
      const r = report.results[0];
      expect(r.status).toBe('not-found');
      expect(r.messageId).toBe('<s1@test>');
      expect(r.expectedFolder).toBe('Archive');
      expect(r.folderPurpose).toBe('rule-target');
    });
  });

  // ── Fast-path scan ────────────────────────────────────────────────────
  describe('fast-path scan', () => {
    it('calls findSentinel with client, expected folder, and messageId', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const client = createMockClient();
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      expect(mockFindSentinel).toHaveBeenCalledWith(client, 'Archive', '<s1@test>');
    });

    it('returns found-in-place when findSentinel returns UID for expected folder', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results[0].status).toBe('found-in-place');
    });
  });

  // ── Deep scan ─────────────────────────────────────────────────────────
  describe('deep scan', () => {
    it('calls listMailboxes when sentinel not found in expected folder', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const client = createMockClient();
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(undefined);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      expect(client.listMailboxes).toHaveBeenCalled();
    });

    it('skips the expected folder during deep scan (already checked)', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(undefined);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      // findSentinel should NOT be called with 'Archive' a second time during deep scan
      const archiveCalls = mockFindSentinel.mock.calls.filter(c => c[1] === 'Archive');
      expect(archiveCalls).toHaveLength(1); // Only the fast-path call
    });

    it('filters out INBOX during deep scan', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(undefined);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      // findSentinel should never be called with 'INBOX'
      const inboxCalls = mockFindSentinel.mock.calls.filter(c => c[1] === 'INBOX');
      expect(inboxCalls).toHaveLength(0);
    });

    it('returns found-in-different-folder with actualFolder when found in deep scan', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
        { path: 'Work', flags: [] },
        { path: 'Personal', flags: [] },
      ]);
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });
      // Fast path: not found
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // Deep scan: found in Work
      mockFindSentinel.mockResolvedValueOnce(77);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      const r = report.results[0] as ScanResult & { actualFolder: string };
      expect(r.status).toBe('found-in-different-folder');
      expect(r.actualFolder).toBe('Work');
    });

    it('short-circuits deep scan on first match', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
        { path: 'Work', flags: [] },
        { path: 'Personal', flags: [] },
      ]);
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });
      // Fast path: not found
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // Deep scan: found in Work (first non-INBOX, non-Archive folder)
      mockFindSentinel.mockResolvedValueOnce(77);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      // 1 fast-path call + 1 deep scan call (Work found, Personal skipped)
      expect(mockFindSentinel).toHaveBeenCalledTimes(2);
    });

    it('returns not-found when sentinel not found in any folder', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(undefined);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results[0].status).toBe('not-found');
    });

    it('catches per-folder errors during deep scan and continues searching', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
        { path: 'Work', flags: [] },
        { path: 'Personal', flags: [] },
      ]);
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });
      // Fast path: not found
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // Deep scan: Work throws error
      mockFindSentinel.mockRejectedValueOnce(new Error('folder error'));
      // Deep scan: Personal has it
      mockFindSentinel.mockResolvedValueOnce(88);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results[0].status).toBe('found-in-different-folder');
      expect(report.errors).toBeGreaterThan(0);
    });
  });

  // ── ScanReport ────────────────────────────────────────────────────────
  describe('ScanReport', () => {
    it('contains scannedAt ISO string, results array, deepScansTriggered count, errors count', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
        { messageId: '<s2@test>', folderPath: 'Work', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(report.results).toHaveLength(2);
      expect(typeof report.deepScansTriggered).toBe('number');
      expect(typeof report.errors).toBe('number');
    });

    it('contains one ScanResult per sentinel from store.getAll()', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
        { messageId: '<s2@test>', folderPath: 'Work', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
        { messageId: '<s3@test>', folderPath: 'Personal', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results).toHaveLength(3);
    });

    it('tracks deepScansTriggered count correctly', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
        { messageId: '<s2@test>', folderPath: 'Work', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      // s1: not found fast path -> deep scan triggered
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // s1: deep scan finds nothing
      mockFindSentinel.mockResolvedValueOnce(undefined);
      mockFindSentinel.mockResolvedValueOnce(undefined);
      // s2: found in place
      mockFindSentinel.mockResolvedValueOnce(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.deepScansTriggered).toBe(1);
    });
  });

  // ── Timer lifecycle ───────────────────────────────────────────────────
  describe('timer lifecycle', () => {
    it('start() when enabled=false is a no-op', () => {
      const deps = makeDeps({ enabled: false });
      const scanner = new SentinelScanner(deps);
      scanner.start();
      // No interval set, no scan triggered
      vi.advanceTimersByTime(120_000);
      expect(mockFindSentinel).not.toHaveBeenCalled();
    });

    it('start() calls runScan immediately and sets interval', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any, scanIntervalMs: 30_000 });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      scanner.start();

      // Initial scan is fire-and-forget
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFindSentinel).toHaveBeenCalledTimes(1);

      // Interval fires
      mockFindSentinel.mockClear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFindSentinel).toHaveBeenCalled();
    });

    it('stop() clears the interval', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any, scanIntervalMs: 30_000 });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      scanner.start();
      await vi.advanceTimersByTimeAsync(0);

      scanner.stop();
      mockFindSentinel.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockFindSentinel).not.toHaveBeenCalled();
    });

    it('getState() returns enabled, lastScanAt, lastReport', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const stateBefore = scanner.getState();
      expect(stateBefore.enabled).toBe(true);
      expect(stateBefore.lastScanAt).toBeNull();
      expect(stateBefore.lastReport).toBeNull();

      await scanner.runScanForTest();
      const stateAfter = scanner.getState();
      expect(stateAfter.lastScanAt).not.toBeNull();
      expect(stateAfter.lastReport).not.toBeNull();
      expect(stateAfter.lastReport!.results).toHaveLength(1);
    });

    it('runScanForTest() exposes runScan for testing', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report).toBeDefined();
      expect(report.results).toHaveLength(1);
    });
  });

  // ── Running guard ─────────────────────────────────────────────────────
  describe('running guard', () => {
    it('prevents concurrent scan execution', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });

      let resolveFirst!: () => void;
      const slowPromise = new Promise<number | undefined>(resolve => { resolveFirst = () => resolve(42); });
      mockFindSentinel.mockReturnValueOnce(slowPromise as any);
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const scan1 = scanner.runScanForTest();
      const scan2 = scanner.runScanForTest();

      resolveFirst();
      await scan1;
      await scan2;

      // Only one scan should have called findSentinel (the second was a no-op)
      expect(mockFindSentinel).toHaveBeenCalledTimes(1);
    });

    it('does not run scan when client.state !== connected', async () => {
      const client = createMockClient('disconnected');
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ client: client as any, sentinelStore: createMockStore(sentinels) as any });

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(mockFindSentinel).not.toHaveBeenCalled();
      // runScanForTest should return an empty report or null-like report
      expect(report.results).toHaveLength(0);
    });
  });

  // ── Transient IMAP errors ─────────────────────────────────────────────
  describe('transient IMAP error handling', () => {
    it('catches NoConnection error and logs at debug', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const logger = createMockLogger();
      const store = createMockStore(sentinels);
      store.getAll.mockImplementation(() => { throw Object.assign(new Error('no conn'), { code: 'NoConnection' }); });
      const deps = makeDeps({ sentinelStore: store as any, logger: logger as any });

      const scanner = new SentinelScanner(deps);
      // Should not throw
      const report = await scanner.runScanForTest();

      expect(logger.debug).toHaveBeenCalled();
    });

    it('catches ETIMEOUT error and logs at debug', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const logger = createMockLogger();
      const store = createMockStore(sentinels);
      store.getAll.mockImplementation(() => { throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); });
      const deps = makeDeps({ sentinelStore: store as any, logger: logger as any });

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(logger.debug).toHaveBeenCalled();
    });

    it('rethrows non-transient errors', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const store = createMockStore(sentinels);
      store.getAll.mockImplementation(() => { throw new Error('kaboom'); });
      const deps = makeDeps({ sentinelStore: store as any });

      const scanner = new SentinelScanner(deps);
      await expect(scanner.runScanForTest()).rejects.toThrow('kaboom');
    });
  });

  // ── Detection only ────────────────────────────────────────────────────
  describe('detection only (no mutations)', () => {
    it('never calls mutating methods on sentinelStore', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const store = createMockStore(sentinels);
      const deps = makeDeps({ sentinelStore: store as any });
      // Found in different folder
      mockFindSentinel.mockResolvedValueOnce(undefined);
      mockFindSentinel.mockResolvedValueOnce(77);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      expect(store.upsert).not.toHaveBeenCalled();
      expect(store.updateFolderPath).not.toHaveBeenCalled();
      expect(store.deleteByMessageId).not.toHaveBeenCalled();
      expect(store.deleteByFolder).not.toHaveBeenCalled();
    });
  });

  // ── onScanComplete callback ───────────────────────────────────────────
  describe('onScanComplete callback', () => {
    it('calls onScanComplete with ScanReport after each scan', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const onScanComplete = vi.fn();
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any, onScanComplete });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      await scanner.runScanForTest();

      expect(onScanComplete).toHaveBeenCalledTimes(1);
      const report = onScanComplete.mock.calls[0][0];
      expect(report.results).toHaveLength(1);
      expect(report.scannedAt).toBeDefined();
    });

    it('scan completes normally when onScanComplete not provided', async () => {
      const sentinels = [
        { messageId: '<s1@test>', folderPath: 'Archive', folderPurpose: 'rule-target', createdAt: '2026-01-01' },
      ];
      const deps = makeDeps({ sentinelStore: createMockStore(sentinels) as any });
      mockFindSentinel.mockResolvedValue(42);

      const scanner = new SentinelScanner(deps);
      const report = await scanner.runScanForTest();

      expect(report.results).toHaveLength(1);
    });
  });
});
