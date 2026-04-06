import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { ConfigRepository } from '../../../src/config/repository.js';
import type { Config, ReviewConfig } from '../../../src/config/index.js';

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

describe('ConfigRepository - IMAP config', () => {
  it('updateImapConfig validates, persists, and returns new config', async () => {
    const repo = writeAndLoad(makeConfig());
    const updated = await repo.updateImapConfig({
      host: 'new.host.com',
      port: 993,
      tls: true,
      auth: { user: 'new@test.com', pass: 'newpass' },
      idleTimeout: 300000,
      pollInterval: 60000,
    });
    expect(updated.host).toBe('new.host.com');
    expect(repo.getImapConfig().host).toBe('new.host.com');
  });

  it('updateImapConfig rejects invalid input', async () => {
    const repo = writeAndLoad(makeConfig());
    await expect(repo.updateImapConfig({ host: '' } as any)).rejects.toThrow();
  });
});

describe('ConfigRepository - onChange listener', () => {
  it('calls rules listener when rules change', () => {
    const repo = writeAndLoad(makeConfig());
    const calls: Config['rules'][] = [];
    repo.onRulesChange((rules) => calls.push(rules));

    repo.addRule({
      name: 'New',
      match: { sender: '*@foo.com' },
      action: { type: 'move', folder: 'Foo' },
      enabled: true,
      order: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
  });

  it('calls imap listener when imap config changes', async () => {
    const repo = writeAndLoad(makeConfig());
    const calls: Config[] = [];
    repo.onImapConfigChange((config) => { calls.push(config); return Promise.resolve(); });

    await repo.updateImapConfig({
      host: 'new.host.com',
      port: 993,
      tls: true,
      auth: { user: 'u', pass: 'p' },
      idleTimeout: 300000,
      pollInterval: 60000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].imap.host).toBe('new.host.com');
  });
});

describe('ConfigRepository - review config', () => {
  it('getReviewConfig returns defaults when no review section in config', () => {
    const repo = writeAndLoad(makeConfig());
    const review = repo.getReviewConfig();
    expect(review.folder).toBe('Review');
    expect(review.defaultArchiveFolder).toBe('MailingLists');
    expect(review.trashFolder).toBe('Trash');
    expect(review.sweep.intervalHours).toBe(6);
  });

  it('updateReviewConfig merges partial input and persists', async () => {
    const repo = writeAndLoad(makeConfig());
    const updated = await repo.updateReviewConfig({ folder: 'CustomReview' });
    expect(updated.folder).toBe('CustomReview');
    expect(updated.defaultArchiveFolder).toBe('MailingLists');
    expect(updated.trashFolder).toBe('Trash');
    expect(updated.sweep.intervalHours).toBe(6);

    // Verify in-memory state
    expect(repo.getReviewConfig().folder).toBe('CustomReview');

    // Verify persistence by loading from disk
    const repo2 = new ConfigRepository(configPath);
    expect(repo2.getReviewConfig().folder).toBe('CustomReview');
  });

  it('updateReviewConfig rejects invalid input', async () => {
    const repo = writeAndLoad(makeConfig());
    await expect(repo.updateReviewConfig({ folder: '' } as any)).rejects.toThrow();
  });

  it('onReviewConfigChange listener is notified on update', async () => {
    const repo = writeAndLoad(makeConfig());
    const calls: ReviewConfig[] = [];
    repo.onReviewConfigChange((config) => { calls.push(config); return Promise.resolve(); });

    await repo.updateReviewConfig({ folder: 'Notified' });

    expect(calls).toHaveLength(1);
    expect(calls[0].folder).toBe('Notified');
  });

  it('updateReviewConfig merges sweep sub-object', async () => {
    const repo = writeAndLoad(makeConfig());
    const updated = await repo.updateReviewConfig({
      sweep: { intervalHours: 12, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
    });
    expect(updated.sweep.intervalHours).toBe(12);
    expect(updated.sweep.readMaxAgeDays).toBe(7);
    expect(updated.sweep.unreadMaxAgeDays).toBe(14);
  });
});
