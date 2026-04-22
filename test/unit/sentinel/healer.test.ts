import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/sentinel/imap-ops.js', () => ({
  appendSentinel: vi.fn(),
}));

vi.mock('../../../src/config/loader.js', () => ({
  saveConfig: vi.fn(),
}));

import { handleScanReport, createScanCompleteHandler } from '../../../src/sentinel/healer.js';
import type { SentinelHealerDeps } from '../../../src/sentinel/healer.js';
import type { ScanReport } from '../../../src/sentinel/scanner.js';
import type { Config } from '../../../src/config/schema.js';
import { appendSentinel } from '../../../src/sentinel/imap-ops.js';
import { saveConfig } from '../../../src/config/loader.js';

const mockAppendSentinel = vi.mocked(appendSentinel);
const mockSaveConfig = vi.mocked(saveConfig);

// ── Helpers ────────────────────────────────────────────────────────────

function createMockStore() {
  return {
    getAll: vi.fn(() => []),
    getByMessageId: vi.fn(() => ({ messageId: '<s1@test>', folderPath: 'OldFolder', folderPurpose: 'rule-target', createdAt: '2026-01-01' })),
    getByFolder: vi.fn(),
    upsert: vi.fn(),
    updateFolderPath: vi.fn(() => true),
    deleteByMessageId: vi.fn(() => true),
    deleteByFolder: vi.fn(),
  };
}

function createMockClient() {
  return {
    state: 'connected',
    listMailboxes: vi.fn(async () => [
      { path: 'INBOX', flags: [] },
      { path: 'Archive', flags: [] },
      { path: 'Work', flags: [] },
    ]),
    appendMessage: vi.fn(async () => ({ uid: 1 })),
  };
}

function createMockLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

function createMockActivityLog() {
  return {
    logSentinelEvent: vi.fn(),
    getState: vi.fn(() => undefined),
    setState: vi.fn(),
  };
}

function createBaseConfig(overrides: Partial<Config> = {}): Config {
  return {
    imap: { host: 'imap.test', port: 993, tls: true, auth: { user: 'u', pass: 'p' }, idleTimeout: 300000, pollInterval: 60000 },
    server: { port: 3000, host: '0.0.0.0' },
    rules: [
      {
        id: 'r1', name: 'Move to OldFolder', enabled: true, order: 0,
        match: { sender: '*@example.com' },
        action: { type: 'move', folder: 'OldFolder' },
      },
      {
        id: 'r2', name: 'Move elsewhere', enabled: true, order: 1,
        match: { sender: '*@other.com' },
        action: { type: 'move', folder: 'OtherFolder' },
      },
    ],
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'Archive',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: true, scanInterval: 30 },
    },
    actionFolders: {
      enabled: true,
      prefix: 'Actions',
      pollInterval: 15,
      folders: { vip: 'VIP', block: 'Block', undoVip: 'UndoVIP', unblock: 'Unblock' },
    },
    sentinel: { scanIntervalMs: 300000 },
    ...overrides,
  } as Config;
}

