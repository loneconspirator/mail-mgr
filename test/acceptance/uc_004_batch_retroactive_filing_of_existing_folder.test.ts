/**
 * UC-004 — User retroactively files an existing folder via dry-run preview
 * and bulk execute.
 *
 * Spec: specs/use-cases/uc-004-batch-retroactive-filing-of-existing-folder.md
 *
 * End-to-end acceptance test. Real GreenMail IMAP, real ImapClient, real
 * BatchEngine, real Fastify server, real ConfigRepository (writing to a
 * temp YAML), real ActivityLog SQLite. The Monitor is constructed but not
 * started — UC-004 drives the BatchEngine directly via its HTTP routes,
 * and an active arrival pipeline would race with the test corpus.
 *
 * Integrations exercised:
 *   IX-002 — action execution / activity logging (batch source)
 *   IX-009 — batch dry-run grouping
 *   IX-010 — batch execute / cancel / status
 *
 * Variants:
 *   Main flow      — INBOX move + skip + no-match buckets, full execute.
 *   UC-004.a       — Cancel mid-execute leaves remaining messages in INBOX.
 *   UC-004.b       — Concurrent dry-run while executing returns 409.
 *   UC-004.c       — Source folder is the Review folder (sweep semantics).
 *   UC-004.d       — Generic mode (non-INBOX, non-Review) source folder.
 *   UC-004.e       — Per-message error during execute (it.todo — needs
 *                    IMAP-level fault injection).
 *   UC-004.f       — Sentinels are skipped silently in both phases.
 *   UC-004.g       — Rule changes between dry-run and execute take effect.
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
import type { DryRunGroup, BatchState } from '../../src/batch/index.js';

import {
  sendTestEmail,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const HOST = 'localhost';
const IMAP_PORT = 3143;
const REVIEW_FOLDER = 'Review';
const NOTIFICATIONS = 'Notifications';
const DEFAULT_ARCHIVE = 'MailingLists';
const TRASH = 'Trash';
const TRIAGE = 'Triage';

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

interface AppHandle {
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  monitor: Monitor;
  imapClient: ImapClient;
  batchEngine: BatchEngine;
  app: FastifyInstance;
  teardown: () => Promise<void>;
}

async function bringUpApp(tmpDir: string): Promise<AppHandle> {
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
      folder: REVIEW_FOLDER,
      defaultArchiveFolder: DEFAULT_ARCHIVE,
      trashFolder: TRASH,
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: false, scanInterval: 30 },
    },
    actionFolders: {
      enabled: false,
      prefix: 'Actions',
      pollInterval: 15,
      folders: { vip: 'VIP', block: 'Block', undoVip: 'UndoVIP', unblock: 'Unblock' },
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

  // Pre-create folders so neither dry-run grouping nor execute moves race
  // the auto-create path inside ImapClient.moveMessage.
  await imapClient.createMailbox(REVIEW_FOLDER).catch(() => {});
  await imapClient.createMailbox(NOTIFICATIONS).catch(() => {});
  await imapClient.createMailbox(DEFAULT_ARCHIVE).catch(() => {});
  await imapClient.createMailbox(TRASH).catch(() => {});
  await imapClient.createMailbox(TRIAGE).catch(() => {});

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

  // Monitor is intentionally NOT started — UC-004 drives the batch engine
  // directly and a live arrival pipeline would auto-process INBOX messages
  // out from under the batch.

  async function teardown() {
    await monitor.stop().catch(() => {});
    moveTracker.stop();
    await app.close().catch(() => {});
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return { configRepo, activityLog, monitor, imapClient, batchEngine, app, teardown };
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
      // folder might not exist
    }
    try {
      await client.mailboxDelete(folder);
    } catch {
      // not present
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function appendRaw(
  folder: string,
  opts: {
    sender: string;
    subject: string;
    messageId: string;
    daysAgo?: number;
    seen?: boolean;
    extraHeaders?: string[];
  },
): Promise<void> {
  const internalDate =
    opts.daysAgo !== undefined
      ? new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000)
      : new Date();
  const headers = [
    `From: ${opts.sender}`,
    `To: user@localhost`,
    `Subject: ${opts.subject}`,
    `Message-ID: <${opts.messageId}>`,
    ...(opts.extraHeaders ?? []),
  ];
  const raw = headers.join('\r\n') + '\r\n\r\nbody\r\n';

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
    const flags = opts.seen ? ['\\Seen'] : [];
    await client.append(folder, raw, flags, internalDate);
  } finally {
    await client.logout().catch(() => {});
  }
}

function ruleInput(input: Omit<Rule, 'id' | 'order'> & { order?: number }): Omit<Rule, 'id'> {
  return { enabled: true, order: 0, ...input };
}

async function pollUntilStatus(
  app: FastifyInstance,
  predicate: (state: BatchState) => boolean,
  timeoutMs: number,
): Promise<BatchState> {
  const start = Date.now();
  // 250ms poll interval per UC-004 spec instructions.
  while (Date.now() - start < timeoutMs) {
    const resp = await app.inject({ method: 'GET', url: '/api/batch/status' });
    const state = resp.json() as BatchState;
    if (predicate(state)) return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`pollUntilStatus timed out after ${timeoutMs}ms`);
}

async function postJson(
  app: FastifyInstance,
  url: string,
  payload?: Record<string, unknown>,
) {
  if (payload === undefined) {
    return app.inject({ method: 'POST', url });
  }
  return app.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'content-type': 'application/json' },
  });
}

describe('UC-004: User retroactively files an existing folder via dry-run preview and bulk execute', () => {
  let tmpDir: string;
  let app: AppHandle;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-004-'));
    await clearMailboxes();
    await emptyAndDeleteFolder(REVIEW_FOLDER);
    await emptyAndDeleteFolder(NOTIFICATIONS);
    await emptyAndDeleteFolder(DEFAULT_ARCHIVE);
    await emptyAndDeleteFolder(TRASH);
    await emptyAndDeleteFolder(TRIAGE);
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    await emptyAndDeleteFolder(REVIEW_FOLDER);
    await emptyAndDeleteFolder(NOTIFICATIONS);
    await emptyAndDeleteFolder(DEFAULT_ARCHIVE);
    await emptyAndDeleteFolder(TRASH);
    await emptyAndDeleteFolder(TRIAGE);
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('main flow (Phases 1-4): dry-run buckets, execute moves, skips, leaves no-match in INBOX', async () => {
    const { configRepo, activityLog, app: server } = app;

    const ruleA = configRepo.addRule(
      ruleInput({
        name: 'Notify rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );
    configRepo.addRule(
      ruleInput({
        name: 'Boss skip',
        match: { sender: 'boss@company.com' },
        action: { type: 'skip' },
        order: configRepo.nextOrder(),
      }),
    );

    for (let i = 0; i < 5; i++) {
      await sendTestEmail({
        from: `n${i}@notify.example.com`,
        to: 'user@localhost',
        subject: `Notify ${i}`,
        body: 'n',
      });
    }
    await sendTestEmail({
      from: 'boss@company.com',
      to: 'user@localhost',
      subject: 'Boss email',
      body: 'b',
    });
    for (let i = 0; i < 6; i++) {
      await sendTestEmail({
        from: `random${i}@elsewhere.example.com`,
        to: 'user@localhost',
        subject: `Random ${i}`,
        body: 'r',
      });
    }

    // Wait for SMTP→IMAP delivery to complete.
    await new Promise((r) => setTimeout(r, 1000));
    expect((await listMailboxMessages('INBOX')).length).toBe(12);

    // Phase 1: dry-run.
    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: 'INBOX' });
    expect(dryResp.statusCode).toBe(200);
    const dryBody = dryResp.json() as { results: DryRunGroup[] };
    const groups = dryBody.results;

    const move = groups.find((g) => g.action === 'move' && g.destination === NOTIFICATIONS);
    const skip = groups.find((g) => g.action === 'skip');
    const noMatch = groups.find((g) => g.action === 'no-match');
    expect(move?.count).toBe(5);
    expect(skip?.count).toBe(1);
    expect(noMatch?.count).toBe(6);

    // Each example carries the documented fields.
    for (const ex of move!.messages) {
      expect(typeof ex.uid).toBe('number');
      expect(ex.from).toMatch(/@notify\.example\.com$/);
      expect(typeof ex.subject).toBe('string');
      expect(typeof ex.date).toBe('string');
      expect(ex.ruleName).toBe('Notify rule');
    }

    // Phases 2-3: execute.
    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: 'INBOX' });
    expect(execResp.statusCode).toBe(200);
    expect(execResp.json()).toEqual({ status: 'started' });

    // Phase 4: poll for completion.
    const final = await pollUntilStatus(server, (s) => s.status === 'completed', 30_000);
    expect(final.processed).toBe(12);
    expect(final.moved).toBe(5);
    expect(final.skipped).toBe(7);
    expect(final.errors).toBe(0);

    expect((await listMailboxMessages(NOTIFICATIONS)).length).toBe(5);
    expect((await listMailboxMessages('INBOX')).length).toBe(7);

    const batchEntries = activityLog
      .getRecentActivity(200)
      .filter((e) => e.source === 'batch');
    const ruleASuccesses = batchEntries.filter(
      (e) => e.rule_id === ruleA.id && e.action === 'move' && e.success === 1,
    );
    expect(ruleASuccesses).toHaveLength(5);
    const skipEntries = batchEntries.filter((e) => e.action === 'skip');
    expect(skipEntries.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('UC-004.a: cancel mid-execute leaves remaining messages in INBOX', async () => {
    const { configRepo, app: server } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Notify rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );

    const TOTAL = 60;
    for (let i = 0; i < TOTAL; i++) {
      await sendTestEmail({
        from: `n${i}@notify.example.com`,
        to: 'user@localhost',
        subject: `Notify ${i}`,
        body: 'n',
      });
    }
    await new Promise((r) => setTimeout(r, 1000));
    expect((await listMailboxMessages('INBOX')).length).toBe(TOTAL);

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: 'INBOX' });
    expect(execResp.statusCode).toBe(200);

    // Let the first chunk start, then cancel before all 25-message chunks
    // (TOTAL=60 → 3 chunks) finish. The setImmediate yield between chunks
    // is the cancel observation point.
    await new Promise((r) => setTimeout(r, 50));
    const cancelResp = await postJson(server, '/api/batch/cancel');
    expect(cancelResp.statusCode).toBe(200);

    const final = await pollUntilStatus(
      server,
      (s) => s.status === 'cancelled' || s.status === 'completed',
      30_000,
    );
    expect(final.status).toBe('cancelled');
    expect(final.cancelled).toBe(true);
    expect(final.processed).toBeLessThan(TOTAL);

    const remainingInbox = await listMailboxMessages('INBOX');
    const moved = await listMailboxMessages(NOTIFICATIONS);
    expect(remainingInbox.length + moved.length).toBe(TOTAL);
    expect(remainingInbox.length).toBeGreaterThan(0);
  }, 120_000);

  it('UC-004.b: concurrent dry-run while executing returns 409', async () => {
    const { configRepo, app: server } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Notify rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );

    // Enough messages that execute won't finish before our second request lands.
    for (let i = 0; i < 50; i++) {
      await sendTestEmail({
        from: `n${i}@notify.example.com`,
        to: 'user@localhost',
        subject: `Notify ${i}`,
        body: 'n',
      });
    }
    await new Promise((r) => setTimeout(r, 1000));

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: 'INBOX' });
    expect(execResp.statusCode).toBe(200);

    // Hit dry-run while execute is still running.
    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: 'INBOX' });
    expect(dryResp.statusCode).toBe(409);

    // Drain to completion so afterEach teardown is clean.
    await pollUntilStatus(
      server,
      (s) => s.status === 'completed' || s.status === 'cancelled' || s.status === 'error',
      60_000,
    );
  }, 120_000);

  it('UC-004.c: source folder is the Review folder uses sweep semantics', async () => {
    const { configRepo, activityLog, app: server } = app;

    const moveRule = configRepo.addRule(
      ruleInput({
        name: 'Newsletters move',
        match: { sender: 'newsletter@example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );

    // Two eligible: read + 8 days old → above readMaxAgeDays (7).
    await appendRaw(REVIEW_FOLDER, {
      sender: 'newsletter@example.com',
      subject: 'Old #1',
      messageId: 'uc004c-old1@example.com',
      daysAgo: 8,
      seen: true,
    });
    await appendRaw(REVIEW_FOLDER, {
      sender: 'newsletter@example.com',
      subject: 'Old #2',
      messageId: 'uc004c-old2@example.com',
      daysAgo: 9,
      seen: true,
    });
    // Two ineligible: unread, 2 days old → below both thresholds.
    await appendRaw(REVIEW_FOLDER, {
      sender: 'newsletter@example.com',
      subject: 'Fresh #1',
      messageId: 'uc004c-fresh1@example.com',
      daysAgo: 2,
      seen: false,
    });
    await appendRaw(REVIEW_FOLDER, {
      sender: 'newsletter@example.com',
      subject: 'Fresh #2',
      messageId: 'uc004c-fresh2@example.com',
      daysAgo: 2,
      seen: false,
    });

    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: REVIEW_FOLDER });
    expect(dryResp.statusCode).toBe(200);
    const groups = (dryResp.json() as { results: DryRunGroup[] }).results;

    const ineligible = groups.find((g) => g.destination === 'Not yet eligible');
    expect(ineligible?.count).toBe(2);
    expect(ineligible?.action).toBe('skip');

    const movable = groups.find((g) => g.action === 'move' && g.destination === NOTIFICATIONS);
    expect(movable?.count).toBe(2);

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: REVIEW_FOLDER });
    expect(execResp.statusCode).toBe(200);
    const final = await pollUntilStatus(server, (s) => s.status === 'completed', 30_000);
    expect(final.processed).toBe(4);
    expect(final.moved).toBe(2);
    expect(final.skipped).toBe(2);
    expect(final.errors).toBe(0);

    expect((await listMailboxMessages(REVIEW_FOLDER)).length).toBe(2);
    expect((await listMailboxMessages(NOTIFICATIONS)).length).toBe(2);

    // Activity entries from review-mode batch must use source 'batch' not 'sweep'.
    const batchMoves = activityLog
      .getRecentActivity(100)
      .filter((e) => e.source === 'batch' && e.action === 'move' && e.folder === NOTIFICATIONS);
    expect(batchMoves.length).toBeGreaterThanOrEqual(2);
    expect(batchMoves.every((e) => e.rule_id === moveRule.id)).toBe(true);
  }, 120_000);

  it('UC-004.d: source folder neither INBOX nor Review uses generic mode (review-without-folder → Skip)', async () => {
    const { configRepo, app: server } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Triage move',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );
    configRepo.addRule(
      ruleInput({
        name: 'Bare review',
        match: { sender: 'bare@example.com' },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );

    await appendRaw(TRIAGE, {
      sender: 'a@notify.example.com',
      subject: 'A',
      messageId: 'uc004d-a@example.com',
    });
    await appendRaw(TRIAGE, {
      sender: 'b@notify.example.com',
      subject: 'B',
      messageId: 'uc004d-b@example.com',
    });
    await appendRaw(TRIAGE, {
      sender: 'bare@example.com',
      subject: 'C',
      messageId: 'uc004d-c@example.com',
    });

    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: TRIAGE });
    expect(dryResp.statusCode).toBe(200);
    const groups = (dryResp.json() as { results: DryRunGroup[] }).results;

    const move = groups.find((g) => g.action === 'move' && g.destination === NOTIFICATIONS);
    expect(move?.count).toBe(2);

    // Generic mode reports bare-review with destination 'Skip' per spec UC-004.d
    // (resolveDestination returns 'Skip' for review-without-folder; the action
    // string is preserved as 'review').
    const skip = groups.find((g) => g.destination === 'Skip');
    expect(skip?.count).toBe(1);
    expect(skip?.action).toBe('review');

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: TRIAGE });
    expect(execResp.statusCode).toBe(200);
    const final = await pollUntilStatus(server, (s) => s.status === 'completed', 30_000);
    expect(final.processed).toBe(3);
    expect(final.moved).toBe(2);
    expect(final.skipped).toBe(1);

    expect((await listMailboxMessages(NOTIFICATIONS)).length).toBe(2);
    // The bare-review message stayed in TRIAGE (generic mode does no move for skip).
    expect((await listMailboxMessages(TRIAGE)).length).toBe(1);
  }, 120_000);

  it.todo(
    'UC-004.e: per-message error during execute does not abort the run — needs IMAP-level fault injection',
  );

  it('UC-004.f: sentinel messages are skipped silently in dry-run and execute', async () => {
    const { configRepo, app: server } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Notify rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );

    // Three normal messages.
    for (let i = 0; i < 3; i++) {
      await sendTestEmail({
        from: `n${i}@notify.example.com`,
        to: 'user@localhost',
        subject: `Notify ${i}`,
        body: 'n',
      });
    }
    await new Promise((r) => setTimeout(r, 1000));

    // One sentinel — direct APPEND so the X-Mail-Mgr-Sentinel header lands
    // in INBOX (the buildSentinelMessage helper rejects INBOX explicitly).
    await appendRaw('INBOX', {
      sender: 'mail-manager@localhost',
      subject: '[Mail Manager] Sentinel',
      messageId: 'uc004f-sentinel@mail-manager.sentinel',
      seen: true,
      extraHeaders: ['X-Mail-Mgr-Sentinel: <uc004f-sentinel@mail-manager.sentinel>'],
    });

    expect((await listMailboxMessages('INBOX')).length).toBe(4);

    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: 'INBOX' });
    const groups = (dryResp.json() as { results: DryRunGroup[] }).results;
    const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
    expect(totalCount).toBe(3);

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: 'INBOX' });
    expect(execResp.statusCode).toBe(200);
    const final = await pollUntilStatus(server, (s) => s.status === 'completed', 30_000);
    expect(final.processed).toBe(3);
    expect(final.moved).toBe(3);

    // Sentinel survived in INBOX; the three notify messages moved.
    expect((await listMailboxMessages('INBOX')).length).toBe(1);
    expect((await listMailboxMessages(NOTIFICATIONS)).length).toBe(3);
  }, 120_000);

  it('UC-004.g: rule changes between dry-run and execute take effect at execute time', async () => {
    const { configRepo, app: server } = app;

    const initialRule = configRepo.addRule(
      ruleInput({
        name: 'Initial rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'move', folder: NOTIFICATIONS },
        order: configRepo.nextOrder(),
      }),
    );

    for (let i = 0; i < 4; i++) {
      await sendTestEmail({
        from: `n${i}@notify.example.com`,
        to: 'user@localhost',
        subject: `Notify ${i}`,
        body: 'n',
      });
    }
    await new Promise((r) => setTimeout(r, 1000));

    const dryResp = await postJson(server, '/api/batch/dry-run', { sourceFolder: 'INBOX' });
    const dryGroups = (dryResp.json() as { results: DryRunGroup[] }).results;
    const move = dryGroups.find((g) => g.action === 'move' && g.destination === NOTIFICATIONS);
    expect(move?.count).toBe(4);

    // Swap the rule: same matcher, but action becomes skip. The onRulesChange
    // listener wired in bringUpApp pushes the new rule set to BatchEngine.
    expect(configRepo.deleteRule(initialRule.id)).toBe(true);
    configRepo.addRule(
      ruleInput({
        name: 'Replaced rule',
        match: { sender: '*@notify.example.com' },
        action: { type: 'skip' },
        order: configRepo.nextOrder(),
      }),
    );

    const execResp = await postJson(server, '/api/batch/execute', { sourceFolder: 'INBOX' });
    expect(execResp.statusCode).toBe(200);
    const final = await pollUntilStatus(server, (s) => s.status === 'completed', 30_000);
    expect(final.processed).toBe(4);
    expect(final.moved).toBe(0);
    expect(final.skipped).toBe(4);

    // Nothing moved to Notifications; everything stayed in INBOX.
    expect((await listMailboxMessages(NOTIFICATIONS)).length).toBe(0);
    expect((await listMailboxMessages('INBOX')).length).toBe(4);
  }, 120_000);
});
