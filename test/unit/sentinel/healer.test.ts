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

  // ── Folder loss - rule disabling (FAIL-01) ─────────────────────────

  describe('folder loss - rule disabling', () => {
    function makeFolderLostReport(folder = 'LostFolder'): ScanReport {
      return {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: folder,
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };
    }

    function makeFolderGoneDeps(config: Config, overrides: Partial<SentinelHealerDeps> = {}) {
      const client = createMockClient();
      // Folder NOT in the list = folder is gone
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
        { path: 'OtherFolder', flags: [] },
      ]);
      return makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
        ...overrides,
      });
    }

    it('disables all rules with action.folder matching lost path', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
          { id: 'r2', name: 'Rule2', enabled: true, order: 1, match: { sender: '*@b.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const deps = makeFolderGoneDeps(config);

      await handleScanReport(makeFolderLostReport(), deps);

      expect(config.rules[0].enabled).toBe(false);
      expect(config.rules[1].enabled).toBe(false);
    });

    it('does not disable rules with action.folder NOT matching lost path', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
          { id: 'r2', name: 'Rule2', enabled: true, order: 1, match: { sender: '*@b.com' }, action: { type: 'move', folder: 'SafeFolder' } },
        ] as any,
      });
      const deps = makeFolderGoneDeps(config);

      await handleScanReport(makeFolderLostReport(), deps);

      expect(config.rules[0].enabled).toBe(false);
      expect(config.rules[1].enabled).toBe(true);
    });

    it('persists disabled rules via saveConfig', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const deps = makeFolderGoneDeps(config);

      await handleScanReport(makeFolderLostReport(), deps);

      expect(mockSaveConfig).toHaveBeenCalledWith('/tmp/config.yml', expect.objectContaining({
        rules: expect.arrayContaining([
          expect.objectContaining({ id: 'r1', enabled: false }),
        ]),
      }));
    });

    it('logs warning for review.folder matching lost path but does NOT disable -- D-09', async () => {
      const config = createBaseConfig();
      config.review.folder = 'LostFolder';
      const logger = createMockLogger();
      const deps = makeFolderGoneDeps(config, { logger: logger as any });

      await handleScanReport(makeFolderLostReport(), deps);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'LostFolder' }),
        expect.stringContaining('Review folder lost'),
      );
      // review.folder should not be cleared/disabled
      expect(config.review.folder).toBe('LostFolder');
    });

    it('logs warning for review.defaultArchiveFolder matching lost path -- D-09', async () => {
      const config = createBaseConfig();
      config.review.defaultArchiveFolder = 'LostFolder';
      const logger = createMockLogger();
      const deps = makeFolderGoneDeps(config, { logger: logger as any });

      await handleScanReport(makeFolderLostReport(), deps);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'LostFolder' }),
        expect.stringContaining('Default archive folder lost'),
      );
      expect(config.review.defaultArchiveFolder).toBe('LostFolder');
    });

    it('logs warning for action folder path matching lost path -- D-10', async () => {
      const config = createBaseConfig();
      config.actionFolders.prefix = 'Actions';
      config.actionFolders.folders.vip = 'VIP';
      const logger = createMockLogger();
      const deps = makeFolderGoneDeps(config, { logger: logger as any });

      await handleScanReport(makeFolderLostReport('Actions/VIP'), deps);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'Actions/VIP' }),
        expect.stringContaining('Action folder lost'),
      );
    });
  });

  // ── INBOX notification (FAIL-02) ───────────────────────────────────

  describe('INBOX notification', () => {
    function makeFolderGoneDepsWithClient(config: Config) {
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([
        { path: 'INBOX', flags: [] },
      ]);
      client.appendMessage.mockResolvedValue({ uid: 1 });
      const store = createMockStore();
      const activityLog = createMockActivityLog();
      const deps = makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
        sentinelStore: store as any,
        activityLog: activityLog as any,
      });
      return { deps, client, store, activityLog };
    }

    it('appends notification to INBOX when folder gone', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const { deps, client } = makeFolderGoneDepsWithClient(config);

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(client.appendMessage).toHaveBeenCalledWith(
        'INBOX',
        expect.stringContaining('[Mail Manager] Folder lost: LostFolder'),
        ['\\Seen'],
      );
    });

    it('notification body contains folder path, disabled rule names, and fix instructions', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'MyRule', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const { deps, client } = makeFolderGoneDepsWithClient(config);

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      const rawMessage = client.appendMessage.mock.calls[0][1] as string;
      expect(rawMessage).toContain('LostFolder');
      expect(rawMessage).toContain('MyRule');
      expect(rawMessage).toMatch(/recreate|update/i);
    });

    it('notification has \\Seen flag', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const { deps, client } = makeFolderGoneDepsWithClient(config);

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(client.appendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ['\\Seen'],
      );
    });

    it('notification has valid RFC 2822 headers', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const { deps, client } = makeFolderGoneDepsWithClient(config);

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      const rawMessage = client.appendMessage.mock.calls[0][1] as string;
      expect(rawMessage).toContain('From:');
      expect(rawMessage).toContain('To:');
      expect(rawMessage).toContain('Subject:');
      expect(rawMessage).toContain('Message-ID:');
      expect(rawMessage).toContain('Date:');
      expect(rawMessage).toContain('Content-Type: text/plain');
    });
  });

  // ── No auto-recreate (FAIL-03) ─────────────────────────────────────

  describe('no auto-recreate', () => {
    it('does NOT call any folder creation method when folder gone', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([{ path: 'INBOX', flags: [] }]);
      const deps = makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      // appendSentinel should NOT be called (that's for replanting, not folder loss)
      expect(mockAppendSentinel).not.toHaveBeenCalled();
    });
  });

  // ── Dedup (D-06) ───────────────────────────────────────────────────

  describe('dedup', () => {
    it('sends notification and removes sentinel mapping on first folder loss', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([{ path: 'INBOX', flags: [] }]);
      const store = createMockStore();
      const activityLog = createMockActivityLog();
      const deps = makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
        sentinelStore: store as any,
        activityLog: activityLog as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(store.deleteByMessageId).toHaveBeenCalledWith('<s1@test>');
      expect(activityLog.setState).toHaveBeenCalledWith(
        'sentinel:notified:LostFolder',
        expect.any(String),
      );
    });

    it('does not send duplicate notification when sentinel mapping already removed', async () => {
      const config = createBaseConfig();
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([{ path: 'INBOX', flags: [] }]);
      const store = createMockStore();
      // Simulate: sentinel mapping was already removed (getByMessageId returns null)
      store.getByMessageId.mockReturnValue(null);
      const deps = makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
        sentinelStore: store as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(client.appendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Folder loss activity logging (HEAL-04) ─────────────────────────

  describe('folder loss activity logging', () => {
    it('logs folder loss event with action=folder-lost and details', async () => {
      const config = createBaseConfig({
        rules: [
          { id: 'r1', name: 'Rule1', enabled: true, order: 0, match: { sender: '*@a.com' }, action: { type: 'move', folder: 'LostFolder' } },
        ] as any,
      });
      const client = createMockClient();
      client.listMailboxes.mockResolvedValue([{ path: 'INBOX', flags: [] }]);
      const activityLog = createMockActivityLog();
      const deps = makeDeps({
        client: client as any,
        configRepo: { getConfig: () => config } as any,
        activityLog: activityLog as any,
      });

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results: [{
          status: 'not-found',
          messageId: '<s1@test>',
          expectedFolder: 'LostFolder',
          folderPurpose: 'rule-target',
        }],
        deepScansTriggered: 1,
        errors: 0,
      };

      await handleScanReport(report, deps);

      expect(activityLog.logSentinelEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'folder-lost',
          folder: 'LostFolder',
        }),
      );
      const details = JSON.parse(activityLog.logSentinelEvent.mock.calls[0][0].details);
      expect(details.disabledRules).toContain('Rule1');
      expect(details.notificationSent).toBe(true);
    });
  });
});
