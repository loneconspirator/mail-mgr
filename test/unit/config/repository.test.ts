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
