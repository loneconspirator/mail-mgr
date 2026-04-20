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
import { isSenderOnly, isValidDispositionType } from '../../../src/web/routes/dispositions.js';

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

function writeConfig(config: Config): void {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
}

function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  const configRepo = new ConfigRepository(configPath);

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-disp-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- isSenderOnly predicate ---

describe('isSenderOnly', () => {
  it('returns true for rule with only sender in match', () => {
    const rule = makeRule({ match: { sender: '*@test.com' } });
    expect(isSenderOnly(rule)).toBe(true);
  });

  it('returns false when recipient also set', () => {
    const rule = makeRule({ match: { sender: '*@test.com', recipient: 'me@x.com' } });
    expect(isSenderOnly(rule)).toBe(false);
  });

  it('returns false when subject also set', () => {
    const rule = makeRule({ match: { sender: '*@test.com', subject: 'hello' } });
    expect(isSenderOnly(rule)).toBe(false);
  });

  it('returns false when sender is undefined', () => {
    const rule = makeRule({ match: { subject: 'hello' } });
    expect(isSenderOnly(rule)).toBe(false);
  });
});

// --- isValidDispositionType ---

describe('isValidDispositionType', () => {
  it('returns true for skip', () => {
    expect(isValidDispositionType('skip')).toBe(true);
  });

  it('returns true for delete', () => {
    expect(isValidDispositionType('delete')).toBe(true);
  });

  it('returns true for review', () => {
    expect(isValidDispositionType('review')).toBe(true);
  });

  it('returns true for move', () => {
    expect(isValidDispositionType('move')).toBe(true);
  });

  it('returns false for invalid', () => {
    expect(isValidDispositionType('invalid')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidDispositionType('')).toBe(false);
  });
});

// --- GET /api/dispositions route ---

describe('GET /api/dispositions', () => {
  function makeTestConfig(): Config {
    return makeConfig([
      // Rule 1: sender-only skip
      makeRule({ id: 'r1', name: 'Skip A', match: { sender: 'a@test.com' }, action: { type: 'skip' }, order: 0 }),
      // Rule 2: sender-only delete
      makeRule({ id: 'r2', name: 'Delete B', match: { sender: 'b@test.com' }, action: { type: 'delete' }, order: 1 }),
      // Rule 3: sender-only move
      makeRule({ id: 'r3', name: 'Move C', match: { sender: 'c@test.com' }, action: { type: 'move', folder: 'Archive' }, order: 2 }),
      // Rule 4: sender-only review
      makeRule({ id: 'r4', name: 'Review D', match: { sender: 'd@test.com' }, action: { type: 'review' }, order: 3 }),
      // Rule 5: multi-criteria (sender + subject) -- should be excluded
      makeRule({ id: 'r5', name: 'Multi E', match: { sender: 'e@test.com', subject: 'promo' }, action: { type: 'delete' }, order: 4 }),
      // Rule 6: no sender -- should be excluded
      makeRule({ id: 'r6', name: 'No Sender', match: { subject: 'alert' }, action: { type: 'skip' }, order: 5 }),
      // Rule 7: disabled sender-only -- should be included
      makeRule({ id: 'r7', name: 'Disabled F', match: { sender: 'f@test.com' }, action: { type: 'skip' }, enabled: false, order: 6 }),
    ]);
  }

  it('returns 200 with array of only sender-only rules when no type param', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // r1, r2, r3, r4, r7 are sender-only (r5 has subject, r6 has no sender)
    expect(body).toHaveLength(5);
    const ids = body.map((r: any) => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).toContain('r3');
    expect(ids).toContain('r4');
    expect(ids).toContain('r7');
    expect(ids).not.toContain('r5');
    expect(ids).not.toContain('r6');
  });

  it('returns 200 with filtered rules when ?type=skip', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=skip' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // r1 (skip, enabled) and r7 (skip, disabled)
    expect(body).toHaveLength(2);
    expect(body.every((r: any) => r.action.type === 'skip')).toBe(true);
  });

  it('returns 200 with filtered rules when ?type=delete', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=delete' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('r2');
  });

  it('returns 200 with filtered rules when ?type=review', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=review' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('r4');
  });

  it('returns 200 with filtered rules when ?type=move', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=move' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('r3');
  });

  it('returns 400 with error message when ?type=invalid', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=invalid' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Invalid disposition type');
    expect(body.valid).toEqual(['skip', 'delete', 'review', 'move']);
  });

  it('returns empty array when no sender-only rules exist', async () => {
    const config = makeConfig([
      makeRule({ id: 'r1', match: { sender: 'a@test.com', subject: 'x' }, action: { type: 'skip' }, order: 0 }),
      makeRule({ id: 'r2', match: { subject: 'alert' }, action: { type: 'skip' }, order: 1 }),
    ]);
    const app = buildServer(makeDeps(config));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('excludes multi-criteria rules from all responses', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions?type=delete' });
    const body = res.json();
    // r5 is sender+subject delete, should NOT appear
    const ids = body.map((r: any) => r.id);
    expect(ids).not.toContain('r5');
  });

  it('includes disabled sender-only rules in results', async () => {
    const app = buildServer(makeDeps(makeTestConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/dispositions' });
    const body = res.json();
    const ids = body.map((r: any) => r.id);
    expect(ids).toContain('r7');
  });
});
