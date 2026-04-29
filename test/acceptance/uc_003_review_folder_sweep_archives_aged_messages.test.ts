/**
 * UC-003 — Review folder sweep archives aged messages by re-evaluating rules.
 *
 * Spec: specs/use-cases/uc-003-review-folder-sweep-archives-aged-messages.md
 *
 * End-to-end acceptance test. Real GreenMail IMAP, real ImapClient, real
 * Monitor, real ReviewSweeper, real ConfigRepository (writing to a temp YAML),
 * real ActivityLog SQLite. No mocks of production code.
 *
 * Integrations exercised:
 *   IX-001 — arrival detection / rule evaluation (Phase 1 review-action filing)
 *   IX-002 — action execution / activity logging
 *   IX-006 — review sweep eligibility, rule re-evaluation, age-based filing
 *
 * Variants:
 *   UC-003 main flow — read+aged message archives via second `move` rule.
 *   UC-003.a — unread message survives readMaxAgeDays, archives at unreadMaxAgeDays.
 *   UC-003.b — no matching rule falls back to defaultArchiveFolder.
 *   UC-003.c — sweep rule is `delete` → message goes to trashFolder.
 *   UC-003.d — covered by IX-011 hot-reload integration test (it.todo placeholder).
 *   UC-003.e — `skip` and bare `review` rules are filtered from sweep candidates.
 *   UC-003.f — sweep tick during disconnect is skipped, no state mutation.
 *   UC-003.g — concurrent sweep request is dropped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { ImapFlow } from 'imapflow';

import { ImapClient } from '../../src/imap/client.js';
import type { ImapFlowLike } from '../../src/imap/client.js';
import { Monitor } from '../../src/monitor/index.js';
import { ActivityLog } from '../../src/log/index.js';
import { ConfigRepository } from '../../src/config/repository.js';
import { saveConfig } from '../../src/config/loader.js';
import { ReviewSweeper } from '../../src/sweep/index.js';
import type { Config, Rule } from '../../src/config/schema.js';

import {
  sendTestEmail,
  waitForProcessed,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const SENDER = 'newsletter@example.com';
const HOST = 'localhost';
const IMAP_PORT = 3143;
const REVIEW_FOLDER = 'Review';
const NEWSLETTERS = 'Newsletters';
const DEFAULT_ARCHIVE = 'MailingLists';
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

interface AppHandle {
  configRepo: ConfigRepository;
  activityLog: ActivityLog;
  monitor: Monitor;
  imapClient: ImapClient;
  sweeper: ReviewSweeper;
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

  const imapClient = new ImapClient(config.imap, makeImapFlowFactory());
  await imapClient.connect();

  // Pre-create folders so neither arrival filing nor sweep moves race the
  // auto-create path.
  await imapClient.createMailbox(REVIEW_FOLDER).catch(() => {});
  await imapClient.createMailbox(NEWSLETTERS).catch(() => {});
  await imapClient.createMailbox(DEFAULT_ARCHIVE).catch(() => {});
  await imapClient.createMailbox(TRASH).catch(() => {});

  const monitor = new Monitor(config, { imapClient, activityLog, logger: silentLogger });

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
    sweeper.updateRules(rules);
  });

  await monitor.start();

  async function teardown() {
    await monitor.stop().catch(() => {});
    sweeper.stop();
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return { configRepo, activityLog, monitor, imapClient, sweeper, teardown };
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

/**
 * Replace the live message in `folder` with a backdated APPEND so
 * ReviewSweeper sees it as `daysAgo` days old. Mirrors UC-001.c phase 4-bis.
 */
