# ConfigRepository Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the scattered load-modify-save pattern in route handlers with a single `ConfigRepository` class that serializes all config mutations, eliminating the race condition and removing boilerplate from routes.

**Architecture:** A `ConfigRepository` class holds the in-memory `Config` as source of truth. It exposes mutation methods that validate, persist to disk (via the existing `saveConfig`), and notify listeners (the Monitor). Route handlers become thin wrappers that call repository methods. The existing `loadConfig`/`saveConfig` functions remain as low-level utilities; the repository is the only caller of `saveConfig` at runtime.

**Tech Stack:** TypeScript, Zod (existing schema validation), Vitest

---

### Task 1: Create the ConfigRepository class with read-only accessors

**Files:**
- Create: `src/config/repository.ts`
- Modify: `src/config/index.ts`
- Test: `test/unit/config/repository.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/config/repository.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: FAIL — cannot resolve `../../../src/config/repository.js`

**Step 3: Write minimal implementation**

```typescript
// src/config/repository.ts
import { loadConfig, saveConfig } from './loader.js';
import type { Config, Rule, ImapConfig } from './schema.js';

export class ConfigRepository {
  private config: Config;
  private readonly configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = loadConfig(configPath);
  }

  getConfig(): Config {
    return this.config;
  }

  getRules(): Rule[] {
    return [...this.config.rules].sort((a, b) => a.order - b.order);
  }

  getImapConfig(): ImapConfig {
    return this.config.imap;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/repository.ts test/unit/config/repository.test.ts
git commit -m "feat: add ConfigRepository with read-only accessors"
```

---

### Task 2: Add rule mutation methods (addRule, updateRule, deleteRule, reorderRules)

**Files:**
- Modify: `src/config/repository.ts`
- Modify: `test/unit/config/repository.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/config/repository.test.ts`:

```typescript
import { ruleSchema } from '../../../src/config/index.js';

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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: FAIL — `repo.addRule is not a function`

**Step 3: Write minimal implementation**

Add to `src/config/repository.ts`:

```typescript
import crypto from 'node:crypto';
import { ruleSchema } from './schema.js';
// ... (add to existing imports)

// Add these methods to the ConfigRepository class:

  addRule(input: Omit<Rule, 'id'>): Rule {
    const newRule = { ...input, id: crypto.randomUUID() };
    const result = ruleSchema.safeParse(newRule);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.rules.push(result.data);
    this.persist();
    return result.data;
  }

  updateRule(id: string, input: Omit<Rule, 'id'>): Rule | null {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const updated = { ...input, id };
    const result = ruleSchema.safeParse(updated);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.rules[idx] = result.data;
    this.persist();
    return result.data;
  }

  deleteRule(id: string): boolean {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.config.rules.splice(idx, 1);
    this.persist();
    return true;
  }

  reorderRules(pairs: Array<{ id: string; order: number }>): Rule[] {
    for (const pair of pairs) {
      const rule = this.config.rules.find((r) => r.id === pair.id);
      if (rule) rule.order = pair.order;
    }
    this.persist();
    return this.getRules();
  }

  private persist(): void {
    saveConfig(this.configPath, this.config);
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/repository.ts test/unit/config/repository.test.ts
git commit -m "feat: add rule mutation methods to ConfigRepository"
```

---

### Task 3: Add IMAP config mutation and change listener

**Files:**
- Modify: `src/config/repository.ts`
- Modify: `test/unit/config/repository.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/config/repository.test.ts`:

```typescript
describe('ConfigRepository - IMAP config', () => {
  it('updateImapConfig validates, persists, and returns new config', () => {
    const repo = writeAndLoad(makeConfig());
    const updated = repo.updateImapConfig({
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

  it('updateImapConfig rejects invalid input', () => {
    const repo = writeAndLoad(makeConfig());
    expect(() => repo.updateImapConfig({ host: '' } as any)).toThrow();
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: FAIL — `repo.updateImapConfig is not a function`

**Step 3: Write minimal implementation**

Add to `src/config/repository.ts`:

```typescript
import { imapConfigSchema } from './schema.js';
// ... (add to existing imports)

// Add to the class:

  private rulesListeners: Array<(rules: Rule[]) => void> = [];
  private imapListeners: Array<(config: Config) => Promise<void>> = [];

  onRulesChange(fn: (rules: Rule[]) => void): void {
    this.rulesListeners.push(fn);
  }

  onImapConfigChange(fn: (config: Config) => Promise<void>): void {
    this.imapListeners.push(fn);
  }

  async updateImapConfig(input: ImapConfig): Promise<ImapConfig> {
    const result = imapConfigSchema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.imap = result.data;
    this.persist();
    for (const fn of this.imapListeners) {
      await fn(this.config);
    }
    return result.data;
  }
```

Also update `addRule`, `updateRule`, `deleteRule`, `reorderRules` to call the rules listener after `persist()`:

```typescript
  private notifyRulesChange(): void {
    for (const fn of this.rulesListeners) {
      fn(this.getRules());
    }
  }
```

Add `this.notifyRulesChange()` after each `this.persist()` call in the four rule methods.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/config/repository.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/repository.ts test/unit/config/repository.test.ts
git commit -m "feat: add IMAP config mutation and change listeners to ConfigRepository"
```

---

### Task 4: Export ConfigRepository from config barrel

**Files:**
- Modify: `src/config/index.ts`

**Step 1: Add the export**

Add to `src/config/index.ts`:

```typescript
export { ConfigRepository } from './repository.js';
```

**Step 2: Run all config tests to verify nothing broke**

Run: `npx vitest run test/unit/config/`
Expected: PASS

**Step 3: Commit**

```bash
git add src/config/index.ts
git commit -m "chore: export ConfigRepository from config barrel"
```

---

### Task 5: Wire ConfigRepository into ServerDeps and route handlers

**Files:**
- Modify: `src/web/server.ts:13-22` (replace `configPath` + `monitor` + `onImapConfigChange` with `configRepo`)
- Modify: `src/web/routes/rules.ts` (use `configRepo` instead of `loadConfig`/`saveConfig`)
- Modify: `src/web/routes/imap-config.ts` (use `configRepo` instead of `loadConfig`/`saveConfig`)
- Modify: `src/web/routes/status.ts` (minor — get monitor from deps still)
- Test: `test/unit/web/api.test.ts`

**Step 1: Update the ServerDeps interface**

Replace `ServerDeps` in `src/web/server.ts`:

```typescript
import type { ConfigRepository } from '../config/index.js';

export interface ServerDeps {
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  monitor: Monitor;
  /** Override static files root for testing (defaults to dist/public) */
  staticRoot?: string;
}
```

Remove the `config`, `configPath`, and `onImapConfigChange` fields. The `ConfigRepository` handles all three responsibilities.

**Step 2: Rewrite rules.ts route handlers**

Replace `src/web/routes/rules.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/rules', async () => {
    return deps.configRepo.getRules();
  });

  app.post('/api/rules', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const rule = deps.configRepo.addRule(body as any);
      return reply.status(201).send(rule);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });

  app.put<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    try {
      const rule = deps.configRepo.updateRule(id, body as any);
      if (!rule) return reply.status(404).send({ error: 'Rule not found' });
      return rule;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = deps.configRepo.deleteRule(id);
    if (!ok) return reply.status(404).send({ error: 'Rule not found' });
    return reply.status(204).send();
  });

  app.put<{ Body: Array<{ id: string; order: number }> }>('/api/rules/reorder', async (request, reply) => {
    const pairs = request.body as Array<{ id: string; order: number }>;
    if (!Array.isArray(pairs)) {
      return reply.status(400).send({ error: 'Expected array of {id, order} pairs' });
    }
    return deps.configRepo.reorderRules(pairs);
  });
}
```

**Step 3: Rewrite imap-config.ts route handlers**

Replace `src/web/routes/imap-config.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

const PASSWORD_MASK = '****';

function maskImapConfig(imap: { host: string; port: number; tls: boolean; auth: { user: string; pass: string }; idleTimeout: number; pollInterval: number }) {
  return { ...imap, auth: { user: imap.auth.user, pass: PASSWORD_MASK } };
}

export function registerImapConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/imap', async () => {
    return maskImapConfig(deps.configRepo.getImapConfig());
  });

  app.put('/api/config/imap', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const currentImap = deps.configRepo.getImapConfig();

    const authBody = body.auth as { user?: string; pass?: string } | undefined;
    const newImap = {
      ...body,
      auth: {
        user: authBody?.user ?? currentImap.auth.user,
        pass: authBody?.pass === PASSWORD_MASK
          ? currentImap.auth.pass
          : (authBody?.pass ?? currentImap.auth.pass),
      },
    };

    try {
      const updated = await deps.configRepo.updateImapConfig(newImap as any);
      return maskImapConfig(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });
}
```

**Step 4: Update the test helpers in api.test.ts**

Replace the `makeDeps` function in `test/unit/web/api.test.ts` to construct a real `ConfigRepository` instead of passing `configPath` and a mock monitor:

```typescript
import { ConfigRepository } from '../../../src/config/repository.js';

function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  updatedRules = null;
  const configRepo = new ConfigRepository(configPath);
  configRepo.onRulesChange((rules) => { updatedRules = rules; });

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
```

Update the IMAP config test that checks `onImapConfigChange`:

```typescript
describe('PUT /api/config/imap', () => {
  it('updates IMAP config preserving masked password', async () => {
    let configChanged = false;
    const deps = makeDeps(makeConfig());
    deps.configRepo.onImapConfigChange(async () => { configChanged = true; });
    const app = buildServer(deps);
    // ... rest of test stays the same
  });
```

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add src/web/server.ts src/web/routes/rules.ts src/web/routes/imap-config.ts test/unit/web/api.test.ts
git commit -m "refactor: route handlers use ConfigRepository instead of raw load/save"
```

---

### Task 6: Wire ConfigRepository into the application bootstrap

**Files:**
- Modify: `src/index.ts`

**Step 1: Update index.ts to use ConfigRepository**

Replace the config loading and server wiring in `src/index.ts`:

```typescript
import { ensureConfig, getConfigPath, ConfigRepository } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
import { ImapClient } from './imap/index.js';
import type { ImapFlowLike, ImapConfig } from './imap/index.js';
import { ImapFlow } from 'imapflow';
import pino from 'pino';

const logger = pino({ name: 'mail-mgr' });

function createImapFlow(config: ImapConfig): ImapFlowLike {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: config.auth,
    logger: false,
  }) as unknown as ImapFlowLike;
}

