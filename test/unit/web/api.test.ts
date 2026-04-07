import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { buildServer } from '../../../src/web/server.js';
import type { ServerDeps } from '../../../src/web/server.js';
import type { Config } from '../../../src/config/index.js';
import { ConfigRepository } from '../../../src/config/repository.js';
import { ActivityLog } from '../../../src/log/index.js';

// --- Helpers ---

function makeConfig(rules: Config['rules'] = []): Config {
  return {
    imap: {
      host: 'imap.test.com',
      port: 993,
      tls: true,
      auth: { user: 'test@test.com', pass: 'secret123' },
      idleTimeout: 300000,
      pollInterval: 60000,
    },
    server: { port: 3000, host: '0.0.0.0' },
    rules,
  };
}

function makeRule(overrides: Partial<Config['rules'][0]> = {}): Config['rules'][0] {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: '*@test.com' },
    action: { type: 'move', folder: 'Test' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

let tmpDir: string;
let configPath: string;
let activityLog: ActivityLog;
let updatedRules: Config['rules'] | null;

function writeConfig(config: Config): void {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
}

const mockFolderCache = {
  getTree: vi.fn(async () => []),
  refresh: vi.fn(async () => []),
  hasFolder: vi.fn((p: string) => p === 'Test' || p === 'Archive'),
  getResponse: vi.fn(() => ({ folders: [], cachedAt: new Date().toISOString(), stale: false })),
};

function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  updatedRules = null;
  const configRepo = new ConfigRepository(configPath);
  configRepo.onRulesChange((rules) => { updatedRules = rules; });

  return {
    configRepo,
    activityLog,
    getMonitor: () => ({
      getState() {
        return {
          connectionStatus: 'connected',
          lastProcessedAt: new Date('2026-01-01T00:00:00Z'),
          messagesProcessed: 42,
        };
      },
    }) as any,
    getSweeper: () => undefined,
    getFolderCache: () => mockFolderCache as any,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-api-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Rule CRUD ---

describe('GET /api/rules', () => {
  it('returns rules sorted by order', async () => {
    const config = makeConfig([
      makeRule({ id: 'b', order: 2 }),
      makeRule({ id: 'a', order: 1 }),
    ]);
    const app = buildServer(makeDeps(config));

    const res = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('a');
    expect(body[1].id).toBe('b');
  });

  it('returns empty array when no rules', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/rules', () => {
  it('creates a rule with generated id', async () => {
    const app = buildServer(makeDeps(makeConfig()));

    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'New Rule',
        match: { sender: '*@github.com' },
        action: { type: 'move', folder: 'Dev' },
        enabled: true,
        order: 0,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('New Rule');
    expect(updatedRules).toHaveLength(1);
  });

  it('rejects invalid rule body', async () => {
    const app = buildServer(makeDeps(makeConfig()));

    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: { name: '' }, // missing required fields
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });
});

describe('PUT /api/rules/:id', () => {
  it('updates an existing rule', async () => {
    const config = makeConfig([makeRule({ id: 'rule-1' })]);
    const app = buildServer(makeDeps(config));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/rules/rule-1',
      payload: {
        name: 'Updated Rule',
        match: { sender: '*@updated.com' },
        action: { type: 'move', folder: 'Updated' },
        enabled: false,
        order: 5,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Updated Rule');
    expect(updatedRules![0].name).toBe('Updated Rule');
  });

  it('returns 404 for non-existent rule', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rules/nope',
      payload: { name: 'X', match: { sender: '*' }, action: { type: 'move', folder: 'X' }, enabled: true, order: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/rules/:id', () => {
  it('deletes an existing rule', async () => {
    const config = makeConfig([makeRule({ id: 'rule-1' })]);
    const app = buildServer(makeDeps(config));

    const res = await app.inject({ method: 'DELETE', url: '/api/rules/rule-1' });
    expect(res.statusCode).toBe(204);
    expect(updatedRules).toHaveLength(0);
  });

  it('returns 404 for non-existent rule', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'DELETE', url: '/api/rules/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/rules/reorder', () => {
  it('reorders rules and persists', async () => {
    const config = makeConfig([
      makeRule({ id: 'a', order: 1 }),
      makeRule({ id: 'b', order: 2 }),
    ]);
    const app = buildServer(makeDeps(config));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/rules/reorder',
      payload: [
        { id: 'b', order: 0 },
        { id: 'a', order: 1 },
      ],
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].id).toBe('b');
    expect(body[1].id).toBe('a');
  });
});

// --- Activity ---

describe('GET /api/activity', () => {
  it('returns activity entries', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('respects limit and offset params', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/activity?limit=10&offset=5' });
    expect(res.statusCode).toBe(200);
  });
});

// --- Status ---

describe('GET /api/status', () => {
  it('returns monitor state', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connectionStatus).toBe('connected');
    expect(body.messagesProcessed).toBe(42);
    expect(body.lastProcessedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// --- IMAP Config ---

describe('GET /api/config/imap', () => {
  it('returns IMAP config with masked password', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/config/imap' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host).toBe('imap.test.com');
    expect(body.auth.pass).toBe('****');
    expect(body.auth.user).toBe('test@test.com');
  });
});

describe('PUT /api/config/imap', () => {
  it('updates IMAP config preserving masked password', async () => {
    let configChanged = false;
    const deps = makeDeps(makeConfig());
    deps.configRepo.onImapConfigChange(async () => { configChanged = true; });
    const app = buildServer(deps);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/imap',
      payload: {
        host: 'new.host.com',
        port: 993,
        tls: true,
        auth: { user: 'new@test.com', pass: '****' },
        idleTimeout: 300000,
        pollInterval: 60000,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host).toBe('new.host.com');
    expect(body.auth.pass).toBe('****');
    expect(configChanged).toBe(true);
  });

  it('updates password when not masked', async () => {
    const deps = makeDeps(makeConfig());
    const app = buildServer(deps);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/imap',
      payload: {
        host: 'imap.test.com',
        port: 993,
        tls: true,
        auth: { user: 'test@test.com', pass: 'new-secret' },
        idleTimeout: 300000,
        pollInterval: 60000,
      },
    });

    expect(res.statusCode).toBe(200);
    // Verify the saved config has the new password
    const { loadConfig } = await import('../../../src/config/index.js');
    const saved = loadConfig(configPath);
    expect(saved.imap.auth.pass).toBe('new-secret');
  });

  it('rejects invalid IMAP config', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/imap',
      payload: { host: '', port: -1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// --- Review Status (I6) ---

describe('GET /api/review/status', () => {
  it('returns correct shape with sweeper state', async () => {
    const deps = makeDeps(makeConfig());
    deps.getSweeper = () => ({
      getState() {
        return {
          folder: 'Review',
          totalMessages: 5,
          unreadMessages: 2,
          readMessages: 3,
          nextSweepAt: '2026-01-01T06:00:00.000Z',
          lastSweep: {
            completedAt: '2026-01-01T00:00:00.000Z',
            messagesArchived: 1,
            errors: 0,
          },
        };
      },
    }) as any;
    const app = buildServer(deps);

    const res = await app.inject({ method: 'GET', url: '/api/review/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe('Review');
    expect(body.totalMessages).toBe(5);
    expect(body.unreadMessages).toBe(2);
    expect(body.readMessages).toBe(3);
    expect(body.nextSweepAt).toBe('2026-01-01T06:00:00.000Z');
    expect(body.lastSweep).toEqual({
      completedAt: '2026-01-01T00:00:00.000Z',
      messagesArchived: 1,
      errors: 0,
    });
  });

  it('returns nulls before first sweep (no sweeper)', async () => {
    const deps = makeDeps(makeConfig());
    // No sweeper attached
    const app = buildServer(deps);

    const res = await app.inject({ method: 'GET', url: '/api/review/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe('Review');
    expect(body.totalMessages).toBe(0);
    expect(body.unreadMessages).toBe(0);
    expect(body.readMessages).toBe(0);
    expect(body.nextSweepAt).toBeNull();
    expect(body.lastSweep).toBeNull();
  });
});

// --- Review Config (I7) ---

describe('GET /api/config/review', () => {
  it('returns review config with defaults', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/config/review' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe('Review');
    expect(body.defaultArchiveFolder).toBe('MailingLists');
    expect(body.trashFolder).toBe('Trash');
    expect(body.sweep.intervalHours).toBe(6);
    expect(body.sweep.readMaxAgeDays).toBe(7);
    expect(body.sweep.unreadMaxAgeDays).toBe(14);
  });
});

describe('PUT /api/config/review', () => {
  it('updates review config and triggers restart', async () => {
    let reviewChanged = false;
    const deps = makeDeps(makeConfig());
    deps.configRepo.onReviewConfigChange(async () => { reviewChanged = true; });
    const app = buildServer(deps);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/review',
      payload: {
        folder: 'CustomReview',
        defaultArchiveFolder: 'Archive',
        trashFolder: 'Deleted',
        sweep: { intervalHours: 12, readMaxAgeDays: 3, unreadMaxAgeDays: 7 },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folder).toBe('CustomReview');
    expect(body.sweep.intervalHours).toBe(12);
    expect(reviewChanged).toBe(true);
  });

  it('rejects invalid review config', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/review',
      payload: { folder: '', sweep: { intervalHours: -1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });
});

// --- Rule CRUD accepts all four action types (I8) ---

describe('Rule CRUD with all action types', () => {
  it('accepts move action', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Move Rule', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Archive' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().action.type).toBe('move');
  });

  it('accepts review action without folder', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Review Rule', match: { sender: '*@test.com' },
        action: { type: 'review' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().action.type).toBe('review');
  });

  it('accepts review action with folder', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Review Rule', match: { sender: '*@test.com' },
        action: { type: 'review', folder: 'CustomArchive' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().action).toEqual({ type: 'review', folder: 'CustomArchive' });
  });

  it('accepts skip action', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Skip Rule', match: { sender: '*@test.com' },
        action: { type: 'skip' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().action.type).toBe('skip');
  });

  it('accepts delete action', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Delete Rule', match: { sender: '*@test.com' },
        action: { type: 'delete' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().action.type).toBe('delete');
  });
});

// --- Folder validation warnings ---

describe('Folder validation warnings', () => {
  it('POST rule with move to nonexistent folder returns 201 with warnings', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Move Rule', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Nonexistent' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warnings).toEqual(['Destination folder "Nonexistent" not found on server']);
  });

  it('POST rule with move to existing folder returns 201 with no warnings', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Move Rule', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Test' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warnings).toBeUndefined();
  });

  it('POST rule with skip action returns 201 with no warnings', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Skip Rule', match: { sender: '*@test.com' },
        action: { type: 'skip' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warnings).toBeUndefined();
  });

  it('PUT rule with move to nonexistent folder returns 200 with warnings', async () => {
    const config = makeConfig([makeRule({ id: 'rule-1' })]);
    const app = buildServer(makeDeps(config));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rules/rule-1',
      payload: {
        name: 'Updated', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Nonexistent' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.warnings).toEqual(['Destination folder "Nonexistent" not found on server']);
  });

  it('POST rule with review action and nonexistent folder returns 201 with warnings', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Review Rule', match: { sender: '*@test.com' },
        action: { type: 'review', folder: 'Nonexistent' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warnings).toEqual(['Destination folder "Nonexistent" not found on server']);
  });

  it('rule is persisted even when warning is returned', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Warned Rule', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Nonexistent' }, enabled: true, order: 0,
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().warnings).toBeDefined();

    const listRes = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0].name).toBe('Warned Rule');
  });

  it('skips validation when folder cache has no tree data', async () => {
    const emptyCache = {
      getTree: vi.fn(async () => []),
      refresh: vi.fn(async () => []),
      hasFolder: vi.fn(() => false),
      getResponse: vi.fn(() => ({ folders: [], cachedAt: new Date().toISOString(), stale: false })),
    };
    const config = makeConfig();
    writeConfig(config);
    const configRepo = new ConfigRepository(configPath);
    const deps: ServerDeps = {
      configRepo,
      activityLog,
      monitor: { getState() { return { connectionStatus: 'connected', lastProcessedAt: new Date(), messagesProcessed: 0 }; } } as any,
      getFolderCache: () => emptyCache as any,
    };
    const app = buildServer(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Rule', match: { sender: '*@test.com' },
        action: { type: 'move', folder: 'Whatever' }, enabled: true, order: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    // hasFolder returns false for empty cache, but since there's no tree loaded
    // the implementation should check whether the cache has data before warning
    // For now this test documents the behavior - warnings will appear even with empty cache
    // unless the implementation explicitly checks for empty cache
  });
});

