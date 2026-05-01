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
import { basicAuthHook, readAuthCredsOrThrow, HEALTH_PATH } from '../../../src/web/auth.js';

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
let app: ReturnType<typeof buildServer> | undefined;

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
    getProposalStore: () => ({} as any),
  };
}

function basicAuthHeader(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-auth-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
  // Tests in this file manage their own auth env explicitly; clear from any
  // global setup so the "throws when env unset" case is not contaminated.
  delete process.env.WEB_AUTH_USER;
  delete process.env.WEB_AUTH_PASS;
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.WEB_AUTH_USER;
  delete process.env.WEB_AUTH_PASS;
});

// --- HEALTH_PATH constant ---

describe('HEALTH_PATH', () => {
  it('is /healthz', () => {
    expect(HEALTH_PATH).toBe('/healthz');
  });
});

// --- readAuthCredsOrThrow ---

describe('readAuthCredsOrThrow', () => {
  it('throws when WEB_AUTH_USER is missing', () => {
    process.env.WEB_AUTH_PASS = 'secret';
    expect(() => readAuthCredsOrThrow()).toThrow(/WEB_AUTH_USER.*WEB_AUTH_PASS|WEB_AUTH_PASS.*WEB_AUTH_USER/);
  });

  it('throws when WEB_AUTH_PASS is missing', () => {
    process.env.WEB_AUTH_USER = 'admin';
    expect(() => readAuthCredsOrThrow()).toThrow(/WEB_AUTH_USER.*WEB_AUTH_PASS|WEB_AUTH_PASS.*WEB_AUTH_USER/);
  });

  it('throws when both are missing', () => {
    expect(() => readAuthCredsOrThrow()).toThrow(/WEB_AUTH_USER.*WEB_AUTH_PASS|WEB_AUTH_PASS.*WEB_AUTH_USER/);
  });

  it('throws when WEB_AUTH_USER is empty after trim', () => {
    process.env.WEB_AUTH_USER = '   ';
    process.env.WEB_AUTH_PASS = 'secret';
    expect(() => readAuthCredsOrThrow()).toThrow(/WEB_AUTH_USER/);
  });

  it('throws when WEB_AUTH_PASS is empty after trim', () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = '';
    expect(() => readAuthCredsOrThrow()).toThrow(/WEB_AUTH_PASS/);
  });

  it('returns trimmed user and pass when both set', () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    const creds = readAuthCredsOrThrow();
    expect(creds).toEqual({ user: 'admin', pass: 'secret' });
  });
});

// --- basicAuthHook factory (direct unit test, no Fastify) ---

