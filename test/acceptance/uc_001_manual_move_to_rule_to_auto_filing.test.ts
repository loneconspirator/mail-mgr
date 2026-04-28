/**
 * UC-001 — Manual move creates proposed rule, which auto-files future
 * messages after approval.
 *
 * Spec: specs/use-cases/uc-001-manual-move-to-rule-to-auto-filing.md
 *
 * This is an end-to-end acceptance test. It exercises the full user-facing
 * flow against a live IMAP server (GreenMail) and the real production
 * components — no module-level mocking. The five spec phases are mapped to
 * sub-tests below; sub-variants (UC-001.a, .b, .c, .d) are TODOs.
 *
 * Integrations exercised:
 *   IX-001 arrival detection / rule evaluation
 *   IX-002 action execution / activity logging
 *   IX-003 user-move detection / destination resolution
 *   IX-004 signal logging / proposal creation
 *   IX-005 proposal approval / rule creation
 *   IX-006 review-sweep filing (referenced; UC-001.c only)
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
  waitForProcessed,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const SENDER = 'digest@example.com';
const DESTINATION = 'Newsletters';
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

/**
 * Bring up a complete app instance for one test:
 *  - real GreenMail-backed ImapClient
 *  - real SQLite for ActivityLog/SignalStore/ProposalStore
 *  - real ConfigRepository writing to a temp YAML file
 *  - real Fastify server (used to drive the approval API)
 *
 * Returns a teardown function. Sentinel + ActionFolderPoller are intentionally
 * skipped — UC-001 doesn't require them, and starting them slows the test.
 */
async function bringUpApp(tmpDir: string) {
  // Config file
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

  // Pre-create destination folder so the user-side move (and later auto-move)
  // both succeed. Mirrors the spec precondition: "the user has a destination
  // folder (e.g. 'Newsletters') already created."
  await imapClient.createMailbox(DESTINATION).catch(() => {
    // already exists — fine
  });
  // MoveTracker also scans the Review folder; GreenMail doesn't auto-create it.
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
    scanIntervalMs: 60_000, // we drive scans manually
    enabled: false, // disable timer; we'll call runScanForTest()
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

  // Wire monitor to pick up rule changes so phase 4 sees the new rule.
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
    staticRoot: tmpDir, // no real static files needed for API tests
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
    monitor,
    moveTracker,
    imapClient,
    app,
    teardown,
  };
}

/**
 * Simulate the user moving a message via their mail client. Uses an
 * independent ImapFlow connection so it does not show up in the system's
 * activity log (the discriminator MoveTracker uses to distinguish user
 * vs. system moves).
 */
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