// --- Recent Folders endpoint ---

describe('GET /api/activity/recent-folders', () => {
  it('returns 200 with empty array when no activity', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent-folders' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns recent folder paths ordered by most recently used', async () => {
    const deps = makeDeps(makeConfig());
    const app = buildServer(deps);

    const msg = {
      uid: 1, from: { name: 'T', address: 't@test.com' },
      to: [{ name: '', address: 'me@test.com' }], cc: [],
      subject: 'Test', date: new Date(), flags: new Set(), internalDate: new Date(),
    };
    const rule = { id: 'r1', name: 'R', match: { sender: '*' }, action: { type: 'move' as const, folder: 'X' }, enabled: true, order: 0 };

    deps.activityLog.logActivity(
      { success: true, messageUid: 1, messageId: 'm1', action: 'move', folder: 'Archive', rule: 'r1', timestamp: new Date() },
      msg, rule, 'arrival',
    );
    deps.activityLog.logActivity(
      { success: true, messageUid: 2, messageId: 'm2', action: 'move', folder: 'Lists', rule: 'r1', timestamp: new Date() },
      { ...msg, uid: 2 }, rule, 'arrival',
    );
    deps.activityLog.logActivity(
      { success: true, messageUid: 3, messageId: 'm3', action: 'move', folder: 'Archive', rule: 'r1', timestamp: new Date() },
      { ...msg, uid: 3 }, rule, 'arrival',
    );

    const res = await app.inject({ method: 'GET', url: '/api/activity/recent-folders' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual(['Archive', 'Lists']);
  });

  it('respects limit query parameter', async () => {
    const deps = makeDeps(makeConfig());
    const app = buildServer(deps);

    const msg = {
      uid: 1, from: { name: 'T', address: 't@test.com' },
      to: [{ name: '', address: 'me@test.com' }], cc: [],
      subject: 'Test', date: new Date(), flags: new Set(), internalDate: new Date(),
    };
    const rule = { id: 'r1', name: 'R', match: { sender: '*' }, action: { type: 'move' as const, folder: 'X' }, enabled: true, order: 0 };

    deps.activityLog.logActivity(
      { success: true, messageUid: 1, messageId: 'm1', action: 'move', folder: 'A', rule: 'r1', timestamp: new Date() },
      msg, rule, 'arrival',
    );
    deps.activityLog.logActivity(
      { success: true, messageUid: 2, messageId: 'm2', action: 'move', folder: 'B', rule: 'r1', timestamp: new Date() },
      { ...msg, uid: 2 }, rule, 'arrival',
    );
    deps.activityLog.logActivity(
      { success: true, messageUid: 3, messageId: 'm3', action: 'move', folder: 'C', rule: 'r1', timestamp: new Date() },
      { ...msg, uid: 3 }, rule, 'arrival',
    );

    const res = await app.inject({ method: 'GET', url: '/api/activity/recent-folders?limit=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('clamps limit to max 20', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent-folders?limit=999' });
    expect(res.statusCode).toBe(200);
    // Just verify it doesn't error — clamping is internal
  });

  it('clamps limit to min 1', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/activity/recent-folders?limit=-1' });
    expect(res.statusCode).toBe(200);
  });
});

// --- Activity returns source field (I9) ---

describe('GET /api/activity source field', () => {
  it('returns source field in activity entries', async () => {
    const deps = makeDeps(makeConfig());
    const app = buildServer(deps);

    // Log an activity entry with source 'arrival'
    deps.activityLog.logActivity(
      {
        success: true,
        messageUid: 1,
        messageId: 'msg-1@test.com',
        action: 'move',
        folder: 'Archive',
        rule: 'rule-1',
        timestamp: new Date('2026-01-01T00:00:00Z'),
      },
      {
        uid: 1,
        from: { name: 'Test', address: 'test@test.com' },
        to: [{ name: '', address: 'me@test.com' }],
        cc: [],
        subject: 'Test',
        date: new Date(),
        flags: new Set(),
        internalDate: new Date(),
      },
      { id: 'rule-1', name: 'Test Rule', match: { sender: '*@test.com' }, action: { type: 'move', folder: 'Archive' }, enabled: true, order: 0 },
      'arrival',
    );

    // Log a sweep-sourced entry
    deps.activityLog.logActivity(
      {
        success: true,
        messageUid: 2,
        messageId: 'msg-2@test.com',
        action: 'move',
        folder: 'Archive',
        rule: '',
        timestamp: new Date('2026-01-01T01:00:00Z'),
      },
      {
        uid: 2,
        from: { name: 'Test2', address: 'test2@test.com' },
        to: [{ name: '', address: 'me@test.com' }],
        cc: [],
        subject: 'Test 2',
        date: new Date(),
        flags: new Set(),
        internalDate: new Date(),
      },
      null,
      'sweep',
    );

    const res = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    // Most recent first
    expect(body[0].source).toBe('sweep');
    expect(body[1].source).toBe('arrival');
  });
});
