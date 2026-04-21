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

let tmpDir: string;
let configPath: string;
let activityLog: ActivityLog;

function writeConfig(config: Config): void {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
}

function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  const configRepo = new ConfigRepository(configPath);

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
    } as any),
    getSweeper: () => undefined,
    getFolderCache: () => ({
      hasFolder: () => true,
      getTree: async () => [],
      getResponse: () => ({ folders: [], cachedAt: new Date().toISOString(), stale: false }),
    } as any),
    getBatchEngine: () => ({
      getState: () => ({ status: 'idle' }),
    } as any),
    getMoveTracker: () => undefined,
    getProposalStore: () => ({ listActive: async () => [] } as any),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-af-config-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Action Folder Config ---

describe('GET /api/config/action-folders', () => {
  it('returns 200 with action folder config object', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/config/action-folders' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('prefix');
    expect(body).toHaveProperty('pollInterval');
    expect(body).toHaveProperty('folders');
  });
});

describe('PUT /api/config/action-folders', () => {
  it('updates prefix and returns updated config', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/action-folders',
      payload: { prefix: 'MyActions' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prefix).toBe('MyActions');
  });

  it('updates enabled=false and returns updated config', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/action-folders',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  it('updates pollInterval=30 and returns updated config', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/action-folders',
      payload: { pollInterval: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pollInterval).toBe(30);
  });

  it('returns 400 for empty prefix', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/action-folders',
      payload: { prefix: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for negative pollInterval', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/action-folders',
      payload: { pollInterval: -5 },
    });
    expect(res.statusCode).toBe(400);
  });
});
