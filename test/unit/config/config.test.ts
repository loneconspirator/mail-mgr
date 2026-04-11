import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig, ensureConfig, substituteEnvVars } from '../../../src/config/index.js';
import {
  configSchema,
  actionSchema,
  ruleSchema,
  reviewActionSchema,
  skipActionSchema,
  deleteActionSchema,
  sweepConfigSchema,
  reviewConfigSchema,
} from '../../../src/config/index.js';

const FIXTURES_DIR = path.join(os.tmpdir(), `mail-mgr-test-${process.pid}`);
const CONFIG_PATH = path.join(FIXTURES_DIR, 'config.yml');

const VALID_YAML = `
imap:
  host: imap.example.com
  port: 993
  tls: true
  auth:
    user: mike@example.com
    pass: secret123
  idleTimeout: 300000
  pollInterval: 60000

server:
  port: 3000
  host: 0.0.0.0

rules:
  - id: "github-oss"
    name: "GitHub OSS notifications"
    match:
      sender: "*@github.com"
      recipient: "mike+oss@example.com"
    action:
      type: move
      folder: "Dev/OSS"
    enabled: true
    order: 1
`;

const ENV_VAR_YAML = `
imap:
  host: imap.example.com
  port: 993
  tls: true
  auth:
    user: mike@example.com
    pass: \${TEST_IMAP_PASSWORD}
  idleTimeout: 300000
  pollInterval: 60000

server:
  port: 3000
  host: 0.0.0.0

rules: []
`;

function writeFixture(content: string): void {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, content, 'utf-8');
}

beforeEach(() => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads a valid config and returns typed result', () => {
    writeFixture(VALID_YAML);
    const config = loadConfig(CONFIG_PATH);

    expect(config.imap.host).toBe('imap.example.com');
    expect(config.imap.port).toBe(993);
    expect(config.imap.tls).toBe(true);
    expect(config.imap.auth.user).toBe('mike@example.com');
    expect(config.imap.auth.pass).toBe('secret123');
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe('github-oss');
    expect(config.rules[0].match.sender).toBe('*@github.com');
    expect(config.rules[0].action.type).toBe('move');
    expect(config.rules[0].action.folder).toBe('Dev/OSS');
  });

  it('applies default values for optional fields', () => {
    const minimal = `
imap:
  host: imap.test.com
  auth:
    user: test@test.com
    pass: pw
server: {}
`;
    writeFixture(minimal);
    const config = loadConfig(CONFIG_PATH);

    expect(config.imap.port).toBe(993);
    expect(config.imap.tls).toBe(true);
    expect(config.imap.idleTimeout).toBe(300_000);
    expect(config.imap.pollInterval).toBe(60_000);
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.rules).toEqual([]);
  });

  it('throws on missing required fields', () => {
    const bad = `
imap:
  host: imap.test.com
  auth:
    user: test@test.com
`;
    writeFixture(bad);
    expect(() => loadConfig(CONFIG_PATH)).toThrow(/Invalid config/);
  });

  it('throws on invalid rule (no match fields)', () => {
    const bad = `
imap:
  host: imap.test.com
  auth:
    user: test@test.com
    pass: pw
server: {}
rules:
  - id: bad
    name: Bad rule
    match: {}
    action:
      type: move
      folder: Inbox
    order: 0
`;
    writeFixture(bad);
    expect(() => loadConfig(CONFIG_PATH)).toThrow(/Invalid config/);
  });

  it('throws on invalid action type', () => {
    const bad = `
imap:
  host: imap.test.com
  auth:
    user: test@test.com
    pass: pw
server: {}
rules:
  - id: bad
    name: Bad rule
    match:
      sender: foo@bar.com
    action:
      type: explode
      folder: Inbox
    order: 0
`;
    writeFixture(bad);
    expect(() => loadConfig(CONFIG_PATH)).toThrow(/Invalid config/);
  });

  it('preserves glob patterns as strings (no expansion)', () => {
    writeFixture(VALID_YAML);
    const config = loadConfig(CONFIG_PATH);
    expect(config.rules[0].match.sender).toBe('*@github.com');
    expect(config.rules[0].match.recipient).toBe('mike+oss@example.com');
  });
});

