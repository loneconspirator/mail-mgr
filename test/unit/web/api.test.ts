import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  updatedRules = null;
  const configRepo = new ConfigRepository(configPath);
  configRepo.onRulesChange((rules) => { updatedRules = rules; });

  return {
    configRepo,
    activityLog,
    monitor: {
      getState() {
        return {
          connectionStatus: 'connected',
          lastProcessedAt: new Date('2026-01-01T00:00:00Z'),
          messagesProcessed: 42,
        };
      },
    } as any,
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

// --- Envelope Config ---

describe('GET /api/config/envelope', () => {
  it('returns { envelopeHeader: null } when not configured', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/config/envelope' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ envelopeHeader: null });
  });

  it('returns { envelopeHeader: "Delivered-To" } when configured', async () => {
    const config = makeConfig();
    (config.imap as any).envelopeHeader = 'Delivered-To';
    const app = buildServer(makeDeps(config));
    const res = await app.inject({ method: 'GET', url: '/api/config/envelope' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ envelopeHeader: 'Delivered-To' });
  });
});

describe('POST /api/config/envelope/discover', () => {
  it('returns envelope status shape on error (no IMAP server)', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'POST', url: '/api/config/envelope/discover' });
    // Without a real IMAP server, this should return 500 with error
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBeDefined();
  });
});