async function setSeenFlag(folder: string, uid: number): Promise<void> {
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
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function getMessageFlags(folder: string, uid: number): Promise<Set<string>> {
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
    const lock = await client.getMailboxLock(folder);
    try {
      for await (const msg of client.fetch(
        [uid],
        { uid: true, flags: true },
        { uid: true },
      )) {
        const m = msg as { flags?: Set<string> };
        return m.flags ?? new Set<string>();
      }
      return new Set<string>();
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
      // folder might not exist — fine
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

describe('UC-001: Manual move → proposed rule → auto-filing', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof bringUpApp>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-001-'));
    // Reset GreenMail state so we don't inherit messages from previous runs.
    await clearMailboxes();
    await emptyAndDeleteFolder(DESTINATION);
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    await emptyAndDeleteFolder(DESTINATION);
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('main flow: first message is user-moved, proposal is approved, second message auto-files', async () => {
    const { configRepo, activityLog, proposalStore, monitor, moveTracker, app: server } = app;
    // (Test budget: ~120s. The MoveTracker scans across INBOX + Review use
    // withMailboxSwitch, which cycles IDLE on each call; that accounts for
    // most of the wall time on GreenMail.)

    // ---------------- Phase 1: First message arrives, no rule matches ----------------
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #42',
      body: 'first issue',
    });

    // GreenMail does not always push IDLE EXISTS; nudge the monitor.
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    let inbox = await listMailboxMessages('INBOX');
    expect(inbox).toHaveLength(1);
    const firstUid = inbox[0];

    // No rule matched → no `move` activity logged for this message.
    const earlyMoves = activityLog
      .getRecentActivity(100)
      .filter((e) => e.action === 'move' && e.message_uid === firstUid);
    expect(earlyMoves).toHaveLength(0);

    // ---------------- Phase 2: User moves the message; system detects + proposes ----------------

    // The destination resolver's fast pass searches "recent folders" from the
    // activity log + a hardcoded short list of common names. The main flow
    // depends on fast-pass succeeding (variant UC-001.a is the deep-scan
    // path). Seed one historical sweep entry pointing at Newsletters so it
    // shows up in getRecentFolders() — this represents a realistic mailbox
    // where the user has used this folder before.
    activityLog
      .getDb()
      .prepare(
        `INSERT INTO activity (message_uid, action, folder, success, source)
         VALUES (0, 'move', ?, 1, 'sweep')`,
      )
      .run(DESTINATION);

    // Stop the monitor's IDLE/poll loop so it doesn't contend with
    // MoveTracker's scans for the INBOX mailbox lock during destination
    // resolution. We'll restart it before phase 4.
    await monitor.stop();

    // Baseline scan #0 — captures the message in INBOX before the move.
    await moveTracker.runScanForTest();

    // User drags message from INBOX → Newsletters via their mail client.
    await userMovesMessage('INBOX', DESTINATION, firstUid);

    // Confirm the move actually landed.
    expect(await listMailboxMessages('INBOX')).toHaveLength(0);
    expect(await listMailboxMessages(DESTINATION)).toHaveLength(1);

    // Two-scan confirmation:
    //   Scan #1 — observes disappearance, marks pending.
    //   Scan #2 — confirms still missing, fast-pass resolution finds the
    //             message in Newsletters, logs the signal, and the
    //             PatternDetector creates the proposal.
    await moveTracker.runScanForTest();
    await moveTracker.runScanForTest();

    const proposalsAfterMove = proposalStore.getProposals();
    expect(proposalsAfterMove).toHaveLength(1);
    expect(proposalsAfterMove[0]).toMatchObject({
      sender: SENDER,
      destinationFolder: DESTINATION,
      sourceFolder: 'INBOX',
      matchingCount: 1,
      contradictingCount: 0,
      status: 'active',
    });

    // ---------------- Phase 3: User approves the proposal via the API ----------------

    // The UI does GET /api/proposed-rules first; verify the proposal is there
    // labeled "Weak (1 move)" as the spec describes.
    const listResp = await server.inject({ method: 'GET', url: '/api/proposed-rules' });
    expect(listResp.statusCode).toBe(200);
    const cards = listResp.json() as ProposedRuleCard[];
    expect(cards).toHaveLength(1);
    expect(cards[0].sender).toBe(SENDER);
    expect(cards[0].strengthLabel).toMatch(/weak/i);

    const proposalId = cards[0].id;
    const approveResp = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${proposalId}/approve`,
    });
    expect(approveResp.statusCode).toBe(200);
    const newRule = approveResp.json() as { id: string; match: { sender: string }; action: { type: string; folder: string } };
    expect(newRule.match.sender).toBe(SENDER);
    expect(newRule.action).toEqual({ type: 'move', folder: DESTINATION });

    // Proposal is now approved; rule is in config.
    const refreshed = proposalStore.getById(proposalId);
    expect(refreshed?.status).toBe('approved');
    expect(refreshed?.approvedRuleId).toBe(newRule.id);

    const persistedRules = configRepo.getRules();
    expect(persistedRules).toHaveLength(1);
    expect(persistedRules[0].id).toBe(newRule.id);

    // The onRulesChange listener pushed the updated rule set into Monitor.
    // Restart it now (we paused it during phase 2 to avoid lock contention).
    await monitor.start();

    // ---------------- Phase 4: Second message arrives, rule auto-files it ----------------

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #43',
      body: 'second issue',
    });

    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const autoMoveEntry = await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === newRule.id &&
        e.action === 'move' &&
        e.folder === DESTINATION &&
        e.success === 1,
    });
    expect(autoMoveEntry.source).toBe('arrival');
    expect(autoMoveEntry.message_subject).toBe('Weekly Digest #43');

    // ---------------- Expected outcome ----------------

    // Two messages now live in Newsletters: one from phase 2 (user move),
    // one from phase 4 (auto-file).
    const newsletters = await listMailboxMessages(DESTINATION);
    expect(newsletters).toHaveLength(2);

    // INBOX is empty.
    inbox = await listMailboxMessages('INBOX');
    expect(inbox).toHaveLength(0);

    // Activity log contains exactly one auto-move entry referencing the rule.
    const ruleMoves = activityLog
      .getRecentActivity(100)
      .filter((e) => e.rule_id === newRule.id && e.action === 'move');
    expect(ruleMoves).toHaveLength(1);

    // ---------------- Phase 5: User reads the message ----------------

    const newsletterUids = await listMailboxMessages(DESTINATION);
    const secondUid = newsletterUids[newsletterUids.length - 1];
    await setSeenFlag(DESTINATION, secondUid);

    const flags = await getMessageFlags(DESTINATION, secondUid);
    expect(flags.has('\\Seen')).toBe(true);
  }, 120_000);

  it('UC-001.d: multiple moves strengthen proposal to "Strong" before approval', async () => {
    const { activityLog, proposalStore, monitor, moveTracker, app: server } = app;

    // 5 messages → strength=5 → "Strong" label per src/web/routes/proposed-rules.ts
    // (spec says 4, but the strength threshold for "Strong" in code is >4).
    const SUBJECTS = [
      'Weekly Digest #42',
      'Weekly Digest #43',
      'Weekly Digest #44',
      'Weekly Digest #45',
      'Weekly Digest #46',
    ];

    // Send all 5 messages first so they're all in INBOX.
    for (const subject of SUBJECTS) {
      await sendTestEmail({ from: SENDER, to: 'user@localhost', subject, body: 'issue' });
    }
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const inboxUids = await listMailboxMessages('INBOX');
    expect(inboxUids).toHaveLength(5);

    // Seed Newsletters in recent-folders so fast-pass resolution succeeds for each.
    activityLog
      .getDb()
      .prepare(
        `INSERT INTO activity (message_uid, action, folder, success, source)
         VALUES (0, 'move', ?, 1, 'sweep')`,
      )
      .run(DESTINATION);

    // Stop monitor so it doesn't fight MoveTracker for the INBOX lock.
    await monitor.stop();

    // Baseline scan: snapshot INBOX with all 5 messages.
    await moveTracker.runScanForTest();

    // User moves each message manually. Run two scans after each move so
    // MoveTracker's two-scan confirmation window fires per move and the
    // PatternDetector increments matchingCount each time. The 500ms pauses
    // let the shared ImapClient settle between the user-side ImapFlow
    // operations and the MoveTracker scans (otherwise IDLE recycling races
    // with the scan's mailbox lock and the scan silently no-ops).
    for (const uid of inboxUids) {
      await userMovesMessage('INBOX', DESTINATION, uid);
      await new Promise((r) => setTimeout(r, 500));
      await moveTracker.runScanForTest();
      await new Promise((r) => setTimeout(r, 500));
      await moveTracker.runScanForTest();
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(await listMailboxMessages('INBOX')).toHaveLength(0);
    expect(await listMailboxMessages(DESTINATION)).toHaveLength(5);

    const proposals = proposalStore.getProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      sender: SENDER,
      destinationFolder: DESTINATION,
      matchingCount: 5,
      contradictingCount: 0,
      status: 'active',
    });

    // The card surfaced to the UI labels the proposal "Strong".
    const listResp = await server.inject({ method: 'GET', url: '/api/proposed-rules' });
    expect(listResp.statusCode).toBe(200);
    const cards = listResp.json() as ProposedRuleCard[];
    expect(cards).toHaveLength(1);
    expect(cards[0].matchingCount).toBe(5);
    expect(cards[0].strengthLabel).toMatch(/strong/i);
  }, 180_000);

  it('UC-001.b: approval blocked by shadow conflict, then resolved with insertBefore', async () => {
    const { configRepo, activityLog, proposalStore, monitor, moveTracker, app: server } = app;

    // Phases 1+2 with no rules — produce the digest@example.com proposal.
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #42',
      body: 'first issue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const inbox = await listMailboxMessages('INBOX');
    const firstUid = inbox[0];

    activityLog
      .getDb()
      .prepare(
        `INSERT INTO activity (message_uid, action, folder, success, source)
         VALUES (0, 'move', ?, 1, 'sweep')`,
      )
      .run(DESTINATION);

    await monitor.stop();
    await moveTracker.runScanForTest();
    await userMovesMessage('INBOX', DESTINATION, firstUid);
    await new Promise((r) => setTimeout(r, 500));
    await moveTracker.runScanForTest();
    await new Promise((r) => setTimeout(r, 500));
    await moveTracker.runScanForTest();

    const proposals = proposalStore.getProposals();
    expect(proposals).toHaveLength(1);
    const proposalId = proposals[0].id;

    // Now add a broader pre-existing rule that shadows this proposal's sender.
    // (Per spec UC-001.b: "an existing rule with a broader sender pattern
    // already matches this sender at higher priority.")
    const broadRule = configRepo.addRule({
      name: 'Broad example.com',
      match: { sender: '*@example.com' },
      action: { type: 'move', folder: 'Misc' },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    // First approval attempt: blocked by shadow conflict (409).
    const blocked = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${proposalId}/approve`,
    });
    expect(blocked.statusCode).toBe(409);
    const blockedBody = blocked.json() as { error: string; conflict: { type: string; rule: { id: string } } };
    expect(blockedBody.conflict.type).toBe('shadow');
    expect(blockedBody.conflict.rule.id).toBe(broadRule.id);

    // Proposal should remain active; no rule was created.
    expect(proposalStore.getById(proposalId)?.status).toBe('active');
    expect(configRepo.getRules()).toHaveLength(1);

    // Retry with insertBefore=broadRule.id — places new rule above and bumps
    // the conflicting rule's order by 1. (Capture original order BEFORE the
    // call: configRepo.getRules() returns live references that are mutated
    // by reorderRules.)
    const broadOrderBefore = broadRule.order;
    const ok = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${proposalId}/approve?insertBefore=${broadRule.id}`,
    });
    expect(ok.statusCode).toBe(200);
    const newRule = ok.json() as { id: string; order: number };

    const rulesAfter = configRepo.getRules();
    expect(rulesAfter).toHaveLength(2);
    // Broad rule got bumped up by 1; new rule is in the freed slot.
    const broadAfter = rulesAfter.find((r) => r.id === broadRule.id)!;
    const newAfter = rulesAfter.find((r) => r.id === newRule.id)!;
    expect(broadAfter.order).toBe(broadOrderBefore + 1);
    expect(newAfter).toBeDefined();

    expect(proposalStore.getById(proposalId)?.status).toBe('approved');
  }, 120_000);

  it('UC-001.a: user move detected via deep scan (fast-pass miss)', async () => {
    const { proposalStore, monitor, moveTracker, imapClient } = app;

    // Use a destination folder that is NOT in COMMON_FOLDERS and is NOT in
    // the activity log's recent folders list. That forces resolveFast() to
    // return null and the message lands in pendingDeepScan.
    const DEEP_DEST = 'CustomArchive';
    await imapClient.createMailbox(DEEP_DEST).catch(() => {});

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #42',
      body: 'first issue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const inbox = await listMailboxMessages('INBOX');
    const firstUid = inbox[0];

    // Note: deliberately NOT seeding a recent-folder activity entry for
    // DEEP_DEST. The fast pass should fail.

    await monitor.stop();
    await moveTracker.runScanForTest();
    await userMovesMessage('INBOX', DEEP_DEST, firstUid);
    await new Promise((r) => setTimeout(r, 500));
    await moveTracker.runScanForTest();
    await new Promise((r) => setTimeout(r, 500));
    await moveTracker.runScanForTest();

    // Sanity: the user move actually moved the message.
    expect(await listMailboxMessages('INBOX')).toHaveLength(0);
    expect(await listMailboxMessages(DEEP_DEST)).toHaveLength(1);

    // Fast pass must have missed → no proposal yet.
    expect(proposalStore.getProposals()).toHaveLength(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(1);

    // Deep scan resolves the destination by listing all folders.
    const result = await moveTracker.triggerDeepScan();
    expect(result.resolved).toBe(1);

    const proposals = proposalStore.getProposals();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      sender: SENDER,
      destinationFolder: DEEP_DEST,
      sourceFolder: 'INBOX',
      matchingCount: 1,
      status: 'active',
    });

    await emptyAndDeleteFolder(DEEP_DEST);
  }, 120_000);

  it('UC-001.c: rule action is `review`, ReviewSweeper files after readMaxAgeDays', async () => {
    const { configRepo, activityLog, proposalStore, monitor, moveTracker, imapClient, app: server } = app;
    const REVIEW_FOLDER = configRepo.getReviewConfig().folder;

    // Phases 1+2: produce a proposal exactly like the main flow.
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #42',
      body: 'first issue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();
    const firstUid = (await listMailboxMessages('INBOX'))[0];

    activityLog
      .getDb()
      .prepare(
        `INSERT INTO activity (message_uid, action, folder, success, source)
         VALUES (0, 'move', ?, 1, 'sweep')`,
      )
      .run(DESTINATION);

    await monitor.stop();
    await moveTracker.runScanForTest();
    await userMovesMessage('INBOX', DESTINATION, firstUid);
    await moveTracker.runScanForTest();
    await moveTracker.runScanForTest();

    const proposals = proposalStore.getProposals();
    expect(proposals).toHaveLength(1);
    const proposalId = proposals[0].id;

    // Phase 3 alt: approve as `review` action (asReview=true).
    const approveResp = await server.inject({
      method: 'POST',
      url: `/api/proposed-rules/${proposalId}/approve?asReview=true`,
    });
    expect(approveResp.statusCode).toBe(200);
    const newRule = approveResp.json() as { id: string; action: { type: string; folder?: string } };
    expect(newRule.action.type).toBe('review');
    expect(newRule.action.folder).toBe(DESTINATION);

    await monitor.start();

    // Phase 4 alt: arrival lands the message in Review (not Newsletters yet).
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Weekly Digest #43',
      body: 'second issue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === newRule.id &&
        e.action === 'review' &&
        e.folder === REVIEW_FOLDER &&
        e.success === 1,
    });
    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(1);
    expect(await listMailboxMessages(DESTINATION)).toHaveLength(1); // only the user-move from phase 2

    // Stop monitor before mutating Review folder so it doesn't pick up our
    // backdated message via IDLE.
    await monitor.stop();

    // Phase 4-bis: simulate the message having sat in Review long enough for
    // sweep eligibility. ReviewSweeper uses `internalDate`; rather than wait
    // 7 days, replace the message with a backdated APPEND. The sender + subject
    // are preserved so the rule still matches during sweep.
    const reviewUidBefore = (await listMailboxMessages(REVIEW_FOLDER))[0];
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const raw =
      `From: ${SENDER}\r\n` +
      `To: user@localhost\r\n` +
      `Subject: Weekly Digest #43\r\n` +
      `Message-ID: <backdated-43@example.com>\r\n` +
      `\r\n` +
      `second issue\r\n`;

    // Delete the live message and append a backdated copy (with \Seen set —
    // spec phase 5: user has read it).
    await (async () => {
      const c = new ImapFlow({
        host: HOST,
        port: IMAP_PORT,
        secure: false,
        auth: { user: 'user', pass: 'pass' },
        logger: false,
        doSTARTTLS: false,
      });
      await c.connect();
      const lock = await c.getMailboxLock(REVIEW_FOLDER);
      try {
        await c.messageDelete([reviewUidBefore], { uid: true });
        await c.append(REVIEW_FOLDER, raw, ['\\Seen'], eightDaysAgo);
      } finally {
        lock.release();
      }
      await c.logout().catch(() => {});
    })();

    // Phase 4-ter: ReviewSweeper picks up the backdated, seen message,
    // re-evaluates rules (still our `review` rule), and moves to Newsletters.
    const sweeper = new ReviewSweeper({
      client: imapClient,
      activityLog,
      rules: configRepo.getRules(),
      reviewConfig: configRepo.getReviewConfig(),
      trashFolder: configRepo.getReviewConfig().trashFolder,
      logger: silentLogger,
    });
    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'move' &&
        e.folder === DESTINATION &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBe(newRule.id);

    // Review is now empty, Newsletters has both messages.
    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(DESTINATION)).toHaveLength(2);
  }, 180_000);
});
