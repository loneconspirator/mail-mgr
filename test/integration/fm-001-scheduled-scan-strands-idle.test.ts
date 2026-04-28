/**
 * Fault-injection test for FM-001 — Scheduled folder scan leaves IMAP IDLE
 * on a non-inbox folder.
 *
 * Spec: specs/failure-modes/fm-001-scheduled-scan-strands-idle.md
 * Invariant: specs/invariants/inv-001-imap-idle-returns-to-inbox.md (INV-001)
 *
 * The bug this guards against: a scheduled job (ReviewSweeper, ActionFolderPoller,
 * or any future scheduled IMAP consumer) takes the single shared IMAP connection,
 * selects a non-INBOX folder for its work, and either forgets to re-select INBOX
 * or fails to do so on an error path. The connection stays healthy, the scheduled
 * jobs keep ticking — but IX-001.1 (Monitor receiving newMail events for inbound
 * mail) silently breaks until the next reconnect.
 *
 * The proof here is a single end-to-end check per scheduled consumer:
 *   1. Connect ImapClient to GreenMail; confirm we are IDLE on INBOX.
 *   2. Drive the consumer's scheduled action so it selects a non-INBOX folder.
 *   3. Assert that after the action returns, append-to-INBOX produces a newMail
 *      event within the normal latency budget. That is the real evidence that
 *      INV-001 holds — the connection-state details (which mailbox is selected,
 *      whether IDLE is armed) are implementation; the observable contract is
 *      "rules still fire on new mail."
 *
 * Both the success path and a forced-error path are exercised, because the
 * regression risk includes finally-blocks that don't restore state on throw.
 *
 * The test must exercise the real scheduled consumers — not call
 * withMailboxSwitch / withMailboxLock directly — because the regression risk is
 * precisely that a future consumer bypasses the helper or uses the wrong one.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { ImapFlow } from 'imapflow';
import { ImapClient } from '../../src/imap/client.js';
import type { ImapFlowLike } from '../../src/imap/client.js';
import { ReviewSweeper } from '../../src/sweep/index.js';
import { ActionFolderPoller } from '../../src/action-folders/poller.js';
import type { ActionFolderProcessor } from '../../src/action-folders/processor.js';
import type { ConfigRepository } from '../../src/config/repository.js';
import type { ActionFolderConfig } from '../../src/config/schema.js';
import { ActivityLog } from '../../src/log/index.js';
import {
  TEST_IMAP_CONFIG,
  assertGreenMailRunning,
  clearMailboxes,
  sendTestEmail,
} from './helpers.js';

const silentLogger = pino({ level: 'silent' });

const REVIEW_FOLDER = 'Review';
const ACTION_PREFIX = 'Actions';
const VIP_FOLDER = 'VIP';
const VIP_PATH = `${ACTION_PREFIX}/${VIP_FOLDER}`;

const NEW_MAIL_TIMEOUT_MS = 8_000;

function makeImapFlowFactory() {
  return (config: typeof TEST_IMAP_CONFIG): ImapFlowLike => {
    return new ImapFlow({
      host: config.host,
      port: config.port,
      secure: false,
      auth: config.auth,
      logger: false,
      doSTARTTLS: false,
    }) as unknown as ImapFlowLike;
  };
}

/**
 * Use a fresh ImapFlow connection (separate from the ImapClient under test) to
 * create / clear the secondary folders and seed messages. This avoids tangling
 * test setup with the very connection state we are asserting on.
 */
async function withSetupClient<T>(fn: (flow: ImapFlow) => Promise<T>): Promise<T> {
  const flow = new ImapFlow({
    host: TEST_IMAP_CONFIG.host,
    port: TEST_IMAP_CONFIG.port,
    secure: false,
    auth: TEST_IMAP_CONFIG.auth,
    logger: false,
    doSTARTTLS: false,
  });
  await flow.connect();
  try {
    return await fn(flow);
  } finally {
    await flow.logout().catch(() => {});
  }
}

async function ensureFolder(folder: string): Promise<void> {
  await withSetupClient(async (flow) => {
    try {
      await flow.mailboxCreate(folder);
    } catch {
      // already exists
    }
  });
}

async function clearFolder(folder: string): Promise<void> {
  await withSetupClient(async (flow) => {
    try {
      const lock = await flow.getMailboxLock(folder);
      try {
        await flow.messageDelete('1:*');
      } catch {
        // empty
      } finally {
        lock.release();
      }
    } catch {
      // folder doesn't exist
    }
  });
}

