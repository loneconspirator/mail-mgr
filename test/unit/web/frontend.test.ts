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

function makeDeps(config: Config): ServerDeps {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
  const configRepo = new ConfigRepository(configPath);
  return {
    configRepo,
    activityLog,
    staticRoot: path.join(process.cwd(), 'dist', 'public'),
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
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-fe-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Happy Calf Tests: Frontend SPA Serving ---

describe('Frontend SPA serving', () => {
  it('serves index.html at root with correct content', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mail Manager');
    expect(res.body).toContain('<script src="/app.js">');
    expect(res.body).toContain('<link rel="stylesheet" href="/styles.css">');
  });

  it('serves bundled app.js', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/app.js' });

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('serves styles.css', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/styles.css' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('font-family');
  });

  it('falls back to index.html for unknown non-API routes (SPA routing)', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/some/deep/route' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mail Manager');
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('API routes still work alongside static file serving', async () => {
    const config = makeConfig([{
      id: 'r1', name: 'Test', match: { sender: '*@test.com' },
      action: { type: 'move', folder: 'Test' }, enabled: true, order: 0,
    }]);
    const app = buildServer(makeDeps(config));

    const rulesRes = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(rulesRes.statusCode).toBe(200);
    expect(rulesRes.json()).toHaveLength(1);

    const statusRes = await app.inject({ method: 'GET', url: '/api/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().connectionStatus).toBe('connected');

    const activityRes = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(activityRes.statusCode).toBe(200);

    const imapRes = await app.inject({ method: 'GET', url: '/api/config/imap' });
    expect(imapRes.statusCode).toBe(200);
    expect(imapRes.json().host).toBe('imap.test.com');
  });
});
