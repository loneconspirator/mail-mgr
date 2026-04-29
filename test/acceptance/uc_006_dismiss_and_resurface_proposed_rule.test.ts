/**
 * UC-006 — User dismisses a proposed rule, which auto-resurfaces after five
 * new moves.
 *
 * Spec: specs/use-cases/uc-006-dismiss-and-resurface-proposed-rule.md
 *
 * End-to-end acceptance test against live GreenMail and the real production
 * components (ImapClient, Monitor, MoveTracker, DestinationResolver,
 * SignalStore, PatternDetector, ProposalStore, ConfigRepository, Fastify
 * server). The journey is driven by real user-side IMAP moves; MoveTracker
 * scan pairs feed signals through the Resolver→SignalStore→PatternDetector
 * chain into ProposalStore. Variants UC-006.a..e are exercised; UC-006.f is
 * intentionally deferred (see it.todo at bottom of file).
 *
 * Integrations exercised:
 *   IX-003 user-move detection / destination resolution
 *   IX-004 signal logging / proposal creation
 *   IX-012 proposal dismissal and signal-driven resurfacing
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
import type { Config } from '../../src/config/schema.js';
import type { ProposedRuleCard } from '../../src/shared/types.js';

import {
  sendTestEmail,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const SENDER = 'weekly@example.com';
const DESTINATION = 'Newsletters';
const READ_LATER = 'Read later';
const HOST = 'localhost';
const IMAP_PORT = 3143;

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
      trashFolder: 'Trash',
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

  await imapClient.createMailbox(DESTINATION).catch(() => {});
  await imapClient.createMailbox(config.review.folder).catch(() => {});

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

  await monitor.start();

  async function teardown() {
    await monitor.stop().catch(() => {});
    moveTracker.stop();
    await app.close().catch(() => {});
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return {
    configRepo,
    activityLog,
    proposalStore,
    signalStore,
    patternDetector,
    monitor,
    moveTracker,
    imapClient,
    app,
    teardown,
  };
}

async function userMovesMessage(
  fromFolder: string,
  toFolder: string,
  uid: number,
): Promise<void> {
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
    const lock = await client.getMailboxLock(fromFolder);
    try {
      await client.messageMove([uid], toFolder, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
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
      // not present
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

interface ProposalRow {
  id: number;
  status: string;
  dismissed_at: string | null;
  signals_since_dismiss: number;
  destination_folder: string;
  destination_counts: string;
  matching_count: number;
  contradicting_count: number;
  approved_rule_id: string | null;
}

function readRow(activityLog: ActivityLog, id: number): ProposalRow {
  const row = activityLog.getDb()
    .prepare('SELECT * FROM proposed_rules WHERE id = ?')
    .get(id) as ProposalRow | undefined;
  if (!row) throw new Error(`proposed_rule ${id} not found`);
  return row;
}

async function sendOne(subject: string): Promise<void> {
  await sendTestEmail({
    from: SENDER,
    to: 'user@localhost',
    subject,
    body: 'issue body',
  });
}

/**
 * Drive one end-to-end user move + scan-pair cycle. Mirrors UC-001.d's
 * per-message loop. The 500ms pauses prevent IDLE recycling from racing the
 * scan's mailbox lock — without them the scan silently no-ops. The caller
 * MUST have a prior baseline scan that captured `uid` in INBOX.
 */
