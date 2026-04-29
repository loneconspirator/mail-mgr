/**
 * UC-005 — User authors, edits, deletes, and reorders rules directly via the
 * web UI.
 *
 * Spec: specs/use-cases/uc-005-direct-rule-editing-via-web-ui.md
 *
 * End-to-end acceptance test against live GreenMail and the real production
 * components (ImapClient, Monitor, ConfigRepository writing to a temp YAML,
 * Fastify server, ActivityLog). IX-011 already exhaustively covers the
 * route-level CRUD/validation/listener fan-out shape with mocks; this file
 * focuses on the user-visible journey: a real arrival routes via a rule that
 * was just created via the API, edits hot-reload without an IMAP reconnect,
 * reordering changes precedence, and YAML round-trips.
 *
 * Integrations exercised:
 *   IX-001 arrival detection / rule evaluation (hot-reloaded rules apply)
 *   IX-002 action execution / activity logging (move, delete-as-trash)
 *   IX-011 rule CRUD + hot-reload fan-out
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { ImapFlow } from 'imapflow';
import type { FastifyInstance } from 'fastify';

import { ImapClient } from '../../src/imap/client.js';
import type { ImapFlowLike } from '../../src/imap/client.js';
import { Monitor } from '../../src/monitor/index.js';
import { ActivityLog } from '../../src/log/index.js';
import { ConfigRepository } from '../../src/config/repository.js';
import { saveConfig } from '../../src/config/loader.js';
import { SignalStore } from '../../src/tracking/signals.js';
import { ProposalStore } from '../../src/tracking/proposals.js';
import { PatternDetector } from '../../src/tracking/detector.js';
import { DestinationResolver } from '../../src/tracking/destinations.js';
import { MoveTracker } from '../../src/tracking/index.js';
import { buildServer } from '../../src/web/server.js';
import { FolderCache } from '../../src/folders/index.js';
import { BatchEngine } from '../../src/batch/index.js';
import { ReviewSweeper } from '../../src/sweep/index.js';
import type { Config, Rule } from '../../src/config/schema.js';

import {
  sendTestEmail,
  waitForProcessed,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const HOST = 'localhost';
const IMAP_PORT = 3143;
const CRITICAL = 'Critical';
const P0_ALERTS = 'P0 Alerts';
const RESCUE = 'Rescue';
const TRASH = 'Trash';

const silentLogger = pino({ level: 'silent' });

function makeImapFlowFactory() {
  return (config: typeof TEST_IMAP_CONFIG): ImapFlowLike =>
    new ImapFlow({
      host: config.host,
      port: config.port,
      secure: false,
      auth: config.auth,
      logger: false,
      doSTARTTLS: false,
    }) as unknown as ImapFlowLike;
}

async function bringUpApp(tmpDir: string) {
  const configPath = path.join(tmpDir, 'config.yml');
  const baseConfig: Config = {
    imap: {
      host: HOST,
      port: IMAP_PORT,
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
      trashFolder: TRASH,
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: true, scanInterval: 30 },
    },
    actionFolders: {
      enabled: false,
      prefix: 'Actions',
      pollInterval: 15,
      folders: {
        vip: 'VIP',
        block: 'Block',
        undoVip: 'UndoVIP',
        unblock: 'Unblock',
      },
    },
    sentinel: { scanIntervalMs: 300_000 },
  };
  saveConfig(configPath, baseConfig);

  const configRepo = new ConfigRepository(configPath);
  const config = configRepo.getConfig();

  const activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
  const db = activityLog.getDb();
  const signalStore = new SignalStore(db);
  const proposalStore = new ProposalStore(db);
  const patternDetector = new PatternDetector(proposalStore);

  const imapClient = new ImapClient(config.imap, makeImapFlowFactory());
  await imapClient.connect();

  for (const folder of [CRITICAL, P0_ALERTS, RESCUE, TRASH, config.review.folder]) {
    await imapClient.createMailbox(folder).catch(() => {});
  }

  const monitor = new Monitor(config, { imapClient, activityLog, logger: silentLogger });

  const destinationResolver = new DestinationResolver({
    client: imapClient,
    activityLog,
    listFolders: () => imapClient.listMailboxes(),
    logger: silentLogger,
  });

  const moveTracker = new MoveTracker({
    client: imapClient,
    activityLog,
    signalStore,
    destinationResolver,
    inboxFolder: 'INBOX',
    reviewFolder: config.review.folder,
    scanIntervalMs: 60_000,
    enabled: false,
    patternDetector,
    logger: silentLogger,
  });

  const folderCache = new FolderCache({ imapClient, ttlMs: 300_000 });
  // Populate cache so checkFolderWarnings works against real IMAP state for UC-005.b.
  await folderCache.refresh();

  const batchEngine = new BatchEngine({
    client: imapClient,
    activityLog,
    rules: config.rules,
    trashFolder: config.review.trashFolder,
    reviewFolder: config.review.folder,
    reviewConfig: config.review,
    logger: silentLogger,
  });
  const sweeper = new ReviewSweeper({
    client: imapClient,
    activityLog,
    rules: config.rules,
    reviewConfig: config.review,
    trashFolder: config.review.trashFolder,
    logger: silentLogger,
  });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
    batchEngine.updateRules(rules);
    sweeper.updateRules(rules);
  });

  const app: FastifyInstance = buildServer({
    configRepo,
    activityLog,
    getMonitor: () => monitor,
    getSweeper: () => sweeper,
    getFolderCache: () => folderCache,
    getBatchEngine: () => batchEngine,
    getMoveTracker: () => moveTracker,
    getProposalStore: () => proposalStore,
    staticRoot: tmpDir,
  });
  await app.ready();

  await monitor.start();

  async function teardown() {
    await monitor.stop().catch(() => {});
    moveTracker.stop();
    await app.close().catch(() => {});
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return {
    configPath,
    configRepo,
    activityLog,
    proposalStore,
    monitor,
    moveTracker,
    imapClient,
    folderCache,
    app,
    teardown,
  };
}

async function emptyAndDeleteFolder(folder: string): Promise<void> {
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: 'user', pass: 'pass' },
    logger: false,
    doSTARTTLS: false,
  });
  try {
    await client.connect();
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageDelete('1:*').catch(() => {});
      } finally {
        lock.release();
      }
    } catch {
      // not present — fine
    }
    try {
      await client.mailboxDelete(folder);
    } catch {
      // not present — fine
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

describe('UC-005: Direct rule editing via web UI', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof bringUpApp>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-005-'));
    await clearMailboxes();
    for (const f of [CRITICAL, P0_ALERTS, RESCUE, TRASH]) {
      await emptyAndDeleteFolder(f);
    }
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    for (const f of [CRITICAL, P0_ALERTS, RESCUE, TRASH]) {
      await emptyAndDeleteFolder(f);
    }
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('main flow phases 1-6: create, hot-reloaded arrival, edit, reorder, delete', async () => {
    const { configRepo, activityLog, monitor, app: server } = app;

    // ---------------- Phase 1+2+3: create rule via API; hot-reload routes a real arrival ----------------

    const createResp = await server.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Outage alerts',
        match: { sender: 'alerts@example.com', subject: '*OUTAGE*' },
        action: { type: 'move', folder: CRITICAL },
        enabled: true,
        order: 0,
      },
    });
    expect(createResp.statusCode).toBe(201);
    const outageRule = createResp.json() as Rule & { warnings?: string[] };
    expect(outageRule.id).toBeTruthy();
    expect(outageRule.warnings).toBeUndefined();
    expect(configRepo.getRules()).toHaveLength(1);

    await sendTestEmail({
      from: 'alerts@example.com',
      to: 'user@localhost',
      subject: 'PROD OUTAGE p0',
      body: 'site is down',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const phase3Move = await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === outageRule.id &&
        e.action === 'move' &&
        e.folder === CRITICAL &&
        e.success === 1,
    });
    expect(phase3Move.source).toBe('arrival');
    expect(await listMailboxMessages(CRITICAL)).toHaveLength(1);
    expect(await listMailboxMessages('INBOX')).toHaveLength(0);

    // ---------------- Phase 4: edit rule destination; next arrival lands in P0 Alerts ----------------

    const updateResp = await server.inject({
      method: 'PUT',
      url: `/api/rules/${outageRule.id}`,
      payload: {
        name: 'Outage alerts',
        match: { sender: 'alerts@example.com', subject: '*OUTAGE*' },
        action: { type: 'move', folder: P0_ALERTS },
        enabled: true,
        order: outageRule.order,
      },
    });
    expect(updateResp.statusCode).toBe(200);

    await sendTestEmail({
      from: 'alerts@example.com',
      to: 'user@localhost',
      subject: 'STAGING OUTAGE p2',
      body: 'staging is down',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === outageRule.id &&
        e.action === 'move' &&
        e.folder === P0_ALERTS &&
        e.success === 1,
    });
    expect(await listMailboxMessages(P0_ALERTS)).toHaveLength(1);
    expect(await listMailboxMessages(CRITICAL)).toHaveLength(1);

    // ---------------- Phase 5: reorder fixes shadowing ----------------

    const r0 = configRepo.addRule({
      name: 'Bulk delete',
      match: { sender: '*@bulk.example.com' },
      action: { type: 'delete' },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    const r1 = configRepo.addRule({
      name: 'Rescue notify',
      match: { sender: 'notify@bulk.example.com' },
      action: { type: 'move', folder: RESCUE },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    expect(r0.order).toBeLessThan(r1.order);

    await sendTestEmail({
      from: 'notify@bulk.example.com',
      to: 'user@localhost',
      subject: 'shadowed by R0',
      body: 'should be deleted before reorder',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === r0.id &&
        e.action === 'delete' &&
        e.success === 1,
    });
    expect(await listMailboxMessages(RESCUE)).toHaveLength(0);

    const reorderResp = await server.inject({
      method: 'PUT',
      url: '/api/rules/reorder',
      payload: [
        { id: r1.id, order: r0.order },
        { id: r0.id, order: r1.order },
      ],
    });
    expect(reorderResp.statusCode).toBe(200);
    const rulesAfterReorder = configRepo.getRules();
    const r1After = rulesAfterReorder.find((r) => r.id === r1.id)!;
    const r0After = rulesAfterReorder.find((r) => r.id === r0.id)!;
    expect(r1After.order).toBeLessThan(r0After.order);

    await sendTestEmail({
      from: 'notify@bulk.example.com',
      to: 'user@localhost',
      subject: 'rescued after reorder',
      body: 'should land in Rescue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === r1.id &&
        e.action === 'move' &&
        e.folder === RESCUE &&
        e.message_subject === 'rescued after reorder' &&
        e.success === 1,
    });
    expect(await listMailboxMessages(RESCUE)).toHaveLength(1);

    // ---------------- Phase 6: delete R0; bulk-sender messages survive ----------------

    const deleteResp = await server.inject({
      method: 'DELETE',
      url: `/api/rules/${r0.id}`,
    });
    expect(deleteResp.statusCode).toBe(204);
    expect(configRepo.getRules().find((r) => r.id === r0.id)).toBeUndefined();

    await sendTestEmail({
      from: 'random@bulk.example.com',
      to: 'user@localhost',
      subject: 'no longer auto-deleted',
      body: 'matches old R0 sender pattern but R0 is gone',
    });
    await new Promise((r) => setTimeout(r, 1500));
    await monitor.processNewMessages();
    await new Promise((r) => setTimeout(r, 1000));

    const inboxUids = await listMailboxMessages('INBOX');
    expect(inboxUids).toHaveLength(1);
    const recentDeletes = activityLog
      .getRecentActivity(100)
      .filter(
        (e) =>
          e.action === 'delete' &&
          e.message_subject === 'no longer auto-deleted',
      );
    expect(recentDeletes).toHaveLength(0);
  }, 180_000);

  it('UC-005.a: validation failure (move without folder) returns 400 and YAML untouched', async () => {
    const { configPath, app: server } = app;
    const beforeYaml = fs.readFileSync(configPath, 'utf-8');
    const beforeMtime = fs.statSync(configPath).mtimeMs;

    const res = await server.inject({
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
    const body = res.json() as { error: string; details: string[] };
    expect(body.error).toBe('Validation failed');
    expect(body.details.length).toBeGreaterThan(0);

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(beforeYaml);
    expect(fs.statSync(configPath).mtimeMs).toBe(beforeMtime);
  });

  it('UC-005.b: destination folder warning surfaces in response (rule still persisted)', async () => {
    const { configRepo, folderCache, app: server } = app;
    // Use a name uniquely qualified by the temp dir so prior test runs cannot
    // leave a same-named folder on the shared GreenMail instance.
    const MISSING = `Triage-${path.basename(tmpDir)}`;
    await folderCache.refresh();
    expect(folderCache.hasFolder(MISSING)).toBe(false);

    const res = await server.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Triage rule',
        match: { sender: 'someone@example.com' },
        action: { type: 'move', folder: MISSING },
        enabled: true,
        order: 0,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Rule & { warnings?: string[] };
    expect(body.warnings).toEqual([`Destination folder "${MISSING}" not found on server`]);
    expect(configRepo.getRules().some((r) => r.id === body.id)).toBe(true);
  });

  it('UC-005.c: PUT /api/rules/{stale-id} returns 404', async () => {
    const { app: server } = app;
    const res = await server.inject({
      method: 'PUT',
      url: '/api/rules/non-existent-id',
      payload: {
        name: 'Doesnt matter',
        match: { sender: 'x@example.com' },
        action: { type: 'move', folder: CRITICAL },
        enabled: true,
        order: 0,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('UC-005.d: bulk delete by name prefix', async () => {
    const { configRepo, app: server } = app;
    configRepo.addRule({
      name: 'Imported-2024:Newsletter A',
      match: { sender: '*@a.example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    configRepo.addRule({
      name: 'Imported-2024:Newsletter B',
      match: { sender: '*@b.example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    configRepo.addRule({
      name: 'Imported-2024:Receipts',
      match: { sender: '*@c.example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    const keeper = configRepo.addRule({
      name: 'Manual rule',
      match: { sender: '*@manual.example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/rules?namePrefix=Imported-2024:',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted: number; names: string[] };
    expect(body.deleted).toBe(3);
    expect(body.names).toEqual(
      expect.arrayContaining([
        'Imported-2024:Newsletter A',
        'Imported-2024:Newsletter B',
        'Imported-2024:Receipts',
      ]),
    );

    const remaining = configRepo.getRules();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(keeper.id);

    const noMatch = await server.inject({
      method: 'DELETE',
      url: '/api/rules?namePrefix=NoSuchPrefix:',
    });
    expect(noMatch.statusCode).toBe(404);

    const tooShort = await server.inject({
      method: 'DELETE',
      url: '/api/rules?namePrefix=N',
    });
    expect(tooShort.statusCode).toBe(400);
  });

  it('UC-005.e: toggling enabled flips filing for next arrival', async () => {
    const { configRepo, activityLog, monitor, app: server } = app;

    const created = configRepo.addRule({
      name: 'Toggle target',
      match: { sender: 'toggle@example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    await sendTestEmail({
      from: 'toggle@example.com',
      to: 'user@localhost',
      subject: 'enabled #1',
      body: 'first',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === created.id &&
        e.action === 'move' &&
        e.message_subject === 'enabled #1' &&
        e.success === 1,
    });
    expect(await listMailboxMessages(CRITICAL)).toHaveLength(1);

    const offResp = await server.inject({
      method: 'PUT',
      url: `/api/rules/${created.id}`,
      payload: {
        name: 'Toggle target',
        match: { sender: 'toggle@example.com' },
        action: { type: 'move', folder: CRITICAL },
        enabled: false,
        order: created.order,
      },
    });
    expect(offResp.statusCode).toBe(200);

    await sendTestEmail({
      from: 'toggle@example.com',
      to: 'user@localhost',
      subject: 'disabled #2',
      body: 'second',
    });
    await new Promise((r) => setTimeout(r, 1500));
    await monitor.processNewMessages();
    await new Promise((r) => setTimeout(r, 1000));

    const disabledMatches = activityLog
      .getRecentActivity(100)
      .filter((e) => e.message_subject === 'disabled #2' && e.action === 'move');
    expect(disabledMatches).toHaveLength(0);
    expect(await listMailboxMessages('INBOX')).toHaveLength(1);

    const onResp = await server.inject({
      method: 'PUT',
      url: `/api/rules/${created.id}`,
      payload: {
        name: 'Toggle target',
        match: { sender: 'toggle@example.com' },
        action: { type: 'move', folder: CRITICAL },
        enabled: true,
        order: created.order,
      },
    });
    expect(onResp.statusCode).toBe(200);

    await sendTestEmail({
      from: 'toggle@example.com',
      to: 'user@localhost',
      subject: 're-enabled #3',
      body: 'third',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 15_000,
      predicate: (e) =>
        e.rule_id === created.id &&
        e.action === 'move' &&
        e.message_subject === 're-enabled #3' &&
        e.success === 1,
    });
    expect(await listMailboxMessages(CRITICAL)).toHaveLength(2);
  }, 120_000);

  it('UC-005.f: reorder with a stale id ignores the unknown id and applies the rest', async () => {
    const { configRepo, app: server } = app;
    const valid = configRepo.addRule({
      name: 'Valid',
      match: { sender: '*@valid.example.com' },
      action: { type: 'move', folder: CRITICAL },
      enabled: true,
      order: configRepo.nextOrder(),
    });
    const originalOrder = valid.order;

    const res = await server.inject({
      method: 'PUT',
      url: '/api/rules/reorder',
      payload: [
        { id: valid.id, order: originalOrder + 50 },
        { id: 'stale-bogus-id', order: 999 },
      ],
    });
    expect(res.statusCode).toBe(200);

    const rules = configRepo.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(valid.id);
    expect(rules[0].order).toBe(originalOrder + 50);
  });

  it.todo('UC-005.g: hot-reload during running batch — covered by UC-004.g acceptance test');
});