async function main(): Promise<void> {
  const configPath = getConfigPath();
  ensureConfig(configPath);

  const configRepo = new ConfigRepository(configPath);
  const config = configRepo.getConfig();

  const activityLog = ActivityLog.fromDataPath();
  activityLog.startAutoPrune();

  const imapClient = new ImapClient(config.imap, createImapFlow);
  let monitor = new Monitor(config, { imapClient, activityLog, logger });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
  });

  configRepo.onImapConfigChange(async (newConfig) => {
    await monitor.stop();
    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    monitor = new Monitor(newConfig, { imapClient: newClient, activityLog, logger });
    await monitor.start();
  });

  const app = buildServer({
    configRepo,
    activityLog,
    monitor,
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info('mail-mgr listening on %s:%d', config.server.host, config.server.port);

  await monitor.start();
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
```

**Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor: bootstrap uses ConfigRepository for centralized config management"
```

---

### Task 7: Remove unused loadConfig/saveConfig imports from route files and clean up

**Files:**
- Verify: `src/web/routes/rules.ts` no longer imports from `../../config/index.js`
- Verify: `src/web/routes/imap-config.ts` no longer imports from `../../config/index.js`

**Step 1: Search for stale imports**

Run: `grep -rn 'loadConfig\|saveConfig' src/web/`
Expected: no matches (all config access goes through `configRepo` now)

**Step 2: Run the full test suite one final time**

Run: `npx vitest run`
Expected: PASS

**Step 3: Commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: remove stale config imports from route handlers"
```
