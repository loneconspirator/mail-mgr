/**
 * Integration test for IX-011 — Rule CRUD via web API with hot-reload across
 * processing subsystems.
 *
 * Spec: specs/integrations/ix-011-rule-crud-and-hot-reload.md
 *
 * Real Fastify server + real ConfigRepository writing to a temp YAML file.
 * The hot-reload subscribers (Monitor / ReviewSweeper / BatchEngine) are
 * mocked as plain `vi.fn()` listeners registered through
 * `configRepo.onRulesChange(...)`, since IX-011 is about the config/web/
 * listener fan-out — the subsystems' own internal `updateRules` is covered
 * elsewhere. FolderCache is also mocked so we can drive `hasFolder` for the
 * warning interaction.
 *
 * Named-interaction coverage:
 *   IX-011.1 — POST/PUT/DELETE/reorder/bulk-prefix-delete routes shape.
 *   IX-011.2 — WebServer parses body and dispatches to the correct
 *              ConfigRepository method.
 *   IX-011.3 — Validation failure surfaces as HTTP 400 with details.
 *   IX-011.4 — addRule generates id + nextOrder; updateRule/deleteRule of
 *              unknown id → 404; reorderRules ignores unknown ids.
 *   IX-011.5 — YAML on disk reflects the change synchronously, then listener
 *              fires.
 *   IX-011.6 — onRulesChange subscriber receives the updated rule list.
 *   IX-011.7 — checkFolderWarnings attaches `warnings` only when the cached
 *              folder tree lacks the destination.
 *   IX-011.8 — HTTP status codes per route: 201 / 200 / 200 / 204.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { ConfigRepository } from '../../src/config/repository.js';
import { saveConfig } from '../../src/config/loader.js';
import { loadConfig } from '../../src/config/loader.js';
import { buildServer } from '../../src/web/server.js';
import type { ServerDeps } from '../../src/web/server.js';
import type { Config, Rule } from '../../src/config/schema.js';
import type { FolderCache } from '../../src/folders/index.js';
import type { ActivityLog } from '../../src/log/index.js';

const silentLogger = pino({ level: 'silent' });

function baseConfig(): Config {
  return {
    imap: {
      host: 'localhost',
      port: 3143,
      tls: false,
      auth: { user: 'user', pass: 'pass' },
      idleTimeout: 300_000,
      pollInterval: 60_000,
    },
    server: { port: 3000, host: '127.0.0.1' },
    rules: [],
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: true, scanInterval: 30 },
    },
    actionFolders: {
      enabled: false,
      prefix: 'Actions',
      pollInterval: 15,
      folders: { vip: 'VIP', block: 'Block', undoVip: 'UndoVIP', unblock: 'Unblock' },
    },
    sentinel: { scanIntervalMs: 300_000 },
  };
}

function ruleBody(overrides: Partial<Omit<Rule, 'id'>> = {}): Omit<Rule, 'id'> {
  return {
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive/Lists' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

interface Harness {
  app: FastifyInstance;
  configRepo: ConfigRepository;
  configPath: string;
  tmpDir: string;
  rulesListener: ReturnType<typeof vi.fn>;
  monitorListener: ReturnType<typeof vi.fn>;
  sweeperListener: ReturnType<typeof vi.fn>;
  batchListener: ReturnType<typeof vi.fn>;
  folderCache: FolderCache;
  hasFolderMock: ReturnType<typeof vi.fn>;
  teardown: () => Promise<void>;
}

async function buildHarness(opts: {
  initialRules?: Rule[];
  hasFolder?: boolean;
} = {}): Promise<Harness> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-011-'));
  const configPath = path.join(tmpDir, 'config.yml');
  const cfg = baseConfig();
  if (opts.initialRules) cfg.rules = opts.initialRules;
  saveConfig(configPath, cfg);
  const configRepo = new ConfigRepository(configPath);

  const monitorListener = vi.fn();
  const sweeperListener = vi.fn();
  const batchListener = vi.fn();
  const rulesListener = vi.fn((rules: Rule[]) => {
    monitorListener(rules);
    sweeperListener(rules);
    batchListener(rules);
  });
  configRepo.onRulesChange(rulesListener);

  const hasFolderMock = vi.fn().mockReturnValue(opts.hasFolder ?? true);
  const folderCache = { hasFolder: hasFolderMock } as unknown as FolderCache;

  const deps: ServerDeps = {
    configRepo,
    activityLog: { logActivity: vi.fn() } as unknown as ActivityLog,
    getMonitor: vi.fn(),
    getSweeper: vi.fn(),
    getFolderCache: () => folderCache,
    getBatchEngine: vi.fn(),
    getMoveTracker: vi.fn(),
    getProposalStore: vi.fn(),
    staticRoot: tmpDir,
  };

  const app = buildServer(deps);
  await app.ready();

  return {
    app,
    configRepo,
    configPath,
    tmpDir,
    rulesListener,
    monitorListener,
    sweeperListener,
    batchListener,
    folderCache,
    hasFolderMock,
    teardown: async () => {
      await app.close().catch(() => {});
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('IX-011 — Rule CRUD via web API with hot-reload', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.teardown(); });

  describe('IX-011.1 / IX-011.2 / IX-011.8: route shapes, dispatch, and HTTP codes', () => {
    it('IX-011.1, IX-011.2, IX-011.8: POST /api/rules creates a rule (201) and ConfigRepository.addRule receives the body', async () => {
      const addSpy = vi.spyOn(h.configRepo, 'addRule');

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody(),
      });

      expect(res.statusCode).toBe(201);
      expect(addSpy).toHaveBeenCalledTimes(1);
      const body = res.json() as Rule;
      expect(body.id).toBeTruthy();
      expect(body.name).toBe('Test Rule');
    });

    it('IX-011.1, IX-011.2, IX-011.8: PUT /api/rules/:id updates and returns 200', async () => {
      const created = h.configRepo.addRule(ruleBody());
      h.rulesListener.mockClear();
      const updateSpy = vi.spyOn(h.configRepo, 'updateRule');

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/rules/${created.id}`,
        payload: ruleBody({ name: 'Renamed Rule' }),
      });

      expect(res.statusCode).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(created.id, expect.objectContaining({ name: 'Renamed Rule' }));
      expect((res.json() as Rule).name).toBe('Renamed Rule');
    });

    it('IX-011.1, IX-011.2, IX-011.8: DELETE /api/rules/:id returns 204 and removes the rule', async () => {
      const created = h.configRepo.addRule(ruleBody());
      const deleteSpy = vi.spyOn(h.configRepo, 'deleteRule');

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/rules/${created.id}`,
      });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(deleteSpy).toHaveBeenCalledWith(created.id);
      expect(h.configRepo.getRules()).toHaveLength(0);
    });

    it('IX-011.1, IX-011.2, IX-011.8: PUT /api/rules/reorder applies new orders and returns 200', async () => {
      const a = h.configRepo.addRule(ruleBody({ name: 'A', order: 0 }));
      const b = h.configRepo.addRule(ruleBody({ name: 'B', order: 1 }));
      const reorderSpy = vi.spyOn(h.configRepo, 'reorderRules');

      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/rules/reorder',
        payload: [{ id: a.id, order: 5 }, { id: b.id, order: 2 }],
      });

      expect(res.statusCode).toBe(200);
      expect(reorderSpy).toHaveBeenCalledWith([{ id: a.id, order: 5 }, { id: b.id, order: 2 }]);
      const updated = h.configRepo.getRules();
      expect(updated.find(r => r.id === a.id)!.order).toBe(5);
      expect(updated.find(r => r.id === b.id)!.order).toBe(2);
    });

    it('IX-011.1: DELETE /api/rules?namePrefix=... bulk deletes by name prefix', async () => {
      h.configRepo.addRule(ruleBody({ name: 'Newsletter A' }));
      h.configRepo.addRule(ruleBody({ name: 'Newsletter B' }));
      h.configRepo.addRule(ruleBody({ name: 'Other Rule' }));

      const res = await h.app.inject({
        method: 'DELETE',
        url: '/api/rules?namePrefix=Newsletter',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { deleted: number; names: string[] };
      expect(body.deleted).toBe(2);
      expect(h.configRepo.getRules()).toHaveLength(1);
    });

    it('IX-011.1: DELETE /api/rules with namePrefix shorter than 2 chars returns 400', async () => {
      const res = await h.app.inject({
        method: 'DELETE',
        url: '/api/rules?namePrefix=N',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('IX-011.3: validation failure', () => {
    it('IX-011.3: invalid input (move action without folder) returns 400 with {error, details}', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: {
          name: 'Bad Rule',
          match: { sender: '*@example.com' },
          // Discriminated union: type=move requires `folder`.
          action: { type: 'move' },
          enabled: true,
          order: 0,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details: string[] };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('IX-011.3 (failure handling): validation failure does not fire listener and does not modify YAML', async () => {
      const beforeYaml = fs.readFileSync(h.configPath, 'utf-8');

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: {
          name: 'Bad Rule',
          match: { sender: '*@example.com' },
          action: { type: 'move' },
          enabled: true,
          order: 0,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(h.rulesListener).not.toHaveBeenCalled();
      expect(fs.readFileSync(h.configPath, 'utf-8')).toBe(beforeYaml);
    });
  });

  describe('IX-011.4: mutations and not-found semantics', () => {
    it('IX-011.4: addRule generates a UUID id and returns the persisted order from the body', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody({ order: 8 }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Rule;
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.order).toBe(8);
      expect(h.configRepo.nextOrder()).toBe(9);
    });

    it('IX-011.4: PUT /api/rules/:unknown returns 404', async () => {
      const beforeYaml = fs.readFileSync(h.configPath, 'utf-8');

      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/rules/nonexistent-id',
        payload: ruleBody(),
      });

      expect(res.statusCode).toBe(404);
      expect(h.rulesListener).not.toHaveBeenCalled();
      expect(fs.readFileSync(h.configPath, 'utf-8')).toBe(beforeYaml);
    });

    it('IX-011.4: DELETE /api/rules/:unknown returns 404', async () => {
      const beforeYaml = fs.readFileSync(h.configPath, 'utf-8');

      const res = await h.app.inject({
        method: 'DELETE',
        url: '/api/rules/nonexistent-id',
      });

      expect(res.statusCode).toBe(404);
      expect(h.rulesListener).not.toHaveBeenCalled();
      expect(fs.readFileSync(h.configPath, 'utf-8')).toBe(beforeYaml);
    });

    it('IX-011.4: reorderRules ignores unknown ids and applies known ones', async () => {
      const a = h.configRepo.addRule(ruleBody({ name: 'A', order: 0 }));

      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/rules/reorder',
        payload: [{ id: a.id, order: 9 }, { id: 'unknown-id', order: 100 }],
      });

      expect(res.statusCode).toBe(200);
      const rules = h.configRepo.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].order).toBe(9);
    });
  });

  describe('IX-011.5: YAML persistence is synchronous before listener fires', () => {
    it('IX-011.5: after addRule, the YAML file already contains the new rule when the listener observes it', async () => {
      const observedAtFire: string[] = [];
      // Re-register a listener that snapshots disk at fire time.
      h.configRepo.onRulesChange(() => {
        observedAtFire.push(fs.readFileSync(h.configPath, 'utf-8'));
      });

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody({ name: 'Persisted' }),
      });

      expect(res.statusCode).toBe(201);
      const created = res.json() as Rule;
      expect(observedAtFire).toHaveLength(1);
      expect(observedAtFire[0]).toContain(created.id);
      expect(observedAtFire[0]).toContain('Persisted');
      // Verify the YAML round-trips back through the loader.
      const reloaded = loadConfig(h.configPath);
      expect(reloaded.rules.some(r => r.id === created.id)).toBe(true);
    });
  });

  describe('IX-011.6: rulesChange callback receives the updated rule list', () => {
    it('IX-011.6: addRule fires the registered listener with the new rule list', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody({ name: 'L1' }),
      });

      expect(res.statusCode).toBe(201);
      expect(h.rulesListener).toHaveBeenCalledTimes(1);
      const passed = h.rulesListener.mock.calls[0][0] as Rule[];
      expect(passed).toHaveLength(1);
      expect(passed[0].name).toBe('L1');
      // Fan-out within our composite listener reaches every subsystem.
      expect(h.monitorListener).toHaveBeenCalledTimes(1);
      expect(h.sweeperListener).toHaveBeenCalledTimes(1);
      expect(h.batchListener).toHaveBeenCalledTimes(1);
    });

    it('IX-011.6: updateRule/deleteRule/reorderRules each fire the listener exactly once', async () => {
      const created = h.configRepo.addRule(ruleBody({ name: 'X' }));
      h.rulesListener.mockClear();

      await h.app.inject({
        method: 'PUT',
        url: `/api/rules/${created.id}`,
        payload: ruleBody({ name: 'X-renamed' }),
      });
      expect(h.rulesListener).toHaveBeenCalledTimes(1);

      await h.app.inject({
        method: 'PUT',
        url: '/api/rules/reorder',
        payload: [{ id: created.id, order: 42 }],
      });
      expect(h.rulesListener).toHaveBeenCalledTimes(2);

      await h.app.inject({ method: 'DELETE', url: `/api/rules/${created.id}` });
      expect(h.rulesListener).toHaveBeenCalledTimes(3);
      expect((h.rulesListener.mock.calls[2][0] as Rule[])).toHaveLength(0);
    });
  });

  describe('IX-011.7: folder warnings via FolderCache.hasFolder', () => {
    it('IX-011.7: missing destination folder attaches `warnings` on POST 201 response (rule still created)', async () => {
      await h.teardown();
      h = await buildHarness({ hasFolder: false });

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody({ action: { type: 'move', folder: 'Missing/Folder' } }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Rule & { warnings?: string[] };
      expect(body.warnings).toBeDefined();
      expect(body.warnings![0]).toContain('Missing/Folder');
      expect(h.configRepo.getRules()).toHaveLength(1);
    });

    it('IX-011.7: existing destination folder produces no `warnings` field on POST 201 response', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: ruleBody({ action: { type: 'move', folder: 'Archive/Lists' } }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Rule & { warnings?: string[] };
      expect(body.warnings).toBeUndefined();
    });

    it('IX-011.7: PUT update path also surfaces warnings when destination is missing', async () => {
      await h.teardown();
      h = await buildHarness({ hasFolder: false });
      // Seed via repo (bypasses warning path) so we can target the update.
      const created = h.configRepo.addRule(ruleBody({ action: { type: 'move', folder: 'Archive/Lists' } }));

      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/rules/${created.id}`,
        payload: ruleBody({ action: { type: 'move', folder: 'Still/Missing' } }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Rule & { warnings?: string[] };
      expect(body.warnings).toBeDefined();
      expect(body.warnings![0]).toContain('Still/Missing');
    });
  });
});