describe('env var substitution', () => {
  it('substitutes ${VAR_NAME} with env var values', () => {
    process.env.TEST_IMAP_PASSWORD = 'supersecret';
    writeFixture(ENV_VAR_YAML);
    const config = loadConfig(CONFIG_PATH);
    expect(config.imap.auth.pass).toBe('supersecret');
    delete process.env.TEST_IMAP_PASSWORD;
  });

  it('throws on missing env var', () => {
    delete process.env.TEST_IMAP_PASSWORD;
    writeFixture(ENV_VAR_YAML);
    expect(() => loadConfig(CONFIG_PATH)).toThrow(/TEST_IMAP_PASSWORD is not set/);
  });

  it('substituteEnvVars handles nested objects and arrays', () => {
    process.env.TEST_A = 'alpha';
    process.env.TEST_B = 'beta';
    const input = {
      top: '${TEST_A}',
      nested: { deep: '${TEST_B}' },
      list: ['${TEST_A}', 'literal'],
      num: 42,
      flag: true,
    };
    const result = substituteEnvVars(input) as any;
    expect(result.top).toBe('alpha');
    expect(result.nested.deep).toBe('beta');
    expect(result.list).toEqual(['alpha', 'literal']);
    expect(result.num).toBe(42);
    expect(result.flag).toBe(true);
    delete process.env.TEST_A;
    delete process.env.TEST_B;
  });
});

describe('saveConfig', () => {
  it('writes valid config as YAML', () => {
    writeFixture(VALID_YAML);
    const config = loadConfig(CONFIG_PATH);
    const savePath = path.join(FIXTURES_DIR, 'saved.yml');
    saveConfig(savePath, config);
    const reloaded = loadConfig(savePath);
    expect(reloaded).toEqual(config);
  });

  it('rejects invalid config on save', () => {
    const bad = { imap: { host: '' } } as any;
    expect(() => saveConfig(CONFIG_PATH, bad)).toThrow(/Cannot save invalid config/);
  });

  it('preserves ${VAR} references on round-trip', () => {
    process.env.TEST_IMAP_PASSWORD = 'supersecret';
    writeFixture(ENV_VAR_YAML);
    const config = loadConfig(CONFIG_PATH);
    saveConfig(CONFIG_PATH, config);

    // Read raw YAML to verify ${VAR} is preserved, not the expanded value
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    expect(raw).toContain('${TEST_IMAP_PASSWORD}');
    expect(raw).not.toContain('supersecret');

    // Re-load still works
    const reloaded = loadConfig(CONFIG_PATH);
    expect(reloaded.imap.auth.pass).toBe('supersecret');
    delete process.env.TEST_IMAP_PASSWORD;
  });

  it('creates parent directories if they do not exist', () => {
    const deepPath = path.join(FIXTURES_DIR, 'a', 'b', 'config.yml');
    writeFixture(VALID_YAML);
    const config = loadConfig(CONFIG_PATH);
    saveConfig(deepPath, config);
    expect(fs.existsSync(deepPath)).toBe(true);
  });
});

describe('ensureConfig', () => {
  it('copies default.yml when config does not exist', () => {
    const targetPath = path.join(FIXTURES_DIR, 'new', 'config.yml');
    expect(fs.existsSync(targetPath)).toBe(false);
    ensureConfig(targetPath);
    expect(fs.existsSync(targetPath)).toBe(true);

    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).toContain('imap.example.com');
    expect(content).toContain('${IMAP_PASSWORD}');
  });

  it('does not overwrite existing config', () => {
    writeFixture('# custom config\n');
    ensureConfig(CONFIG_PATH);
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    expect(content).toBe('# custom config\n');
  });
});

