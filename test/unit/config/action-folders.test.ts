import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import {
  actionFolderConfigSchema,
  configSchema,
} from '../../../src/config/index.js';
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