function makeDeps(overrides: Partial<SentinelHealerDeps> = {}): SentinelHealerDeps {
  return {
    configRepo: { getConfig: vi.fn(() => createBaseConfig()) } as any,
    configPath: '/tmp/config.yml',
    sentinelStore: createMockStore() as any,
    client: createMockClient() as any,
    activityLog: createMockActivityLog() as any,
    logger: createMockLogger() as any,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('SentinelHealer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendSentinel.mockResolvedValue({ messageId: '<new@test>', uid: 99 });
  });

  // ── Rename handling (HEAL-01, HEAL-02) ─────────────────────────────

  describe('rename handling', () => {
    it('updates rule.action.folder from oldPath to newPath', async () => {
      const config = createBaseConfig();
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldFolder',
          actualFolder: 'NewFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(config.rules[0].action.folder).toBe('NewFolder');
      expect(config.rules[1].action.folder).toBe('OtherFolder'); // unchanged
    });

    it('updates review.folder when it matches old path', async () => {
      const config = createBaseConfig();
      config.review.folder = 'OldReview';
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldReview',
          actualFolder: 'NewReview',
          folderPurpose: 'review',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);
      expect(config.review.folder).toBe('NewReview');
    });

    it('updates review.defaultArchiveFolder when it matches old path', async () => {
      const config = createBaseConfig();
      config.review.defaultArchiveFolder = 'OldArchive';
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldArchive',
          actualFolder: 'NewArchive',
          folderPurpose: 'sweep-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);
      expect(config.review.defaultArchiveFolder).toBe('NewArchive');
    });

    it('updates action folder entry when path matches old path', async () => {
      const config = createBaseConfig();
      config.actionFolders.folders.vip = 'VIP';
      config.actionFolders.prefix = 'Actions';
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'Actions/VIP',
          actualFolder: 'Actions/StarVIP',
          folderPurpose: 'action-folder',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);
      expect(config.actionFolders.folders.vip).toBe('StarVIP');
    });

    it('updates actionFolders.prefix when the prefix parent folder is renamed', async () => {
      const config = createBaseConfig();
      config.actionFolders.prefix = 'Actions';
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'Actions',
          actualFolder: 'MyActions',
          folderPurpose: 'action-folder',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);
      expect(config.actionFolders.prefix).toBe('MyActions');
    });

    it('calls saveConfig (not ConfigRepository update methods) -- per D-02', async () => {
      const deps = makeDeps();

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldFolder',
          actualFolder: 'NewFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(mockSaveConfig).toHaveBeenCalledWith('/tmp/config.yml', expect.any(Object));
    });

    it('calls sentinelStore.updateFolderPath(messageId, newPath) -- per D-03', async () => {
      const store = createMockStore();
      const deps = makeDeps({ sentinelStore: store as any });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldFolder',
          actualFolder: 'NewFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(store.updateFolderPath).toHaveBeenCalledWith('<s1@test>', 'NewFolder');
    });

    it('logs rename event to activity log', async () => {
      const activityLog = createMockActivityLog();
      const deps = makeDeps({ activityLog: activityLog as any });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldFolder',
          actualFolder: 'NewFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(activityLog.logSentinelEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rename-healed',
          folder: 'NewFolder',
        }),
      );
      const details = JSON.parse(activityLog.logSentinelEvent.mock.calls[0][0].details);
      expect(details.oldPath).toBe('OldFolder');
      expect(details.newPath).toBe('NewFolder');
    });

    it('processes multiple renames in one report independently -- per D-04', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'FolderA' } },
          { id: 'r2', name: 'Rule2', enabled: true, order: 1, match: { sender: '*@b.com' }, action: { type: 'move', folder: 'FolderB' } },
        ] as any,
      });
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [
          { status: 'found-in-different-folder', messageId: '<s1@test>', expectedFolder: 'FolderA', actualFolder: 'NewA', folderPurpose: 'rule-target' },
          { status: 'found-in-different-folder', messageId: '<s2@test>', expectedFolder: 'FolderB', actualFolder: 'NewB', folderPurpose: 'rule-target' },
        ],
        deepScansTriggered: 2,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(config.rules[0].action.folder).toBe('NewA');
      expect(config.rules[1].action.folder).toBe('NewB');
    });

    it('ignores found-in-place results (no-op)', async () => {
      const deps = makeDeps();

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-place',
          messageId: '<s1@test>',
          expectedFolder: 'Archive',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 0,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect((deps.sentinelStore as any).updateFolderPath).not.toHaveBeenCalled();
    });
  });

  // ── Replant handling (HEAL-03) ─────────────────────────────────────

  describe('replant handling', () => {
    it('replants sentinel when folder still exists on IMAP', async () => {
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
      ]);
      const store = createMockStore();
      const deps = makeDeps({
        client: client as any,
        sentinelStore: store as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'Archive',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(store.deleteByMessageId).toHaveBeenCalledWith('<s1@test>');
      expect(mockAppendSentinel).toHaveBeenCalledWith(
        client,
        'Archive',
        'rule-target',
        store,
      );
    });

    it('logs replant event to activity log with action=sentinel-replanted -- per D-12', async () => {
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
      ]);
      const activityLog = createMockActivityLog();
      const deps = makeDeps({
        client: client as any,
        activityLog: activityLog as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'Archive',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(activityLog.logSentinelEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sentinel-replanted',
          folder: 'Archive',
        }),
      );
    });

    it('replant does NOT send INBOX notification -- per D-12', async () => {
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'Archive', flags: [] },
      ]);
      const deps = makeDeps({ client: client as any });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'Archive',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(client.appendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Activity Log extension (HEAL-04) ────────────────────────────────

  describe('activity log extension', () => {
    it('logSentinelEvent accepts action, folder, details fields', async () => {
      const activityLog = createMockActivityLog();
      const deps = makeDeps({ activityLog: activityLog as any });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'OldFolder',
          actualFolder: 'NewFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      const call = activityLog.logSentinelEvent.mock.calls[0][0];
      expect(call).toHaveProperty('action');
      expect(call).toHaveProperty('folder');
      expect(call).toHaveProperty('details');
    });
  });

  // ── createScanCompleteHandler ───────────────────────────────────────

  describe('createScanCompleteHandler', () => {
    it('returns a sync function that wraps handleScanReport', () => {
      const deps = makeDeps();
      const handler = createScanCompleteHandler(deps);
      expect(typeof handler).toBe('function');
    });

    it('catches errors from handleScanReport and logs them', async () => {
      const logger = createMockLogger();
      const deps = makeDeps({
        logger: logger as any,
        // Force an error by providing a broken configRepo
        configRepo: { getConfig: () => { throw new Error('config boom'); } } as any,
      });
      const handler = createScanCompleteHandler(deps);

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'found-in-different-folder',
          messageId: '<s1@test>',
          expectedFolder: 'Old',
          actualFolder: 'New',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      // Should not throw
      handler(report);

      // Give the promise time to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── Per-item error isolation ────────────────────────────────────────

  describe('error isolation', () => {
    it('continues processing other results when one rename fails', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'FolderA' } },
          { id: 'r2', name: 'Rule2', enabled: true, order: 1, match: { sender: '*@b.com' }, action: { type: 'move', folder: 'FolderB' } },
        ] as any,
      });

      // Make saveConfig throw on first call, succeed on second
      let callCount = 0;
      mockSaveConfig.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('save failed');
      });

      const store = createMockStore();
      const deps = makeDeps({
        configRepo: { getConfig: () => config } as any,
        sentinelStore: store as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [
          { status: 'found-in-different-folder', messageId: '<s1@test>', expectedFolder: 'FolderA', actualFolder: 'NewA', folderPurpose: 'rule-target' },
          { status: 'found-in-different-folder', messageId: '<s2@test>', expectedFolder: 'FolderB', actualFolder: 'NewB', folderPurpose: 'rule-target' },
        ],
        deepScansTriggered: 2,
        errors: 0,
      };

      await handleScanReport(report, deps);

      // Second rename should still have been attempted
      expect(store.updateFolderPath).toHaveBeenCalledWith('<s2@test>', 'NewB');
    });
  });
});
