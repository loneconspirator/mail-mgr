/**
 * Integration test for IX-003 — User move detection and destination resolution.
 *
 * Spec: specs/integrations/ix-003-user-move-detection-and-destination-resolution.md
 *
 * Drives the real MoveTracker (MOD-0008) end-to-end against:
 *   - real ImapClient (MOD-0002) backed by GreenMail on localhost:3143
 *   - real ActivityLog (MOD-0007) on a temp SQLite database
 *   - real SignalStore (MOD-0011) sharing the ActivityLog db
 *   - real DestinationResolver (MOD-0009)
 *
 * No mocks of any unit under test — that is the point: IX-003 is the
 * collaboration between MoveTracker, ImapClient, ActivityLog, and
 * DestinationResolver, so all four are wired the way production wires them.
 * UC-001's bringUpApp() establishes the same pattern; this file strips it down
 * to just what IX-003 requires (no Monitor, no PatternDetector, no Fastify).
 *
 * Named-interaction coverage:
 *   IX-003.1 — UID snapshot diff detects disappearance.
 *   IX-003.2 — Two-scan confirmation prevents false positives, and the true
 *              positive path produces a confirmed signal across two scans.
 *   IX-003.3 — ActivityLog.isSystemMove filters system-initiated moves out of
 *              user-move detection.
 *   IX-003.4 — DestinationResolver fast-pass resolves via recent + common
 *              folder names.
 *   IX-003.5 — Fast-pass miss enqueues for deep scan.
 *   IX-003.6 — Confirmed move emits signal with full metadata
 *              (sender, subject, readStatus, sourceFolder, destinationFolder).
 *   IX-003.7 — Deep-scan miss drops the pending entry without erroring.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { ImapFlow } from 'imapflow';

import { ImapClient } from '../../src/imap/client.js';
import type { ImapFlowLike } from '../../src/imap/client.js';
import { ActivityLog } from '../../src/log/index.js';
import { SignalStore } from '../../src/tracking/signals.js';
import { DestinationResolver } from '../../src/tracking/destinations.js';
import { MoveTracker } from '../../src/tracking/index.js';

import {
  assertGreenMailRunning,
  sendTestEmail,
  waitForMailboxMessage,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from './helpers.js';

const HOST = 'localhost';
const IMAP_PORT = 3143;

// 'Archive' is the FIRST entry in COMMON_FOLDERS in src/tracking/destinations.ts —
// using it for IX-003.4 (fast-pass success) and IX-003.6 (signal metadata).
const FAST_DEST = 'Archive';
// Not in COMMON_FOLDERS and not seeded into ActivityLog.getRecentFolders() — used
// for IX-003.5 (fast-pass miss → deep-scan queue) and IX-003.7 (deep-scan miss).
const DEEP_DEST = 'CustomerProj';
const REVIEW_FOLDER = 'Review';

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
 * Build the real wiring exactly the way production does, scoped to a single
 * test's temp directory + GreenMail. Returns a teardown that closes everything
 * cleanly so the next test starts from a clean slate.
 */
async function bringUpTracker(tmpDir: string) {
  const imapClient = new ImapClient(TEST_IMAP_CONFIG, makeImapFlowFactory());
  await imapClient.connect();

  // MoveTracker.runScan iterates [inbox, reviewFolder] — Review must exist on
  // GreenMail or the per-folder switch throws. Same for the destination
  // folders we'll move messages into.
  for (const folder of [REVIEW_FOLDER, FAST_DEST, DEEP_DEST]) {
    await imapClient.createMailbox(folder).catch(() => {
      // already exists — fine
    });
  }

  const activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
  const signalStore = new SignalStore(activityLog.getDb());

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
    reviewFolder: REVIEW_FOLDER,
    scanIntervalMs: 60_000,
    enabled: false, // we drive scans manually via runScanForTest()
    logger: silentLogger,
  });

  async function teardown() {
    moveTracker.stop();
    await imapClient.disconnect().catch(() => {});
    activityLog.close();
  }

  return { imapClient, activityLog, signalStore, destinationResolver, moveTracker, teardown };
}

