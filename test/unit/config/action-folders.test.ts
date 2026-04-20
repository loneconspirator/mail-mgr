import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import {
  actionFolderConfigSchema,
  configSchema,
} from '../../../src/config/index.js';
import { ConfigRepository } from '../../../src/config/repository.js';
import type { Config } from '../../../src/config/index.js';

describe('actionFolderConfigSchema', () => {
  it('returns all defaults when given empty input', () => {
    const result = actionFolderConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.prefix).toBe('Actions');
      expect(result.data.pollInterval).toBe(15);
      expect(result.data.folders.vip).toBe('\u2B50 VIP Sender');
      expect(result.data.folders.block).toBe('\uD83D\uDEAB Block Sender');
      expect(result.data.folders.undoVip).toBe('\u21A9\uFE0F Undo VIP');
      expect(result.data.folders.unblock).toBe('\u2705 Unblock Sender');
    }
  });

  it('parses with enabled=false', () => {
    const result = actionFolderConfigSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it('parses with custom prefix, other fields default', () => {
    const result = actionFolderConfigSchema.safeParse({ prefix: 'MyActions' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prefix).toBe('MyActions');
      expect(result.data.enabled).toBe(true);
      expect(result.data.pollInterval).toBe(15);
    }
  });

  it('parses with custom folder name override, others default', () => {
    const result = actionFolderConfigSchema.safeParse({ folders: { vip: 'VIP' } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.folders.vip).toBe('VIP');
      expect(result.data.folders.block).toBe('\uD83D\uDEAB Block Sender');
      expect(result.data.folders.undoVip).toBe('\u21A9\uFE0F Undo VIP');
      expect(result.data.folders.unblock).toBe('\u2705 Unblock Sender');
    }
  });

  it('rejects empty string prefix', () => {
    const result = actionFolderConfigSchema.safeParse({ prefix: '' });
    expect(result.success).toBe(false);
  });

  it('rejects pollInterval=0', () => {
    const result = actionFolderConfigSchema.safeParse({ pollInterval: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects pollInterval=-1', () => {
    const result = actionFolderConfigSchema.safeParse({ pollInterval: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer pollInterval', () => {
    const result = actionFolderConfigSchema.safeParse({ pollInterval: 15.5 });
    expect(result.success).toBe(false);
  });
});

describe('configSchema with actionFolders', () => {
  const minimalConfig = {
    imap: { host: 'imap.test.com', auth: { user: 'u', pass: 'p' } },
    server: {},
  };

  it('parses full config with actionFolders section present', () => {
    const result = configSchema.safeParse({
      ...minimalConfig,
      actionFolders: {
        enabled: true,
        prefix: 'Actions',
        pollInterval: 15,
        folders: {
          vip: '\u2B50 VIP Sender',
          block: '\uD83D\uDEAB Block Sender',
          undoVip: '\u21A9\uFE0F Undo VIP',
          unblock: '\u2705 Unblock Sender',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actionFolders.enabled).toBe(true);
      expect(result.data.actionFolders.prefix).toBe('Actions');
    }
  });

  it('parses config without actionFolders section (backward compat)', () => {
    const result = configSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actionFolders).toBeDefined();
      expect(result.data.actionFolders.enabled).toBe(true);
      expect(result.data.actionFolders.prefix).toBe('Actions');
      expect(result.data.actionFolders.pollInterval).toBe(15);
      expect(result.data.actionFolders.folders.vip).toBe('\u2B50 VIP Sender');
      expect(result.data.actionFolders.folders.block).toBe('\uD83D\uDEAB Block Sender');
      expect(result.data.actionFolders.folders.undoVip).toBe('\u21A9\uFE0F Undo VIP');
      expect(result.data.actionFolders.folders.unblock).toBe('\u2705 Unblock Sender');
    }
  });
});

// --- ConfigRepository action folder methods ---

describe('ConfigRepository action folder methods', () => {
  let tmpDir: string;
  let configPath: string;

  function makeMinimalConfig(): Config {
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
      rules: [],
      review: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
        moveTracking: { enabled: true, scanInterval: 30 },
      },
      actionFolders: {
        enabled: true,
        prefix: 'Actions',
        pollInterval: 15,
        folders: {
          vip: '\u2B50 VIP Sender',
          block: '\uD83D\uDEAB Block Sender',
          undoVip: '\u21A9\uFE0F Undo VIP',
          unblock: '\u2705 Unblock Sender',
        },
      },
    } as Config;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-af-test-'));
    configPath = path.join(tmpDir, 'config.yml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAndLoad(config: Config): ConfigRepository {
    fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
    return new ConfigRepository(configPath);
  }

  it('getActionFolderConfig() returns defaults when config has no actionFolders section', () => {
    // Write a config without actionFolders — Zod defaults fill in
    const config = makeMinimalConfig();
    const repo = writeAndLoad(config);
    const af = repo.getActionFolderConfig();
    expect(af.enabled).toBe(true);
    expect(af.prefix).toBe('Actions');
    expect(af.pollInterval).toBe(15);
    expect(af.folders.vip).toBe('\u2B50 VIP Sender');
  });

  it('updateActionFolderConfig({ enabled: false }) persists and returns config with enabled=false', async () => {
    const repo = writeAndLoad(makeMinimalConfig());
    const result = await repo.updateActionFolderConfig({ enabled: false });
    expect(result.enabled).toBe(false);
    // Verify persisted
    const repo2 = new ConfigRepository(configPath);
    expect(repo2.getActionFolderConfig().enabled).toBe(false);
  });

  it('updateActionFolderConfig({ prefix: "" }) throws validation error', async () => {
    const repo = writeAndLoad(makeMinimalConfig());
    await expect(repo.updateActionFolderConfig({ prefix: '' })).rejects.toThrow('Validation failed');
  });

  it('onActionFolderConfigChange callback is invoked on update', async () => {
    const repo = writeAndLoad(makeMinimalConfig());
    let callbackResult: unknown = null;
    repo.onActionFolderConfigChange(async (config) => {
      callbackResult = config;
    });
    await repo.updateActionFolderConfig({ pollInterval: 30 });
    expect(callbackResult).not.toBeNull();
    expect((callbackResult as any).pollInterval).toBe(30);
  });

  it('updateActionFolderConfig({ pollInterval: 30 }) persists new interval, other fields default', async () => {
    const repo = writeAndLoad(makeMinimalConfig());
    const result = await repo.updateActionFolderConfig({ pollInterval: 30 });
    expect(result.pollInterval).toBe(30);
    expect(result.enabled).toBe(true);
    expect(result.prefix).toBe('Actions');
    // Verify persistence
    const repo2 = new ConfigRepository(configPath);
    expect(repo2.getActionFolderConfig().pollInterval).toBe(30);
  });
});
