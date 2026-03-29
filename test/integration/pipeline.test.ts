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
import type { Config, Rule } from '../../src/config/schema.js';
import {
  sendTestEmail,
  waitForProcessed,
  waitForMailboxMessage,
  listMailboxMessages,
  clearMailboxes,
  TEST_IMAP_CONFIG,
} from './helpers.js';

const silentLogger = pino({ level: 'silent' });

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

function makeRule(overrides?: Partial<Rule>): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: 'test@sender.com' },
    action: { type: 'move', folder: 'Processed' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeConfig(rules: Rule[]): Config {
  return {
    imap: TEST_IMAP_CONFIG,
    server: { port: 3000, host: '0.0.0.0' },
    rules,
  };
}

describe('Full Pipeline Integration', () => {
  let tmpDir: string;
  let activityLog: ActivityLog;
  let monitor: Monitor;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-int-'));
    activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
    await clearMailboxes();
  });

  afterEach(async () => {
    await monitor?.stop();
    activityLog?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rule match moves email to target folder', async () => {
    const rule = makeRule();
    const config = makeConfig([rule]);
    const imapClient = new ImapClient(config.imap, makeImapFlowFactory());

    monitor = new Monitor(config, {
      imapClient,
      activityLog,
      logger: silentLogger,
    });

    await monitor.start();

    // Send an email that matches the rule
    await sendTestEmail({
      from: 'test@sender.com',
      to: 'user@localhost',
      subject: 'Test email for rule match',
      body: 'This should be moved to Processed.',
    });

    // Give GreenMail a moment to accept the message, then trigger processing
    // GreenMail may not reliably push IDLE EXISTS notifications, so we
    // nudge the monitor to check for new messages.
    await new Promise((r) => setTimeout(r, 1_000));
    await monitor.processNewMessages();

    // Wait for the monitor to process it and log the activity
    const entry = await waitForProcessed(activityLog, {
      timeout: 10_000,
      predicate: (e) =>
        e.rule_id === 'rule-1' &&
        e.action === 'move' &&
        e.folder === 'Processed' &&
        e.success === 1,
    });

    expect(entry).toBeDefined();
    expect(entry.rule_id).toBe('rule-1');
    expect(entry.action).toBe('move');
    expect(entry.folder).toBe('Processed');
    expect(entry.success).toBe(1);

    // With mailbox locking, the MOVE should now reliably relocate the message
    const inboxMessages = await listMailboxMessages('INBOX');
    expect(inboxMessages).toHaveLength(0);

    const processedMessages = await listMailboxMessages('Processed');
    expect(processedMessages.length).toBeGreaterThan(0);
  });

  it('no rule match leaves email in INBOX', async () => {
    const rule = makeRule(); // matches test@sender.com only
    const config = makeConfig([rule]);
    const imapClient = new ImapClient(config.imap, makeImapFlowFactory());

    monitor = new Monitor(config, {
      imapClient,
      activityLog,
      logger: silentLogger,
    });

    await monitor.start();

    // Send an email that does NOT match any rule
    await sendTestEmail({
      from: 'nomatch@other.com',
      to: 'user@localhost',
      subject: 'No rule should match this',
      body: 'This should stay in INBOX.',
    });

    // Give GreenMail a moment to accept the message, then trigger processing
    await new Promise((r) => setTimeout(r, 1_000));
    await monitor.processNewMessages();

    // INBOX should still contain the message
    const inboxUids = await listMailboxMessages('INBOX');
    expect(inboxUids.length).toBeGreaterThan(0);

    // Activity log should have no entries (unmatched messages aren't logged to DB)
    const entries = activityLog.getRecentActivity(100);
    const moveEntries = entries.filter((e) => e.action === 'move');
    expect(moveEntries).toHaveLength(0);
  });
});