async function userMoveAndScan(
  app: Awaited<ReturnType<typeof bringUpApp>>,
  fromFolder: string,
  toFolder: string,
  uid: number,
): Promise<void> {
  await userMovesMessage(fromFolder, toFolder, uid);
  await new Promise((r) => setTimeout(r, 500));
  await app.moveTracker.runScanForTest();
  await new Promise((r) => setTimeout(r, 500));
  await app.moveTracker.runScanForTest();
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Send N emails, ensure the monitor sees them, stop the monitor, and take a
 * baseline scan that snapshots them in INBOX. Returns the inbox UIDs in order.
 *
 * After this returns, `userMoveAndScan` is safe to call for each UID.
 */
async function batchPrepareInbox(
  app: Awaited<ReturnType<typeof bringUpApp>>,
  subjects: string[],
): Promise<number[]> {
  for (const subject of subjects) {
    await sendOne(subject);
  }
  await new Promise((r) => setTimeout(r, 500));
  await app.monitor.processNewMessages();

  const uids = await listMailboxMessages('INBOX');
  if (uids.length !== subjects.length) {
    throw new Error(`Expected ${subjects.length} INBOX messages, got ${uids.length}`);
  }

  await app.monitor.stop();
  await app.moveTracker.runScanForTest();
  return uids;
}

describe('UC-006: Dismiss and resurface proposed rule', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof bringUpApp>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-006-'));
    await clearMailboxes();
    await emptyAndDeleteFolder(DESTINATION);
    await emptyAndDeleteFolder(READ_LATER);
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    await emptyAndDeleteFolder(DESTINATION);
    await emptyAndDeleteFolder(READ_LATER);
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('UC-006 main flow (Phases 1-4): dismiss → 5 moves → resurface with notice', async () => {
    const { activityLog, proposalStore, app: server } = app;

    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(DESTINATION);

    // ---- Setup: 2 pre-dismiss moves so P1 has matchingCount=2, "Moderate" ----
    let inboxUids = await batchPrepareInbox(app, ['Pre #1', 'Pre #2']);
    for (const uid of inboxUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    let proposals = proposalStore.getProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      sender: SENDER,
      destinationFolder: DESTINATION,
      matchingCount: 2,
      contradictingCount: 0,
      status: 'active',
    });
    const p1Id = proposals[0].id;

    let listResp = await server.inject({ method: 'GET', url: '/api/proposed-rules' });
    expect(listResp.statusCode).toBe(200);
    let cards = listResp.json() as ProposedRuleCard[];
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(p1Id);
    expect(cards[0].strengthLabel).toMatch(/moderate/i);

    // ---- Phase 1: dismiss ----
    const dismissResp = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${p1Id}/dismiss`,
    });
    expect(dismissResp.statusCode).toBe(204);

    let row = readRow(activityLog, p1Id);
    expect(row.status).toBe('dismissed');
    expect(row.dismissed_at).not.toBeNull();
    expect(row.signals_since_dismiss).toBe(0);

    listResp = await server.inject({ method: 'GET', url: '/api/proposed-rules' });
    cards = listResp.json() as ProposedRuleCard[];
    expect(cards.find((c) => c.id === p1Id)).toBeUndefined();

    // ---- Phase 2-3: 5 more user moves (batch-prepared so MoveTracker sees
    // them in baseline). Counter must progress 1..4 (still dismissed) then 5
    // (flips to active).
    await app.monitor.start();
    const postUids = await batchPrepareInbox(
      app,
      ['Post #1', 'Post #2', 'Post #3', 'Post #4', 'Post #5'],
    );

    const expectedCounter = [1, 2, 3, 4, 5];
    for (let i = 0; i < postUids.length; i++) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, postUids[i]);

      row = readRow(activityLog, p1Id);
      expect(row.signals_since_dismiss).toBe(expectedCounter[i]);
      if (i < 4) {
        expect(row.status).toBe('dismissed');
      } else {
        expect(row.status).toBe('active');
        expect(row.dismissed_at).toBeNull();
      }
    }

    // ---- Phase 4: resurfaced card with notice; matchingCount=7 ----
    listResp = await server.inject({ method: 'GET', url: '/api/proposed-rules' });
    cards = listResp.json() as ProposedRuleCard[];
    const resurfaced = cards.find((c) => c.id === p1Id);
    expect(resurfaced).toBeDefined();
    expect(resurfaced!.status).toBe('active');
    expect(resurfaced!.matchingCount).toBe(7);
    expect(resurfaced!.signalsSinceDismiss).toBe(5);
    expect(resurfaced!.resurfacedNotice).toBe(
      'Previously dismissed \u2014 5 new moves since then.',
    );
  }, 180_000);

  it('UC-006.a: re-dismiss after resurface resets counter, preserves matching_count', async () => {
    const { activityLog, proposalStore, app: server } = app;

    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(DESTINATION);

    const preUids = await batchPrepareInbox(app, ['Pre #1', 'Pre #2']);
    for (const uid of preUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    const p1Id = proposalStore.getProposals()[0].id;
    await server.inject({ method: 'POST', url: `/api/proposed-rules/${p1Id}/dismiss` });

    await app.monitor.start();
    const postUids = await batchPrepareInbox(
      app,
      ['Resurface #1', 'Resurface #2', 'Resurface #3', 'Resurface #4', 'Resurface #5'],
    );
    for (const uid of postUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    let row = readRow(activityLog, p1Id);
    expect(row.status).toBe('active');
    expect(row.matching_count).toBe(7);

    const reDismiss = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${p1Id}/dismiss`,
    });
    expect(reDismiss.statusCode).toBe(204);

    row = readRow(activityLog, p1Id);
    expect(row.status).toBe('dismissed');
    expect(row.dismissed_at).not.toBeNull();
    expect(row.signals_since_dismiss).toBe(0);
    expect(row.matching_count).toBe(7);
  }, 180_000);

  it('UC-006.b: approving a resurfaced proposal creates rule and freezes the row', async () => {
    const { activityLog, configRepo, proposalStore, app: server } = app;

    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(DESTINATION);

    const preUids = await batchPrepareInbox(app, ['Pre #1', 'Pre #2']);
    for (const uid of preUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    const p1Id = proposalStore.getProposals()[0].id;
    await server.inject({ method: 'POST', url: `/api/proposed-rules/${p1Id}/dismiss` });

    await app.monitor.start();
    const resurfaceUids = await batchPrepareInbox(
      app,
      ['Resurface #1', 'Resurface #2', 'Resurface #3', 'Resurface #4', 'Resurface #5'],
    );
    for (const uid of resurfaceUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }
    expect(readRow(activityLog, p1Id).status).toBe('active');

    const approveResp = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${p1Id}/approve`,
    });
    expect(approveResp.statusCode).toBe(200);
    const newRule = approveResp.json() as { id: string; match: { sender: string }; action: { type: string; folder: string } };
    expect(newRule.match.sender).toBe(SENDER);
    expect(newRule.action).toEqual({ type: 'move', folder: DESTINATION });
    expect(configRepo.getRules()).toHaveLength(1);

    let row = readRow(activityLog, p1Id);
    expect(row.status).toBe('approved');
    expect(row.approved_rule_id).toBe(newRule.id);
    const frozenMatching = row.matching_count;
    const frozenDestCounts = row.destination_counts;

    // One more user move from the same sender — proposal upsert must no-op.
    // We deliberately skip monitor.processNewMessages here because the freshly
    // approved rule would auto-file the message via Monitor's IX-001 path, so
    // there'd be nothing in INBOX to "manually" move. Sending and a baseline
    // scan-pair gives MoveTracker the snapshot it needs.
    await sendOne('Post-approval signal');
    await new Promise((r) => setTimeout(r, 500));
    await app.moveTracker.runScanForTest();
    const postApprovalUids = await listMailboxMessages('INBOX');
    expect(postApprovalUids).toHaveLength(1);
    await userMoveAndScan(app, 'INBOX', DESTINATION, postApprovalUids[0]);

    row = readRow(activityLog, p1Id);
    expect(row.status).toBe('approved');
    expect(row.approved_rule_id).toBe(newRule.id);
    expect(row.matching_count).toBe(frozenMatching);
    expect(row.destination_counts).toBe(frozenDestCounts);
  }, 180_000);

  it('UC-006.c: contradicting moves accumulate during dismissed window, dominant preserved', async () => {
    const { activityLog, imapClient, proposalStore, app: server } = app;

    await imapClient.createMailbox(READ_LATER).catch(() => {});

    // Seed BOTH destinations into the recent-folders activity so fast-pass
    // resolution succeeds for either folder during the dismissed window.
    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(DESTINATION);
    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(READ_LATER);

    const preUids = await batchPrepareInbox(app, ['Pre #1', 'Pre #2']);
    for (const uid of preUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    const p1Id = proposalStore.getProposals()[0].id;
    await server.inject({ method: 'POST', url: `/api/proposed-rules/${p1Id}/dismiss` });

    // 3 to Newsletters, 2 to Read later (interleaved); 5 signals total → resurface.
    await app.monitor.start();
    const postUids = await batchPrepareInbox(app, ['C1', 'C2', 'C3', 'C4', 'C5']);
    const dests = [DESTINATION, READ_LATER, DESTINATION, READ_LATER, DESTINATION];
    for (let i = 0; i < postUids.length; i++) {
      await userMoveAndScan(app, 'INBOX', dests[i], postUids[i]);
    }

    const row = readRow(activityLog, p1Id);
    expect(row.status).toBe('active');
    expect(row.signals_since_dismiss).toBe(5);
    const counts = JSON.parse(row.destination_counts) as Record<string, number>;
    expect(counts[DESTINATION]).toBe(5); // 2 pre + 3 post
    expect(counts[READ_LATER]).toBe(2);
    expect(row.destination_folder).toBe(DESTINATION);
    expect(row.matching_count).toBe(5);
    expect(row.contradicting_count).toBe(2);
  }, 180_000);

  it('UC-006.d: different envelope recipient creates a separate proposal, P1 untouched', async () => {
    const { activityLog, proposalStore, signalStore, patternDetector, app: server } = app;

    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, action, folder, success, source)
       VALUES (0, 'move', ?, 1, 'sweep')`,
    ).run(DESTINATION);

    const preUids = await batchPrepareInbox(app, ['Pre #1', 'Pre #2']);
    for (const uid of preUids) {
      await userMoveAndScan(app, 'INBOX', DESTINATION, uid);
    }

    const p1Id = proposalStore.getProposals()[0].id;
    await server.inject({ method: 'POST', url: `/api/proposed-rules/${p1Id}/dismiss` });
    const beforeRow = readRow(activityLog, p1Id);

    // GreenMail's basic SMTP doesn't expose envelope-recipient cleanly through
    // the production capture path, so synthesize the signal directly. The full
    // end-to-end resolution chain is exercised by every other test in this
    // file; here we only need to prove the proposal-key dimension treats
    // envelope_recipient as part of the identity (a different recipient =
    // different proposal, P1's dismissal state is untouched).
    const signalId = signalStore.logSignal({
      messageId: '<other-recipient@example.com>',
      sender: SENDER,
      envelopeRecipient: 'list-alias@example.com',
      subject: 'Different recipient',
      readStatus: 'unread',
      sourceFolder: 'INBOX',
      destinationFolder: DESTINATION,
    });
    patternDetector.processSignal({
      id: signalId,
      timestamp: new Date().toISOString(),
      messageId: '<other-recipient@example.com>',
      sender: SENDER,
      envelopeRecipient: 'list-alias@example.com',
      subject: 'Different recipient',
      readStatus: 'unread',
      sourceFolder: 'INBOX',
      destinationFolder: DESTINATION,
    });

    const allRows = activityLog.getDb()
      .prepare('SELECT * FROM proposed_rules ORDER BY id ASC').all() as ProposalRow[];
    expect(allRows).toHaveLength(2);
    const p2 = allRows.find((r) => r.id !== p1Id)!;
    expect(p2.matching_count).toBe(1);
    expect(p2.status).toBe('active');

    const afterP1 = readRow(activityLog, p1Id);
    expect(afterP1.status).toBe('dismissed');
    expect(afterP1.signals_since_dismiss).toBe(beforeRow.signals_since_dismiss);
    expect(afterP1.dismissed_at).toBe(beforeRow.dismissed_at);
    expect(afterP1.matching_count).toBe(beforeRow.matching_count);
  }, 180_000);

  it('UC-006.e: dismiss of non-existent proposal returns 404', async () => {
    const { app: server } = app;
    const res = await server.inject({
      method: 'POST',
      url: '/api/proposed-rules/9999/dismiss',
    });
    expect(res.statusCode).toBe(404);
  }, 30_000);

  it.todo('UC-006.f: Modify path — better covered by integration of POST /modify + POST /rules + POST /mark-approved');
});
