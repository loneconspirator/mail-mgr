/**
 * UC-002 — Dragging a message into an action folder creates or removes a
 * sender rule.
 *
 * Spec: specs/use-cases/uc-002-action-folder-drag-creates-or-removes-rule.md
 *
 * End-to-end acceptance test. Runs against a live IMAP server (GreenMail) and
 * exercises the full production wiring: ActionFolderPoller, ActionFolderProcessor,
 * ConfigRepository, ImapClient, ActivityLog, Monitor, and the rule evaluator
 * for the "future message bypasses review" phase.
 *
 * Integrations exercised:
 *   IX-001 — arrival detection / rule evaluation (Phase 3 of main flow)
 *   IX-007 — action folder polling and message dispatch
 *   IX-008 — action folder rule mutation and recovery
 *
 * IX-007 named-interaction coverage (mapped to it() blocks below):
 *   IX-007.1 — manual scanAll() stands in for the timer tick; the single-flight
 *              guard is exercised in test/unit/action-folders/poller.test.ts
 *              ("scanAll - overlap guard").
 *   IX-007.2 — every test runs with enabled=true; the disabled path is covered
 *              by the unit suite ("skips processing if config.enabled is false").
 *   IX-007.3 — main flow + UC-002.a + UC-002.b + UC-002.c collectively touch
 *              all four resolved folder paths (vip / block / undoVip / unblock).
 *   IX-007.4 — every test: untouched folders sit at count==1 (sentinel only)
 *              and are skipped; the touched folder reaches count>1.
 *   IX-007.5 — every test that appends/drags a message: poller fetches and
 *              dispatches it to the processor with the resolved actionType.
 *   IX-007.6 — sentinels live in every action folder for the full run; the
 *              processor's sentinel guard fires for every dispatched message
 *              (see IX-008.1).
 *   IX-007.7 — recheck-after-process happens on every non-empty folder; the
 *              warn+retry branch is covered by the unit suite ("retries once
 *              if messages remain after first processing pass").
 *   IX-007.8 — per-folder error isolation is covered by the unit suite
 *              ("continues to next folder when one folder errors").
 *
 * IX-008 named-interaction coverage:
 *   IX-008.1  — every test: sentinels remain in their folders and are not
 *               misinterpreted as user actions.
 *   IX-008.2  — main flow (parsed sender) + UC-002.f (unparseable recovery).
 *   IX-008.3  — every test resolves an actionType through ACTION_REGISTRY.
 *   IX-008.4  — UC-002.d (existing Block rule replaced by VIP create).
 *   IX-008.5  — main flow (skip rule) + UC-002.a (delete rule).
 *   IX-008.6  — UC-002.b + UC-002.c (matching rule removed) + UC-002.g
 *               (no matching rule, still clears folder).
 *   IX-008.7  — UC-002.e (multi-field rule preserved).
 *   IX-008.8  — main flow (destination=INBOX) + UC-002.a (destination=trash).
 *   IX-008.9  — every test: dragged message leaves the action folder.
 *   IX-008.10 — main flow + UC-002.a + UC-002.d assert ActivityLog entries
 *               with source='action-folder'.
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
import {
  ActionFolderPoller,
  ActionFolderProcessor,
} from '../../src/action-folders/index.js';
import { appendSentinel } from '../../src/sentinel/index.js';
import type { Config, Rule } from '../../src/config/schema.js';

import {
  sendTestEmail,
  waitForProcessed,
  waitForMailboxMessage,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from '../integration/helpers.js';

const HOST = 'localhost';
const IMAP_PORT = 3143;
const INBOX = 'INBOX';
const TRASH = 'Trash';
const PREFIX = 'Actions';
const VIP_FOLDER = `${PREFIX}/VIP`;
const BLOCK_FOLDER = `${PREFIX}/Block`;
const UNDO_VIP_FOLDER = `${PREFIX}/UndoVIP`;
const UNBLOCK_FOLDER = `${PREFIX}/Unblock`;

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
 * Spin up the production wiring needed for UC-002:
 *  - real GreenMail-backed ImapClient
 *  - real SQLite ActivityLog + ConfigRepository
 *  - real ActionFolderPoller wired to real ActionFolderProcessor
 *  - real Monitor (for the "future arrival" phase of the main flow)
 *
 * Returns a teardown function. The poller's interval timer is created but we
 * call scanAll() directly so the test is deterministic — the timer would fire
 * lazily and we'd race against it.
 */
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
      moveTracking: { enabled: false, scanInterval: 30 },
    },
    actionFolders: {
      enabled: true,
      prefix: PREFIX,
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

  const imapClient = new ImapClient(config.imap, makeImapFlowFactory());
  await imapClient.connect();

  // Trash needs to exist for Block / Unblock destinations.
  await imapClient.createMailbox(TRASH).catch(() => {});

  // Create the four action folders. We pass each path as a single string so
  // GreenMail (which uses '.' as its hierarchy delimiter) creates them as
  // literal flat folders named "Actions/VIP" etc. — matching the '/'-form
  // path that ActionFolderPoller and ActionFolderProcessor pass to the IMAP
  // client. Going through ensureActionFolders' array-form mailboxCreate
  // would split on the delimiter and produce "Actions.VIP", which the
  // poller's `client.status('Actions/VIP')` call cannot then find.
  for (const folder of [VIP_FOLDER, BLOCK_FOLDER, UNDO_VIP_FOLDER, UNBLOCK_FOLDER]) {
    await imapClient.createMailbox(folder).catch(() => {});
  }
  // Plant a sentinel in each — the spec's preconditions require it, and the
  // poller's count-based skip logic (count === 1 means "only the sentinel")
  // depends on it.
  for (const folder of [VIP_FOLDER, BLOCK_FOLDER, UNDO_VIP_FOLDER, UNBLOCK_FOLDER]) {
    await appendSentinel(imapClient, folder, 'action-folder');
  }

  const processor = new ActionFolderProcessor(
    configRepo,
    imapClient,
    activityLog,
    silentLogger,
    INBOX,
    TRASH,
  );
  const poller = new ActionFolderPoller({
    client: imapClient,
    configRepo,
    processor,
    logger: silentLogger,
    pollIntervalMs: 15_000,
  });

  const monitor = new Monitor(config, { imapClient, activityLog, logger: silentLogger });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
  });

  await monitor.start();

  async function teardown() {
    poller.stop();
    await monitor.stop().catch(() => {});
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return { configRepo, activityLog, imapClient, monitor, poller, teardown };
}