async function seedMessage(folder: string, subject: string): Promise<void> {
  await withSetupClient(async (flow) => {
    const raw = [
      'From: seed@example.com',
      'To: user@localhost',
      `Subject: ${subject}`,
      'Date: Wed, 01 Jan 2020 00:00:00 +0000',
      '',
      'seed body',
      '',
    ].join('\r\n');
    await flow.append(folder, raw, []);
  });
}

/**
 * Wait for a `newMail` event from the ImapClient. Caller is responsible for
 * triggering the inbound mail (e.g. SMTP send). Resolves with the count
 * reported by the event, rejects on timeout.
 */
function waitForNewMail(
  client: ImapClient,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('newMail', onNewMail);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for newMail event`));
    }, timeoutMs);
    const onNewMail = (count: number) => {
      clearTimeout(timer);
      client.off('newMail', onNewMail);
      resolve(count);
    };
    client.on('newMail', onNewMail);
  });
}

/**
 * Prove that, given the current ImapClient state, an inbound INBOX message
 * triggers a newMail event. This is the system-level assertion of INV-001 —
 * we deliberately avoid inspecting private fields like the selected-mailbox
 * path; what matters is the observable contract: a freshly-arrived INBOX
 * message produces a newMail event that the Monitor pipeline can consume.
 *
 * GreenMail does not reliably push IDLE EXISTS unsolicited (see the same
 * caveat in pipeline.test.ts), so we mirror the production NOOP cycle: after
 * appending the probe message, send a NOOP on the underlying flow to flush
 * pending EXISTS. In production this is exactly what `cycleIdle` /
 * `poll` do on a fixed timer; here we trigger it once to keep the test
 * deterministic instead of waiting on timer cadence.
 *
 * If FM-001 is regressed (the connection is left on a non-INBOX folder), the
 * NOOP runs against the wrong mailbox and INBOX's EXISTS never reaches us —
 * the newMail wait then times out, producing the expected failure signal.
 */
async function expectInboxNewMailFires(client: ImapClient, marker: string): Promise<void> {
  const newMailPromise = waitForNewMail(client, NEW_MAIL_TIMEOUT_MS);
  await sendTestEmail({
    from: 'fm001@example.com',
    to: 'user@localhost',
    subject: `FM-001 probe ${marker}`,
    body: 'Probe to verify INBOX IDLE/poll is still alive after a non-INBOX scan.',
  });

  // Mirror cycleIdle/poll's production behavior: send NOOP on the underlying
  // flow to flush pending EXISTS. Reach into the flow because the public
  // ImapClient surface intentionally hides the keep-alive. If the flow is on
  // INBOX, NOOP yields an EXISTS event and newMail fires; if it's stranded
  // on a non-INBOX folder (FM-001 regressed), the EXISTS never arrives and
  // waitForNewMail times out — the failure signal we want.
  const flow = (client as unknown as { flow?: { noop(): Promise<void> } }).flow;
  if (flow) await flow.noop();

  const count = await newMailPromise;
  expect(count).toBeGreaterThan(0);
}

describe('FM-001: scheduled scan must not strand IMAP IDLE on non-INBOX folder', () => {
  let tmpDir: string;
  let activityLog: ActivityLog;
  let client: ImapClient;

  beforeAll(async () => {
    await assertGreenMailRunning();
  });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailmgr-fm001-'));
    activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));

    await clearMailboxes();
    await ensureFolder(REVIEW_FOLDER);
    await clearFolder(REVIEW_FOLDER);
    await ensureFolder(VIP_PATH);
    await clearFolder(VIP_PATH);

    client = new ImapClient(
      { ...TEST_IMAP_CONFIG, idleTimeout: 300_000, pollInterval: 1_000 },
      makeImapFlowFactory(),
    );
    await client.connect();
    expect(client.state).toBe('connected');
  });

  afterEach(async () => {
    await client?.disconnect().catch(() => {});
    activityLog?.close();
    // Wipe the folders + INBOX state we created so neighbouring test files
    // (notably the UC-002 acceptance suite, which assumes a clean GreenMail)
    // don't pick up our residue. GreenMail persists across files in a run.
    await clearFolder(REVIEW_FOLDER);
    await clearFolder(VIP_PATH);
    await clearMailboxes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ReviewSweeper (IX-006)', () => {
    it('newMail still fires on INBOX after a sweep tick over the review folder', async () => {
      await seedMessage(REVIEW_FOLDER, 'sweep target — old enough to ignore');

      const sweeper = new ReviewSweeper({
        client,
        activityLog,
        rules: [],
        reviewConfig: {
          folder: REVIEW_FOLDER,
          defaultArchiveFolder: 'MailingLists',
          trashFolder: 'Trash',
          sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
        },
        trashFolder: 'Trash',
        logger: silentLogger,
      });

      // The seed message is too young to be eligible, so runSweep will fetch
      // the review folder (the action that selects a non-INBOX mailbox) and
      // return without moving anything. That is exactly the trigger we need.
      await sweeper.runSweep();

      await expectInboxNewMailFires(client, 'after-sweep-success');
    });

    it('newMail still fires on INBOX after a sweep tick that fails mid-run', async () => {
      await seedMessage(REVIEW_FOLDER, 'sweep target');

      // Force fetchAllMessages to throw — proves the restoration also runs on
      // the error path. The error must propagate (or be swallowed by the
      // sweeper) without leaving the connection on the review folder.
      const realFetch = client.fetchAllMessages.bind(client);
      let threw = false;
      client.fetchAllMessages = async (folder: string) => {
        if (folder === REVIEW_FOLDER && !threw) {
          threw = true;
          // Deliberately call into the helper so the lock has been taken,
          // then throw — this is the worst-case version of the bug.
          await realFetch(folder);
          throw new Error('FM-001 injected fault');
        }
        return realFetch(folder);
      };

      const sweeper = new ReviewSweeper({
        client,
        activityLog,
        rules: [],
        reviewConfig: {
          folder: REVIEW_FOLDER,
          defaultArchiveFolder: 'MailingLists',
          trashFolder: 'Trash',
          sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
        },
        trashFolder: 'Trash',
        logger: silentLogger,
      });

      await sweeper.runSweep();
      expect(threw).toBe(true);

      await expectInboxNewMailFires(client, 'after-sweep-fault');
    });
  });

  describe('ActionFolderPoller (IX-007)', () => {
    function makeConfigRepo(config: ActionFolderConfig): ConfigRepository {
      return {
        getActionFolderConfig: () => config,
      } as unknown as ConfigRepository;
    }

    function makeStubProcessor(): ActionFolderProcessor {
      return {
        processMessage: async () => ({ ok: true, sender: 'sender@example.com', action: 'vip' }),
      } as unknown as ActionFolderProcessor;
    }

    const config: ActionFolderConfig = {
      enabled: true,
      prefix: ACTION_PREFIX,
      pollInterval: 15,
      folders: {
        vip: VIP_FOLDER,
        block: 'Block',
        undoVip: 'UndoVIP',
        unblock: 'Unblock',
      },
    };

    it('newMail still fires on INBOX after the poller scans an action folder with messages', async () => {
      // Two messages in the VIP folder so messages > 1 (skip-only threshold)
      // and the poller actually fetches.
      await seedMessage(VIP_PATH, 'vip drag 1');
      await seedMessage(VIP_PATH, 'vip drag 2');

      // Make sure the other three folders exist with at least 0 messages so
      // the poller's STATUS calls do not fail and abort the scan early.
      await ensureFolder(`${ACTION_PREFIX}/Block`);
      await ensureFolder(`${ACTION_PREFIX}/UndoVIP`);
      await ensureFolder(`${ACTION_PREFIX}/Unblock`);

      const poller = new ActionFolderPoller({
        client,
        configRepo: makeConfigRepo(config),
        processor: makeStubProcessor(),
        logger: silentLogger,
        pollIntervalMs: 15_000,
      });

      await poller.scanAll();

      await expectInboxNewMailFires(client, 'after-poller-success');
    });

    it('newMail still fires on INBOX after the poller scan fails mid-run', async () => {
      await seedMessage(VIP_PATH, 'vip drag 1');
      await seedMessage(VIP_PATH, 'vip drag 2');

      await ensureFolder(`${ACTION_PREFIX}/Block`);
      await ensureFolder(`${ACTION_PREFIX}/UndoVIP`);
      await ensureFolder(`${ACTION_PREFIX}/Unblock`);

      const realFetch = client.fetchAllMessages.bind(client);
      let threw = false;
      client.fetchAllMessages = async (folder: string) => {
        if (folder === VIP_PATH && !threw) {
          threw = true;
          await realFetch(folder);
          throw new Error('FM-001 injected fault');
        }
        return realFetch(folder);
      };

      const poller = new ActionFolderPoller({
        client,
        configRepo: makeConfigRepo(config),
        processor: makeStubProcessor(),
        logger: silentLogger,
        pollIntervalMs: 15_000,
      });

      // The poller swallows per-folder errors (IX-007.8), so this resolves
      // even though the VIP scan blew up. The point of FM-001 is that the
      // connection state must be sane afterwards regardless.
      await poller.scanAll();
      expect(threw).toBe(true);

      await expectInboxNewMailFires(client, 'after-poller-fault');
    });
  });
});