/**
 * Move a message via an INDEPENDENT ImapFlow connection so the move does NOT
 * pass through our ActivityLog. ActivityLog.isSystemMove(messageId) therefore
 * returns false for this move, which is exactly what makes MoveTracker treat
 * it as a user-initiated move (IX-003.3).
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

/**
 * Permanently delete a message by UID (and expunge) from a folder via an
 * independent ImapFlow connection. Used by IX-003.7 to simulate "the user
 * deleted the message before deep scan ran" — the deep scan should then find
 * the message nowhere and drop the pending entry without erroring.
 */
async function permanentlyDelete(folder: string, uid: number): Promise<void> {
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
      await client.messageDelete([uid], { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Fetch the Message-ID header for a UID in a folder. We need it to look up
 * signals in SignalStore (which keys on Message-ID, not UID).
 *
 * Implementation note: GreenMail's INBOX accumulates a high UID counter across
 * the suite (UIDs in the thousands), so a fetch range like '1:*' iterates the
 * whole mailbox. We instead fetch the specific UID by string range to keep the
 * iterator short and avoid spurious 30s hangs we saw with `fetch([uid], ...)`.
 */
async function getMessageIdForUid(folder: string, uid: number): Promise<string> {
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
      let result = '';
      for await (const msg of client.fetch(
        `${uid}`,
        { uid: true, envelope: true },
        { uid: true },
      )) {
        const m = msg as { envelope?: { messageId?: string } };
        if (!result) result = m.envelope?.messageId ?? '';
      }
      return result;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

beforeAll(async () => {
  await assertGreenMailRunning();
});

describe('IX-003 — User move detection and destination resolution', () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof bringUpTracker>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-003-'));
    // Reset GreenMail's INBOX so a previous file's leftovers don't show up in
    // our baseline scan. The destination folders are wiped at teardown.
    await clearMailboxes();
    app = await bringUpTracker(tmpDir);
    // Ensure the destination folders start empty (they survive across tests
    // because GreenMail persists mailboxes for the lifetime of the container).
    for (const folder of [FAST_DEST, DEEP_DEST, REVIEW_FOLDER]) {
      const uids = await listMailboxMessages(folder);
      if (uids.length > 0) {
        const c = new ImapFlow({
          host: HOST,
          port: IMAP_PORT,
          secure: false,
          auth: { user: 'user', pass: 'pass' },
          logger: false,
          doSTARTTLS: false,
        });
        try {
          await c.connect();
          const lock = await c.getMailboxLock(folder);
          try {
            await c.messageDelete('1:*').catch(() => {});
          } finally {
            lock.release();
          }
        } finally {
          await c.logout().catch(() => {});
        }
      }
    }
  });

  afterEach(async () => {
    await app?.teardown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('IX-003.1: UID snapshot diff detects disappearance (pending, no signal yet)', async () => {
    const { moveTracker, signalStore } = app;

    await sendTestEmail({
      from: 'sender1@example.com',
      to: 'user@localhost',
      subject: 'IX-003.1 test',
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');

    // Baseline scan: snapshot includes the message in INBOX.
    await moveTracker.runScanForTest();
    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(0);

    // User moves the message via an independent connection. The move does NOT
    // touch ActivityLog → it is, by definition, a user move (IX-003.3 covers
    // the inverse).
    await userMovesMessage('INBOX', FAST_DEST, uid);

    // Sanity: the move actually landed.
    expect(await listMailboxMessages('INBOX')).toHaveLength(0);
    expect(await listMailboxMessages(FAST_DEST)).toHaveLength(1);

    // Scan #2: diff detects disappearance and adds it to pendingConfirmation.
    // No signal yet (two-scan confirmation requires another scan), and nothing
    // queued for deep scan. This is exactly IX-003.1: the diff fired.
    await moveTracker.runScanForTest();
    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(0);
    expect(signalStore.getSignals()).toHaveLength(0);
  }, 30_000);

  it('IX-003.2: two-scan confirmation prevents false positives AND fires on true positives', async () => {
    const { moveTracker, signalStore } = app;

    // ---- (a) Reappearance cancels: message stays in INBOX ----
    await sendTestEmail({
      from: 'stay@example.com',
      to: 'user@localhost',
      subject: 'IX-003.2 stays put',
      body: 'body',
    });
    await waitForMailboxMessage('INBOX');

    await moveTracker.runScanForTest(); // baseline
    await moveTracker.runScanForTest(); // still there → no diff
    await moveTracker.runScanForTest(); // still there → no diff
    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(signalStore.getSignals()).toHaveLength(0);

    // ---- (b) True positive: user moves the message, two scans confirm ----
    await sendTestEmail({
      from: 'moved@example.com',
      to: 'user@localhost',
      subject: 'IX-003.2 truly moves',
      body: 'body',
    });
    // Wait for INBOX to have exactly one message (the new arrival; phase (a)'s
    // message is still in INBOX too, so we need both).
    let inboxUids: number[] = [];
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      inboxUids = await listMailboxMessages('INBOX');
      if (inboxUids.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(inboxUids).toHaveLength(2);
    const movingUid = inboxUids[1]; // newest

    await moveTracker.runScanForTest(); // re-baseline now that there are 2 in INBOX
    await userMovesMessage('INBOX', FAST_DEST, movingUid);

    const signalsBefore = moveTracker.getState().signalsLogged;
    await moveTracker.runScanForTest(); // scan #1: diff → pendingConfirmation
    expect(moveTracker.getState().signalsLogged).toBe(signalsBefore); // still pending
    await moveTracker.runScanForTest(); // scan #2: still missing → confirmed
    expect(moveTracker.getState().signalsLogged).toBe(signalsBefore + 1);

    const signals = signalStore.getSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].sender).toBe('moved@example.com');
    expect(signals[0].destinationFolder).toBe(FAST_DEST);
  }, 30_000);

  it('IX-003.3: ActivityLog.isSystemMove filters system-initiated moves out of user-move detection', async () => {
    const { moveTracker, signalStore, activityLog } = app;

    await sendTestEmail({
      from: 'system@example.com',
      to: 'user@localhost',
      subject: 'IX-003.3 system move',
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');
    const messageId = await getMessageIdForUid('INBOX', uid);
    expect(messageId).toBeTruthy();

    // Baseline scan: snapshot has the message.
    await moveTracker.runScanForTest();

    // BEFORE the actual IMAP move, log a system-initiated activity row for
    // this Message-ID. ActivityLog.isSystemMove() will then return true, and
    // MoveTracker.handleDisappearedMessage() will skip the disappearance
    // entirely — no pendingConfirmation entry, no signal.
    activityLog.getDb().prepare(
      `INSERT INTO activity (message_uid, message_id, action, folder, success, source)
       VALUES (?, ?, 'move', ?, 1, 'arrival')`,
    ).run(uid, messageId, FAST_DEST);

    // Sanity: the system-move predicate now returns true for this Message-ID.
    expect(activityLog.isSystemMove(messageId)).toBe(true);

    // Now physically move the message (independent connection — but
    // ActivityLog already has the system-move row).
    await userMovesMessage('INBOX', FAST_DEST, uid);

    // Two scans: even though the message disappeared, isSystemMove → true
    // makes handleDisappearedMessage early-return. Nothing should land in
    // pending or in signals.
    await moveTracker.runScanForTest();
    await moveTracker.runScanForTest();

    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(0);
    expect(signalStore.getSignalByMessageId(messageId)).toBeNull();
  }, 30_000);

  it('IX-003.4: DestinationResolver fast-pass resolves via recent + common folders', async () => {
    const { moveTracker, signalStore } = app;

    await sendTestEmail({
      from: 'fast@example.com',
      to: 'user@localhost',
      subject: 'IX-003.4 fast pass',
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');
    const messageId = await getMessageIdForUid('INBOX', uid);

    // Baseline scan.
    await moveTracker.runScanForTest();

    // Move to 'Archive' — the FIRST entry in COMMON_FOLDERS in
    // src/tracking/destinations.ts. Fast-pass MUST find it without consulting
    // ActivityLog.getRecentFolders() (which is empty at this point).
    await userMovesMessage('INBOX', FAST_DEST, uid);

    await moveTracker.runScanForTest(); // scan #1 → pending
    await moveTracker.runScanForTest(); // scan #2 → confirmed via fast-pass

    expect(moveTracker.getState().signalsLogged).toBe(1);
    // Fast-pass succeeded → nothing queued for deep scan.
    expect(moveTracker.getState().pendingDeepScan).toBe(0);

    const sig = signalStore.getSignalByMessageId(messageId);
    expect(sig).not.toBeNull();
    expect(sig!.destinationFolder).toBe(FAST_DEST);
    expect(sig!.sourceFolder).toBe('INBOX');
  }, 30_000);

  it('IX-003.5: fast-pass miss enqueues for deep scan', async () => {
    const { moveTracker, signalStore } = app;

    await sendTestEmail({
      from: 'deep@example.com',
      to: 'user@localhost',
      subject: 'IX-003.5 deep scan queue',
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');

    await moveTracker.runScanForTest(); // baseline

    // 'CustomerProj' is NOT in COMMON_FOLDERS, and ActivityLog has no rows yet
    // so getRecentFolders() returns []. Fast-pass therefore cannot find it.
    await userMovesMessage('INBOX', DEEP_DEST, uid);

    await moveTracker.runScanForTest(); // scan #1 → pending
    await moveTracker.runScanForTest(); // scan #2 → fast-pass miss → enqueued for deep scan

    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(1);
    expect(signalStore.getSignals()).toHaveLength(0);
  }, 30_000);

  it('IX-003.6: confirmed move emits signal with full metadata', async () => {
    const { moveTracker, signalStore } = app;

    const SENDER = 'meta@example.com';
    const SUBJECT = 'IX-003.6 metadata check';

    await sendTestEmail({
      from: SENDER,
      to: 'user@localhost',
      subject: SUBJECT,
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');
    const messageId = await getMessageIdForUid('INBOX', uid);
    expect(messageId).toBeTruthy();

    await moveTracker.runScanForTest(); // baseline
    await userMovesMessage('INBOX', FAST_DEST, uid);
    await moveTracker.runScanForTest();
    await moveTracker.runScanForTest();

    expect(moveTracker.getState().signalsLogged).toBe(1);

    const sig = signalStore.getSignalByMessageId(messageId);
    expect(sig).not.toBeNull();
    // Full-metadata assertions — IX-003.6 is specifically the "the signal
    // carries everything downstream needs" interaction.
    expect(sig!.messageId).toBe(messageId);
    expect(sig!.sender).toBe(SENDER);
    expect(sig!.subject).toBe(SUBJECT);
    expect(sig!.readStatus).toBe('unread'); // freshly delivered, not flagged \Seen
    expect(sig!.sourceFolder).toBe('INBOX');
    expect(sig!.destinationFolder).toBe(FAST_DEST);
    // envelopeRecipient + listId are only populated when envelopeHeader is
    // configured; this test does not configure one, so they should be
    // undefined. (IX-004 covers the populated path.)
    expect(sig!.envelopeRecipient).toBeUndefined();
    expect(sig!.listId).toBeUndefined();
  }, 30_000);

  it('IX-003.7: deep-scan miss drops the pending entry without erroring', async () => {
    const { moveTracker, signalStore } = app;

    await sendTestEmail({
      from: 'gone@example.com',
      to: 'user@localhost',
      subject: 'IX-003.7 vanishing act',
      body: 'body',
    });
    const [uid] = await waitForMailboxMessage('INBOX');
    const messageId = await getMessageIdForUid('INBOX', uid);

    await moveTracker.runScanForTest(); // baseline
    await userMovesMessage('INBOX', DEEP_DEST, uid);
    await moveTracker.runScanForTest(); // scan #1 → pending
    await moveTracker.runScanForTest(); // scan #2 → fast-pass miss → deep-scan queue

    expect(moveTracker.getState().pendingDeepScan).toBe(1);

    // Now simulate the message being permanently deleted before deep scan
    // can find it (e.g. user emptied the folder). When deep scan runs, it
    // will iterate every selectable folder, find the message nowhere, and
    // drop the pending entry per spec D-06.
    const destUids = await listMailboxMessages(DEEP_DEST);
    expect(destUids).toHaveLength(1);
    await permanentlyDelete(DEEP_DEST, destUids[0]);
    expect(await listMailboxMessages(DEEP_DEST)).toHaveLength(0);

    // triggerDeepScan must not throw, must report 0 resolved, and must clear
    // the pending entry rather than leaking it.
    const result = await moveTracker.triggerDeepScan();
    expect(result.resolved).toBe(0);
    expect(moveTracker.getState().signalsLogged).toBe(0);
    expect(moveTracker.getState().pendingDeepScan).toBe(0);
    expect(signalStore.getSignalByMessageId(messageId)).toBeNull();
  }, 60_000);
});
