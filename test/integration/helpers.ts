import net from 'node:net';
import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import type { ActivityEntry } from '../../src/log/index.js';

const SMTP_PORT = 3025;
const IMAP_PORT = 3143;
const HOST = 'localhost';

/**
 * Verify GreenMail is reachable on the IMAP port. Throws a clear, actionable
 * error if not — without this, every helper below fails in a way that takes
 * 10–40 seconds to surface and points at the wrong layer.
 *
 * Call from a beforeAll() in any test file that needs GreenMail.
 */
export async function assertGreenMailRunning(timeoutMs = 1000): Promise<void> {
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(IMAP_PORT, HOST);
  });

  if (!reachable) {
    throw new Error(
      `GreenMail is not reachable on ${HOST}:${IMAP_PORT}. ` +
        `Start it with: scripts/dev-env/start.sh ` +
        `(or: docker compose -f docker-compose.test.yaml up -d)`,
    );
  }
}

export const TEST_IMAP_CONFIG = {
  host: HOST,
  port: IMAP_PORT,
  tls: false,
  auth: { user: 'user', pass: 'pass' },
  idleTimeout: 300_000,
  pollInterval: 60_000,
};

/**
 * Send a test email to GreenMail via SMTP.
 */
export async function sendTestEmail(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const transport = createTransport({
    host: HOST,
    port: SMTP_PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  await transport.sendMail({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
  });

  transport.close();
}

/**
 * Poll the activity log until a matching entry appears or timeout.
 */
export async function waitForProcessed(
  activityLog: { getRecentActivity(limit?: number): ActivityEntry[] },
  opts: {
    timeout?: number;
    predicate: (entry: ActivityEntry) => boolean;
  },
): Promise<ActivityEntry> {
  const timeout = opts.timeout ?? 10_000;
  const start = Date.now();
  const poll = 250;

  while (Date.now() - start < timeout) {
    const entries = activityLog.getRecentActivity(100);
    const match = entries.find(opts.predicate);
    if (match) return match;
    await sleep(poll);
  }

  throw new Error(`waitForProcessed timed out after ${timeout}ms`);
}

/**
 * Wait for a message to appear in the given IMAP folder.
 */
export async function waitForMailboxMessage(
  folder: string,
  opts?: { timeout?: number },
): Promise<number[]> {
  const timeout = opts?.timeout ?? 10_000;
  const start = Date.now();
  const poll = 250;

  while (Date.now() - start < timeout) {
    const uids = await listMailboxMessages(folder);
    if (uids.length > 0) return uids;
    await sleep(poll);
  }

  throw new Error(`No messages appeared in ${folder} after ${timeout}ms`);
}

/**
 * List message UIDs in a given IMAP folder on GreenMail.
 */
export async function listMailboxMessages(folder: string): Promise<number[]> {
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
    const uids: number[] = [];
    try {
      for await (const msg of client.fetch('1:*', { uid: true }, { uid: true })) {
        uids.push(msg.uid);
      }
    } catch {
      // folder empty or doesn't exist — return empty
    } finally {
      lock.release();
    }
    return uids;
  } catch {
    return [];
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Delete all messages from INBOX (and any other folders) to reset state.
 */
export async function clearMailboxes(): Promise<void> {
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

    for (const folder of ['INBOX']) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          // Flag all messages as deleted, then expunge
          await client.messageDelete('1:*');
        } catch {
          // empty mailbox
        } finally {
          lock.release();
        }
      } catch {
        // folder doesn't exist
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