async function backdateMessage(
  folder: string,
  uid: number,
  opts: { sender: string; subject: string; messageId: string; daysAgo: number; seen: boolean },
): Promise<void> {
  const internalDate = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
  const raw =
    `From: ${opts.sender}\r\n` +
    `To: user@localhost\r\n` +
    `Subject: ${opts.subject}\r\n` +
    `Message-ID: <${opts.messageId}>\r\n` +
    `\r\n` +
    `body\r\n`;

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
      await client.messageDelete([uid], { uid: true }).catch(() => {});
      const flags = opts.seen ? ['\\Seen'] : [];
      await client.append(folder, raw, flags, internalDate);
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

function ruleInput(input: Omit<Rule, 'id' | 'order'> & { order?: number }): Omit<Rule, 'id'> {
  return {
    enabled: true,
    order: 0,
    ...input,
  };
}

describe('UC-003: Review folder sweep archives aged messages', () => {
  let tmpDir: string;
  let app: AppHandle;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-003-'));
    await clearMailboxes();
    await emptyAndDeleteFolder(REVIEW_FOLDER);
    await emptyAndDeleteFolder(NEWSLETTERS);
    await emptyAndDeleteFolder(DEFAULT_ARCHIVE);
    await emptyAndDeleteFolder(TRASH);
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    await emptyAndDeleteFolder(REVIEW_FOLDER);
    await emptyAndDeleteFolder(NEWSLETTERS);
    await emptyAndDeleteFolder(DEFAULT_ARCHIVE);
    await emptyAndDeleteFolder(TRASH);
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('main flow: review-filed message read + aged → sweep moves to Newsletters via second rule', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    const reviewRule = configRepo.addRule(
      ruleInput({
        name: 'Review newsletters',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );

    // ---------------- Phase 1: arrival → review folder ----------------
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Issue #1',
      body: 'first issue',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const arrivalEntry = await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === reviewRule.id &&
        e.action === 'review' &&
        e.folder === REVIEW_FOLDER &&
        e.success === 1,
    });
    expect(arrivalEntry.source).toBe('arrival');

    const reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    expect(reviewUids).toHaveLength(1);

    // ---------------- Phase 2: user reads message in Review ----------------
    await setSeenFlag(REVIEW_FOLDER, reviewUids[0]);

    // Stop monitor before mutating Review out-of-band so IDLE doesn't fight
    // our APPEND/DELETE.
    await monitor.stop();

    // ---------------- Phase 3: backdate + add second move rule ----------------
    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Issue #1',
      messageId: 'uc003-main-1@example.com',
      daysAgo: 8,
      seen: true,
    });

    const moveRule = configRepo.addRule(
      ruleInput({
        name: 'Move newsletters',
        match: { sender: SENDER },
        action: { type: 'move', folder: NEWSLETTERS },
        order: configRepo.nextOrder(),
      }),
    );

    // ---------------- Phase 4: sweep ----------------
    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'move' &&
        e.folder === NEWSLETTERS &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBe(moveRule.id);

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(1);

    const state = sweeper.getState();
    expect(state.lastSweep).not.toBeNull();
    expect(state.lastSweep!.messagesArchived).toBe(1);
    expect(state.lastSweep!.errors).toBe(0);
  }, 60_000);

  it('UC-003.a: unread message survives readMaxAgeDays, archives after unreadMaxAgeDays', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Review newsletters',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );
    const moveRule = configRepo.addRule(
      ruleInput({
        name: 'Move newsletters',
        match: { sender: SENDER },
        action: { type: 'move', folder: NEWSLETTERS },
        order: configRepo.nextOrder(),
      }),
    );

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Unread Issue',
      body: 'never read',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.action === 'review' && e.folder === REVIEW_FOLDER && e.success === 1,
    });

    let reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    expect(reviewUids).toHaveLength(1);

    await monitor.stop();

    // 8 days old, unread → above readMaxAgeDays (7) but below unreadMaxAgeDays (14).
    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Unread Issue',
      messageId: 'uc003-a-1@example.com',
      daysAgo: 8,
      seen: false,
    });

    await sweeper.runSweep();

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(1);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(0);
    expect(sweeper.getState().lastSweep!.messagesArchived).toBe(0);

    // Backdate further: 15 days, still unread → now eligible.
    reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Unread Issue',
      messageId: 'uc003-a-2@example.com',
      daysAgo: 15,
      seen: false,
    });

    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'move' &&
        e.folder === NEWSLETTERS &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBe(moveRule.id);
    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(1);
    expect(sweeper.getState().lastSweep!.messagesArchived).toBe(1);
  }, 60_000);

  it('UC-003.b: no matching rule → defaultArchiveFolder, activity rule_id is null', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    const reviewRule = configRepo.addRule(
      ruleInput({
        name: 'Review newsletters',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );
    const moveRule = configRepo.addRule(
      ruleInput({
        name: 'Move newsletters',
        match: { sender: SENDER },
        action: { type: 'move', folder: NEWSLETTERS },
        order: configRepo.nextOrder(),
      }),
    );

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Fallback Issue',
      body: 'fallback',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === reviewRule.id && e.folder === REVIEW_FOLDER && e.success === 1,
    });

    const reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    await setSeenFlag(REVIEW_FOLDER, reviewUids[0]);
    await monitor.stop();

    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Fallback Issue',
      messageId: 'uc003-b-1@example.com',
      daysAgo: 8,
      seen: true,
    });

    // Remove the only sweep candidate. The lone surviving rule is `review`
    // which gets filtered from sweep candidates → fallback to default.
    expect(configRepo.deleteRule(moveRule.id)).toBe(true);

    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'move' &&
        e.folder === DEFAULT_ARCHIVE &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBeFalsy();

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(DEFAULT_ARCHIVE)).toHaveLength(1);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(0);
  }, 60_000);

  it('UC-003.c: sweep rule is `delete` → trashFolder, action=delete', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Review newsletters',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );
    const deleteRule = configRepo.addRule(
      ruleInput({
        name: 'Delete newsletters',
        match: { sender: SENDER },
        action: { type: 'delete' },
        order: configRepo.nextOrder(),
      }),
    );

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Delete me',
      body: 'trash',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.action === 'review' && e.folder === REVIEW_FOLDER && e.success === 1,
    });

    const reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    await setSeenFlag(REVIEW_FOLDER, reviewUids[0]);
    await monitor.stop();

    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Delete me',
      messageId: 'uc003-c-1@example.com',
      daysAgo: 8,
      seen: true,
    });

    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'delete' &&
        e.folder === TRASH &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBe(deleteRule.id);

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(TRASH)).toHaveLength(1);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(0);
  }, 60_000);

  it.todo(
    'UC-003.d: config change triggers sweeper restart — covered by IX-011 hot-reload integration test',
  );

  it('UC-003.e: skip and bare review rules are excluded → move rule wins', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    // Order matters: skip first, bare review next, move last. The first two
    // would intercept arrival/sweep evaluation if not filtered. The skip rule
    // would also be the one that matched arrival evaluation, so we instead
    // file the message manually via the bare review rule's downstream side.
    // For UC-003.e the important assertion is sweep behavior: skip + bare
    // review get filtered, move wins. Use a single bare-review rule for
    // arrival filing (skip would suppress filing entirely, which is its own
    // path), then add the skip rule before sweep.
    const bareReview = configRepo.addRule(
      ruleInput({
        name: 'Bare review',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );
    const moveRule = configRepo.addRule(
      ruleInput({
        name: 'Move newsletters',
        match: { sender: SENDER },
        action: { type: 'move', folder: NEWSLETTERS },
        order: configRepo.nextOrder(),
      }),
    );

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Filtered',
      body: 'filtered',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === bareReview.id && e.folder === REVIEW_FOLDER && e.success === 1,
    });

    const reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    await setSeenFlag(REVIEW_FOLDER, reviewUids[0]);
    await monitor.stop();

    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Filtered',
      messageId: 'uc003-e-1@example.com',
      daysAgo: 8,
      seen: true,
    });

    // Now insert skip rule at the highest priority (lowest order) by pushing
    // existing rules down. This is the spec setup: skip > bare-review > move.
    // The sweep filter should drop the first two; move wins.
    configRepo.reorderRules([
      { id: bareReview.id, order: 1 },
      { id: moveRule.id, order: 2 },
    ]);
    configRepo.addRule(
      ruleInput({
        name: 'Skip newsletters',
        match: { sender: SENDER },
        action: { type: 'skip' },
        order: 0,
      }),
    );

    await sweeper.runSweep();

    const sweepEntry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.action === 'move' &&
        e.folder === NEWSLETTERS &&
        e.source === 'sweep' &&
        e.success === 1,
    });
    expect(sweepEntry.rule_id).toBe(moveRule.id);

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(1);
  }, 60_000);

  it('UC-003.f: sweep tick during disconnect is skipped, no state mutation', async () => {
    const { imapClient, sweeper } = app;

    const stateBefore = sweeper.getState();
    expect(stateBefore.lastSweep).toBeNull();

    // disconnect() flips client.state to 'disconnected' and turns off
    // autoReconnect, so runSweep's `state !== 'connected'` guard triggers.
    await imapClient.disconnect();
    expect(imapClient.state).not.toBe('connected');

    await sweeper.runSweep();

    // lastSweep must still be null — no state mutation when the early-return
    // guard fires.
    expect(sweeper.getState().lastSweep).toBeNull();

    // Reconnect so the afterEach teardown's disconnect() doesn't fail (it's
    // idempotent, but reconnecting also exercises the path more honestly).
    await imapClient.connect();
  }, 60_000);

  it('UC-003.g: concurrent sweep request is dropped', async () => {
    const { configRepo, activityLog, monitor, sweeper } = app;

    configRepo.addRule(
      ruleInput({
        name: 'Review newsletters',
        match: { sender: SENDER },
        action: { type: 'review' },
        order: configRepo.nextOrder(),
      }),
    );
    configRepo.addRule(
      ruleInput({
        name: 'Move newsletters',
        match: { sender: SENDER },
        action: { type: 'move', folder: NEWSLETTERS },
        order: configRepo.nextOrder(),
      }),
    );

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Concurrent',
      body: 'concurrent',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.action === 'review' && e.folder === REVIEW_FOLDER && e.success === 1,
    });

    const reviewUids = await listMailboxMessages(REVIEW_FOLDER);
    await setSeenFlag(REVIEW_FOLDER, reviewUids[0]);
    await monitor.stop();

    await backdateMessage(REVIEW_FOLDER, reviewUids[0], {
      sender: SENDER,
      subject: 'Concurrent',
      messageId: 'uc003-g-1@example.com',
      daysAgo: 8,
      seen: true,
    });

    // Fire two sweeps in parallel. The `running` guard in runSweep should
    // make exactly one of them do real work.
    const results = await Promise.all([sweeper.runSweep(), sweeper.runSweep()]);
    expect(results).toHaveLength(2);

    // Only one sweep activity entry should exist — the second invocation
    // returns early before fetching/moving anything.
    const sweepMoves = activityLog
      .getRecentActivity(100)
      .filter((e) => e.source === 'sweep' && e.action === 'move' && e.success === 1);
    expect(sweepMoves).toHaveLength(1);

    expect(await listMailboxMessages(REVIEW_FOLDER)).toHaveLength(0);
    expect(await listMailboxMessages(NEWSLETTERS)).toHaveLength(1);
    expect(sweeper.getState().lastSweep!.messagesArchived).toBe(1);
  }, 60_000);
});