describe('basicAuthHook factory', () => {
  function makeStubReply() {
    const headers: Record<string, string> = {};
    let statusCode: number | undefined;
    let payload: any;
    let sent = false;
    const reply: any = {
      header(name: string, value: string) {
        headers[name] = value;
        return reply;
      },
      code(c: number) {
        statusCode = c;
        return reply;
      },
      send(p: any) {
        payload = p;
        sent = true;
        return reply;
      },
    };
    return {
      reply,
      get headers() { return headers; },
      get statusCode() { return statusCode; },
      get payload() { return payload; },
      get sent() { return sent; },
    };
  }

  function makeReq(url: string, authorization?: string) {
    return {
      url,
      headers: authorization ? { authorization } : {},
    } as any;
  }

  it('skips auth for HEALTH_PATH', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/healthz'), stub.reply);
    expect(stub.sent).toBe(false);
    expect(stub.statusCode).toBeUndefined();
  });

  it('skips auth for HEALTH_PATH with query string', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/healthz?foo=bar'), stub.reply);
    expect(stub.sent).toBe(false);
  });

  it('returns 401 with WWW-Authenticate when authorization header missing', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status'), stub.reply);
    expect(stub.statusCode).toBe(401);
    expect(stub.headers['WWW-Authenticate']).toBe('Basic realm="mail-mgr"');
  });

  it('returns 401 for non-Basic scheme (Bearer foo)', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', 'Bearer foo'), stub.reply);
    expect(stub.statusCode).toBe(401);
  });

  it('returns 401 for malformed base64 (Basic !!!)', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', 'Basic !!!'), stub.reply);
    expect(stub.statusCode).toBe(401);
  });

  it('returns 401 for base64 with no colon', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    const noColon = Buffer.from('justusername').toString('base64');
    await hook(makeReq('/api/status', `Basic ${noColon}`), stub.reply);
    expect(stub.statusCode).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', basicAuthHeader('admin', 'wrong')), stub.reply);
    expect(stub.statusCode).toBe(401);
  });

  it('returns 401 for wrong username', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', basicAuthHeader('eve', 'secret')), stub.reply);
    expect(stub.statusCode).toBe(401);
  });

  it('passes through (no reply sent) for valid credentials', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', basicAuthHeader('admin', 'secret')), stub.reply);
    expect(stub.sent).toBe(false);
    expect(stub.statusCode).toBeUndefined();
  });

  it('handles passwords containing colons (uses first-colon split)', async () => {
    const hook = basicAuthHook('admin', 'pa:ss:word');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', basicAuthHeader('admin', 'pa:ss:word')), stub.reply);
    expect(stub.sent).toBe(false);
  });

  it('returns 401 cleanly when provided password length differs from expected (no throw leak)', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    // 'too-short' is fewer bytes than 'secret'? Actually use radically different lengths.
    await hook(makeReq('/api/status', basicAuthHeader('admin', 'a')), stub.reply);
    expect(stub.statusCode).toBe(401);

    const stub2 = makeStubReply();
    await hook(makeReq('/api/status', basicAuthHeader('admin', 'this-is-much-longer-than-secret')), stub2.reply);
    expect(stub2.statusCode).toBe(401);
  });

  it('accepts case-insensitive Basic scheme prefix', async () => {
    const hook = basicAuthHook('admin', 'secret');
    const stub = makeStubReply();
    await hook(makeReq('/api/status', 'basic ' + Buffer.from('admin:secret').toString('base64')), stub.reply);
    expect(stub.sent).toBe(false);
  });
});

// --- Integration: buildServer with auth (requires Task 2 to wire the hook) ---

describe('buildServer auth integration', () => {
  it('throws synchronously when WEB_AUTH_USER and WEB_AUTH_PASS are unset', () => {
    delete process.env.WEB_AUTH_USER;
    delete process.env.WEB_AUTH_PASS;
    expect(() => buildServer(makeDeps(makeConfig()))).toThrow(/WEB_AUTH_USER.*WEB_AUTH_PASS|WEB_AUTH_PASS.*WEB_AUTH_USER/);
  });

  it('returns 401 with WWW-Authenticate on / without creds', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="mail-mgr"');
  });

  it('returns 401 on /api/status without creds', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 on /api/status with valid creds', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: basicAuthHeader('admin', 'secret') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 on /api/status with wrong password', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: basicAuthHeader('admin', 'wrong') },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 on /healthz without any Authorization header', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 on /healthz?foo=bar without any Authorization header', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/healthz?foo=bar' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 on /healthz with a (valid) Authorization header (hook short-circuits)', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { authorization: basicAuthHeader('admin', 'secret') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('protects /api/dispositions: 401 without creds, 200 with valid creds', async () => {
    process.env.WEB_AUTH_USER = 'admin';
    process.env.WEB_AUTH_PASS = 'secret';
    app = buildServer(makeDeps(makeConfig()));

    const unauthed = await app.inject({ method: 'GET', url: '/api/dispositions' });
    expect(unauthed.statusCode).toBe(401);

    const authed = await app.inject({
      method: 'GET',
      url: '/api/dispositions',
      headers: { authorization: basicAuthHeader('admin', 'secret') },
    });
    expect(authed.statusCode).toBe(200);
  });
});