describe('configSchema', () => {
  it('validates a well-formed config object', () => {
    const valid = {
      imap: {
        host: 'imap.test.com',
        port: 993,
        tls: true,
        auth: { user: 'u', pass: 'p' },
        idleTimeout: 300000,
        pollInterval: 60000,
      },
      server: { port: 3000, host: '0.0.0.0' },
      rules: [],
    };
    const result = configSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects rule with no match fields', () => {
    const bad = {
      imap: {
        host: 'h',
        auth: { user: 'u', pass: 'p' },
      },
      server: {},
      rules: [{ id: 'x', name: 'X', match: {}, action: { type: 'move', folder: 'F' }, order: 0 }],
    };
    const result = configSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('action schemas', () => {
  it('accepts review action without folder', () => {
    const result = actionSchema.safeParse({ type: 'review' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('review');
    }
  });

  it('accepts review action with folder', () => {
    const result = actionSchema.safeParse({ type: 'review', folder: 'Archive/Lists' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: 'review', folder: 'Archive/Lists' });
    }
  });

  it('rejects review action with empty folder string', () => {
    const result = reviewActionSchema.safeParse({ type: 'review', folder: '' });
    expect(result.success).toBe(false);
  });

  it('accepts skip action', () => {
    const result = actionSchema.safeParse({ type: 'skip' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('skip');
    }
  });

  it('accepts delete action', () => {
    const result = actionSchema.safeParse({ type: 'delete' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('delete');
    }
  });

  it('still accepts move action (backward compat)', () => {
    const result = actionSchema.safeParse({ type: 'move', folder: 'Dev/OSS' });
    expect(result.success).toBe(true);
  });

  it('still rejects unknown action types', () => {
    const result = actionSchema.safeParse({ type: 'explode' });
    expect(result.success).toBe(false);
  });
});

describe('sweepConfigSchema', () => {
  it('applies defaults when empty object provided', () => {
    const result = sweepConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intervalHours).toBe(6);
      expect(result.data.readMaxAgeDays).toBe(7);
      expect(result.data.unreadMaxAgeDays).toBe(14);
    }
  });

  it('allows partial overrides', () => {
    const result = sweepConfigSchema.safeParse({ intervalHours: 12 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intervalHours).toBe(12);
      expect(result.data.readMaxAgeDays).toBe(7);
    }
  });

  it('rejects non-positive values', () => {
    expect(sweepConfigSchema.safeParse({ intervalHours: 0 }).success).toBe(false);
    expect(sweepConfigSchema.safeParse({ readMaxAgeDays: -1 }).success).toBe(false);
  });
});

describe('reviewConfigSchema', () => {
  it('applies all defaults when empty object provided', () => {
    const result = reviewConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.folder).toBe('Review');
      expect(result.data.defaultArchiveFolder).toBe('MailingLists');
      expect(result.data.trashFolder).toBe('Trash');
      expect(result.data.sweep.intervalHours).toBe(6);
      expect(result.data.sweep.readMaxAgeDays).toBe(7);
      expect(result.data.sweep.unreadMaxAgeDays).toBe(14);
    }
  });

  it('allows partial overrides', () => {
    const result = reviewConfigSchema.safeParse({ folder: 'ToReview', sweep: { intervalHours: 24 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.folder).toBe('ToReview');
      expect(result.data.defaultArchiveFolder).toBe('MailingLists');
      expect(result.data.sweep.intervalHours).toBe(24);
      expect(result.data.sweep.readMaxAgeDays).toBe(7);
    }
  });

  it('rejects empty folder string', () => {
    const result = reviewConfigSchema.safeParse({ folder: '' });
    expect(result.success).toBe(false);
  });
});

describe('configSchema with review section', () => {
  const minimalConfig = {
    imap: { host: 'imap.test.com', auth: { user: 'u', pass: 'p' } },
    server: {},
  };

  it('defaults review config when absent', () => {
    const result = configSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review).toBeDefined();
      expect(result.data.review.folder).toBe('Review');
    }
  });

  it('accepts explicit review config', () => {
    const result = configSchema.safeParse({
      ...minimalConfig,
      review: { folder: 'MyReview' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.folder).toBe('MyReview');
    }
  });

  it('backward compat: existing configs with only move rules still parse', () => {
    const result = configSchema.safeParse({
      ...minimalConfig,
      rules: [
        { id: 'r1', name: 'Rule 1', match: { sender: 'foo@bar.com' }, action: { type: 'move', folder: 'F' }, order: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('ruleSchema optional name', () => {
  const baseRule = {
    id: 'test-1',
    match: { sender: '*@github.com' },
    action: { type: 'move' as const, folder: 'GH' },
    order: 0,
  };

  it('accepts a rule with name omitted', () => {
    const result = ruleSchema.safeParse(baseRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
    }
  });

  it('accepts a rule with name present', () => {
    const result = ruleSchema.safeParse({ ...baseRule, name: 'Test Rule' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Rule');
    }
  });

  it('rejects a rule with no match fields', () => {
    const result = ruleSchema.safeParse({ ...baseRule, match: {} });
    expect(result.success).toBe(false);
  });
});
