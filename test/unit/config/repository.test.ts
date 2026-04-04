import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { ConfigRepository } from '../../../src/config/repository.js';
import type { Config } from '../../../src/config/index.js';

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-repo-test-'));
  configPath = path.join(tmpDir, 'config.yml');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAndLoad(config: Config): ConfigRepository {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
  return new ConfigRepository(configPath);
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

describe('ConfigRepository - read accessors', () => {
  it('exposes rules sorted by order', () => {
    const repo = writeAndLoad(makeConfig([
      { id: 'b', name: 'B', match: { sender: '*' }, action: { type: 'move', folder: 'X' }, enabled: true, order: 2 },
      { id: 'a', name: 'A', match: { sender: '*' }, action: { type: 'move', folder: 'X' }, enabled: true, order: 1 },
    ]));
    const rules = repo.getRules();
    expect(rules[0].id).toBe('a');
    expect(rules[1].id).toBe('b');
  });

  it('exposes imap config', () => {
    const repo = writeAndLoad(makeConfig());
    expect(repo.getImapConfig().host).toBe('imap.test.com');
  });

  it('exposes full config', () => {
    const repo = writeAndLoad(makeConfig());
    expect(repo.getConfig().server.port).toBe(3000);
  });
});

describe('ConfigRepository - rule mutations', () => {
  it('addRule validates, persists, and returns the new rule', () => {
    const repo = writeAndLoad(makeConfig());
    const rule = repo.addRule({
      name: 'New',
      match: { sender: '*@foo.com' },
      action: { type: 'move', folder: 'Foo' },
      enabled: true,
      order: 0,
    });
    expect(rule.id).toBeTruthy();
    expect(repo.getRules()).toHaveLength(1);

    // Verify persisted to disk
    const repo2 = new ConfigRepository(configPath);
    expect(repo2.getRules()).toHaveLength(1);
  });

  it('addRule rejects invalid input', () => {
    const repo = writeAndLoad(makeConfig());
    expect(() => repo.addRule({ name: '', match: {}, action: { type: 'move', folder: '' }, enabled: true, order: 0 } as any))
      .toThrow();
  });

  it('updateRule replaces the rule and persists', () => {
    const repo = writeAndLoad(makeConfig([makeRule({ id: 'r1' })]));
    const updated = repo.updateRule('r1', {
      name: 'Updated',
      match: { sender: '*@updated.com' },
      action: { type: 'move', folder: 'Updated' },
      enabled: false,
      order: 5,
    });
    expect(updated.name).toBe('Updated');
    expect(repo.getRules()[0].name).toBe('Updated');
  });

  it('updateRule returns null for non-existent rule', () => {
    const repo = writeAndLoad(makeConfig());
    const result = repo.updateRule('nope', makeRule());
    expect(result).toBeNull();
  });

  it('deleteRule removes and persists', () => {
    const repo = writeAndLoad(makeConfig([makeRule({ id: 'r1' })]));
    const ok = repo.deleteRule('r1');
    expect(ok).toBe(true);
    expect(repo.getRules()).toHaveLength(0);
  });

  it('deleteRule returns false for non-existent rule', () => {
    const repo = writeAndLoad(makeConfig());
    expect(repo.deleteRule('nope')).toBe(false);
  });

  it('reorderRules applies new order values and persists', () => {
    const repo = writeAndLoad(makeConfig([
      makeRule({ id: 'a', order: 1 }),
      makeRule({ id: 'b', order: 2 }),
    ]));
    const rules = repo.reorderRules([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ]);
    expect(rules[0].id).toBe('b');
    expect(rules[1].id).toBe('a');
  });
});