/**
 * Simulate the user dragging a message into an action folder via their mail
 * client. Uses a fresh ImapFlow connection so the move is observable on the
 * server but doesn't touch the system's ActivityLog (mirrors how the real
 * user's mail client would interact).
 */
async function userDragsMessage(
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

/**
 * Place a real (non-sentinel) message directly into an action folder via
 * APPEND. Used by sub-variants where the test starts from "user has dragged
 * a message into folder X" and the actual transport is incidental.
 */
async function appendMessageToFolder(folder: string, opts: {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  /** Set to true to omit the From header entirely (forces unparseable path). */
  omitFrom?: boolean;
}): Promise<void> {
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
    const headers: string[] = [];
    if (!opts.omitFrom) headers.push(`From: ${opts.from}`);
    headers.push(`To: ${opts.to ?? 'user@localhost'}`);
    headers.push(`Subject: ${opts.subject ?? 'Test'}`);
    headers.push(`Message-ID: <${Date.now()}-${Math.random()}@example.com>`);
    const raw =
      headers.join('\r\n') + '\r\n\r\n' + (opts.body ?? 'body') + '\r\n';
    await client.append(folder, raw, []);
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Empty every non-INBOX mailbox on the GreenMail instance. GreenMail keeps
 * messages around between tests (and across test files), so leftover
 * sentinels and prior-test data accumulate in the action folders unless we
 * clear them between runs. We deliberately do *not* try mailboxDelete on
 * folder paths containing '/' — GreenMail closes the connection on those
 * deletes, which would interrupt the rest of the wipe. Leaving the folders
 * in place is fine: bringUpApp's createMailbox calls are no-ops when the
 * folder already exists, and an emptied folder behaves the same as a
 * freshly-created one for the test's purposes.
 */
async function wipeAllNonInboxFolders(): Promise<void> {
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
    const mailboxes = await client.list();
    const targets = mailboxes
      .filter((m) => m.path.toUpperCase() !== 'INBOX')
      .map((m) => m.path);
    for (const p of targets) {
      try {
        const lock = await client.getMailboxLock(p);
        try {
          await client.messageDelete('1:*').catch(() => {});
        } finally {
          lock.release();
        }
      } catch {
        // can't lock — skip, will be no-op next iteration
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

describe('UC-002: Drag into action folder creates/removes a sender rule', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof bringUpApp>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-002-'));
    await clearMailboxes();
    await wipeAllNonInboxFolders();
    app = await bringUpApp(tmpDir);
  });

  afterEach(async () => {
    await app?.teardown();
    await wipeAllNonInboxFolders();
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('main flow [IX-007.1, IX-007.2, IX-007.3, IX-007.4, IX-007.5, IX-007.6, IX-007.7, IX-008.1, IX-008.2, IX-008.3, IX-008.5, IX-008.8, IX-008.9, IX-008.10]: VIP drag creates a skip rule, message returns to INBOX, future mail bypasses review', async () => {
    const { configRepo, activityLog, monitor, poller } = app;
    const SENDER = 'priority@example.com';

    // ---------------- Phase 1: Email arrives in INBOX ----------------
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'First message',
      body: 'first',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const inboxBefore = await listMailboxMessages(INBOX);
    expect(inboxBefore).toHaveLength(1);
    const firstUid = inboxBefore[0];

    // ---------------- Phase 1 (cont.): User drags into VIP ----------------
    await userDragsMessage(INBOX, VIP_FOLDER, firstUid);

    // VIP now has sentinel + dragged message; INBOX is empty.
    expect((await listMailboxMessages(VIP_FOLDER)).length).toBeGreaterThanOrEqual(2);
    expect(await listMailboxMessages(INBOX)).toHaveLength(0);

    // ---------------- Phase 2: Poller dispatches, processor creates rule ----------------
    await poller.scanAll();

    // A sender-only skip rule for priority@example.com now exists.
    const rulesAfter = configRepo.getRules();
    const vipRule = rulesAfter.find(
      (r): r is Rule =>
        r.match.sender?.toLowerCase() === SENDER &&
        r.action.type === 'skip' &&
        r.enabled,
    );
    expect(vipRule).toBeDefined();
    expect(vipRule!.name).toBe(`VIP: ${SENDER}`);

    // Message has been moved back to INBOX; VIP folder has only its sentinel.
    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);
    expect(await listMailboxMessages(VIP_FOLDER)).toHaveLength(1);

    // Activity log records the rule creation with source action-folder.
    const phase2Entry = await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.source === 'action-folder' &&
        e.rule_id === vipRule!.id &&
        e.action === 'skip' &&
        e.folder === INBOX &&
        e.success === 1,
    });
    expect(phase2Entry.message_from).toBe(SENDER);

    // ---------------- Phase 3: Future message from same sender bypasses ----------------
    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: 'Second message',
      body: 'second',
    });
    await new Promise((r) => setTimeout(r, 500));
    await monitor.processNewMessages();

    const phase3Entry = await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.source === 'arrival' &&
        e.rule_id === vipRule!.id &&
        e.action === 'skip' &&
        e.message_subject === 'Second message',
    });
    expect(phase3Entry.success).toBe(1);

    // Both messages remain in INBOX (skip = no move).
    expect(await listMailboxMessages(INBOX)).toHaveLength(2);
    expect(await listMailboxMessages(VIP_FOLDER)).toHaveLength(1);
  }, 120_000);

  it('UC-002.a [IX-007.5, IX-008.5, IX-008.8, IX-008.9, IX-008.10]: Block drag creates a delete rule and message lands in trash', async () => {
    const { configRepo, activityLog, poller } = app;
    const SENDER = 'spam@example.com';

    await appendMessageToFolder(BLOCK_FOLDER, { from: SENDER, subject: 'spam' });

    await poller.scanAll();

    const rule = configRepo.getRules().find(
      (r) => r.match.sender?.toLowerCase() === SENDER && r.action.type === 'delete',
    );
    expect(rule).toBeDefined();
    expect(rule!.name).toBe(`Block: ${SENDER}`);

    await waitForMailboxMessage(TRASH, { timeout: 5_000 });
    expect(await listMailboxMessages(TRASH)).toHaveLength(1);
    expect(await listMailboxMessages(BLOCK_FOLDER)).toHaveLength(1); // sentinel only

    await waitForProcessed(activityLog, {
      timeout: 5_000,
      predicate: (e) =>
        e.source === 'action-folder' &&
        e.rule_id === rule!.id &&
        e.action === 'delete' &&
        e.folder === TRASH &&
        e.success === 1,
    });
  }, 60_000);

  it('UC-002.b [IX-007.5, IX-008.6, IX-008.9]: Undo-VIP drag removes the existing skip rule', async () => {
    const { configRepo, poller } = app;
    const SENDER = 'priority@example.com';

    const existing = configRepo.addRule({
      name: `VIP: ${SENDER}`,
      match: { sender: SENDER },
      action: { type: 'skip' },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    await appendMessageToFolder(UNDO_VIP_FOLDER, { from: SENDER, subject: 'undo' });
    await poller.scanAll();

    expect(configRepo.getRules().find((r) => r.id === existing.id)).toBeUndefined();
    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);
    expect(await listMailboxMessages(UNDO_VIP_FOLDER)).toHaveLength(1); // sentinel
  }, 60_000);

  it('UC-002.c [IX-007.5, IX-008.6, IX-008.9]: Unblock drag removes the existing delete rule', async () => {
    const { configRepo, poller } = app;
    const SENDER = 'blocked@example.com';

    const existing = configRepo.addRule({
      name: `Block: ${SENDER}`,
      match: { sender: SENDER },
      action: { type: 'delete' },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    await appendMessageToFolder(UNBLOCK_FOLDER, { from: SENDER, subject: 'unblock' });
    await poller.scanAll();

    expect(configRepo.getRules().find((r) => r.id === existing.id)).toBeUndefined();
    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);
    expect(await listMailboxMessages(UNBLOCK_FOLDER)).toHaveLength(1);
  }, 60_000);

  it('UC-002.d [IX-007.5, IX-008.4, IX-008.5, IX-008.9, IX-008.10]: VIP drag with existing Block rule swaps the rule (delete then create)', async () => {
    const { configRepo, activityLog, poller } = app;
    const SENDER = 'flipflop@example.com';

    const oldDeleteRule = configRepo.addRule({
      name: `Block: ${SENDER}`,
      match: { sender: SENDER },
      action: { type: 'delete' },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    await appendMessageToFolder(VIP_FOLDER, { from: SENDER, subject: 'flip' });
    await poller.scanAll();

    const rules = configRepo.getRules();
    expect(rules.find((r) => r.id === oldDeleteRule.id)).toBeUndefined();
    const newSkipRule = rules.find(
      (r) => r.match.sender?.toLowerCase() === SENDER && r.action.type === 'skip',
    );
    expect(newSkipRule).toBeDefined();
    expect(newSkipRule!.name).toBe(`VIP: ${SENDER}`);

    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);

    // Two activity entries with source action-folder: one for the removal,
    // one for the creation. Both reference the dragged message.
    const afEntries = activityLog
      .getRecentActivity(100)
      .filter((e) => e.source === 'action-folder');
    const removal = afEntries.find((e) => e.rule_id === oldDeleteRule.id);
    const creation = afEntries.find((e) => e.rule_id === newSkipRule!.id);
    expect(removal).toBeDefined();
    expect(creation).toBeDefined();
    expect(removal!.success).toBe(1);
    expect(creation!.success).toBe(1);
  }, 60_000);

  it('UC-002.e [IX-007.5, IX-008.5, IX-008.7, IX-008.9]: multi-field rule for the same sender is preserved', async () => {
    const { configRepo, poller } = app;
    const SENDER = 'priority@example.com';

    const multiField = configRepo.addRule({
      name: 'invoices',
      match: { sender: SENDER, subject: '*invoice*' },
      action: { type: 'move', folder: 'Invoices' },
      enabled: true,
      order: configRepo.nextOrder(),
    });

    await appendMessageToFolder(VIP_FOLDER, { from: SENDER, subject: 'newsletter' });
    await poller.scanAll();

    const rules = configRepo.getRules();
    // Multi-field rule untouched.
    const stillThere = rules.find((r) => r.id === multiField.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.match.subject).toBe('*invoice*');

    // New sender-only skip rule appended after it (higher order = lower priority).
    const skipRule = rules.find(
      (r) =>
        r.match.sender?.toLowerCase() === SENDER &&
        r.action.type === 'skip' &&
        r.match.subject === undefined,
    );
    expect(skipRule).toBeDefined();
    expect(skipRule!.order).toBeGreaterThan(multiField.order);
  }, 60_000);

  it('UC-002.f [IX-007.5, IX-008.2, IX-008.9]: unparseable From address is recovered to INBOX without rule mutation', async () => {
    const { configRepo, poller } = app;

    const rulesBefore = configRepo.getRules().length;

    // Omit From entirely — the envelope's `from` field is undefined and
    // extractSender() returns null. (GreenMail/JavaMail canonicalises a
    // bare `From: malformed` into `malformed@localhost`, so we cannot use
    // a malformed-but-present From to exercise this path.)
    await appendMessageToFolder(VIP_FOLDER, {
      omitFrom: true,
      subject: 'no sender',
    });

    await poller.scanAll();

    // Rule set unchanged.
    expect(configRepo.getRules()).toHaveLength(rulesBefore);

    // Message recovered to INBOX; VIP folder back to sentinel-only.
    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);
    expect(await listMailboxMessages(VIP_FOLDER)).toHaveLength(1);
  }, 60_000);

  it('UC-002.g [IX-007.5, IX-008.6, IX-008.9]: remove operation with no matching rule still clears the folder', async () => {
    const { configRepo, poller } = app;
    const SENDER = 'unknown@example.com';

    const rulesBefore = configRepo.getRules().length;

    await appendMessageToFolder(UNDO_VIP_FOLDER, { from: SENDER, subject: 'no rule' });
    await poller.scanAll();

    expect(configRepo.getRules()).toHaveLength(rulesBefore);
    await waitForMailboxMessage(INBOX, { timeout: 5_000 });
    expect(await listMailboxMessages(INBOX)).toHaveLength(1);
    expect(await listMailboxMessages(UNDO_VIP_FOLDER)).toHaveLength(1);
  }, 60_000);
});
