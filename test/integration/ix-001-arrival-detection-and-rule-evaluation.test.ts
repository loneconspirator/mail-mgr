/**
 * Integration test for IX-001 — IMAP arrival detection and rule evaluation.
 *
 * Spec: specs/integrations/ix-001-arrival-detection-and-rule-evaluation.md
 *
 * Drives the Monitor (MOD-0001) end-to-end against a mocked ImapClient
 * (MOD-0002) and a real ActivityLog (MOD-0007). The collaborators that the
 * spec lists as participants — SentinelDetector (MOD-0003), RuleEvaluator
 * (MOD-0004), RuleMatcher (MOD-0005) — are exercised through their real
 * exports so the chain "newMail → fetch → guard → evaluate → matched rule"
 * is verified, not just stubbed at every seam.
 *
 * Named-interaction coverage:
 *   IX-001.1 — IDLE newMail → Monitor fetches messages with UID > lastUid.
 *   IX-001.2 — Sentinel-flagged messages are skipped before rule evaluation.
 *   IX-001.3 — Non-sentinel messages are passed to RuleEvaluator with the
 *              enabled rules sorted by `order`.
 *   IX-001.4 — Rules that need envelope data (deliveredTo / visibility) are
 *              skipped when the message has no envelope recipient.
 *   IX-001.5 — RuleMatcher tests sender/recipient/subject/etc. with AND
 *              semantics — every specified field must match.
 *   IX-001.6 — First matching rule wins; no match → null and message stays
 *              in INBOX (no activity log row).
 *   IX-001.7 — Monitor advances lastUid past the highest processed UID and
 *              persists it via ActivityLog.setState.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { Monitor } from '../../src/monitor/index.js';
import { ActivityLog } from '../../src/log/index.js';
import type { ImapClient, ImapFetchResult } from '../../src/imap/index.js';
import { configSchema, type Config, type Rule } from '../../src/config/schema.js';
import { SENTINEL_HEADER } from '../../src/sentinel/detect.js';

const silentLogger = pino({ level: 'silent' });

function makeConfig(rules: Rule[], envelopeHeader?: string): Config {
  return configSchema.parse({
    imap: {
      host: 'localhost',
      port: 3143,
      tls: false,
      auth: { user: 'user', pass: 'pass' },
      ...(envelopeHeader ? { envelopeHeader } : {}),
    },
    server: { port: 3000, host: '127.0.0.1' },
    rules,
  });
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: 'foo@bar.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeFetchResult(overrides: Partial<ImapFetchResult> & { uid: number }): ImapFetchResult {
  return {
    uid: overrides.uid,
    flags: overrides.flags ?? new Set(),
    envelope: {
      date: new Date('2026-04-01T00:00:00Z'),
      subject: 'Hello',
      messageId: `<msg-${overrides.uid}@example.com>`,
      from: [{ name: '', address: 'foo@bar.com' }],
      to: [{ name: '', address: 'me@example.com' }],
      cc: [],
      ...overrides.envelope,
    },
    headers: overrides.headers,
  };
}

function makeMockClient(): ImapClient & {
  fetchNewMessages: ReturnType<typeof vi.fn>;
  moveMessage: ReturnType<typeof vi.fn>;
  createMailbox: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  return {
    state: 'connected',
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    fetchNewMessages: vi.fn().mockResolvedValue([]),
    moveMessage: vi.fn().mockResolvedValue(undefined),
    createMailbox: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient & {
    fetchNewMessages: ReturnType<typeof vi.fn>;
    moveMessage: ReturnType<typeof vi.fn>;
    createMailbox: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  };
}

describe('IX-001 — IMAP arrival detection and rule evaluation', () => {
  let tmpDir: string;
  let activityLog: ActivityLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-001-'));
    activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
  });

  afterEach(() => {
    activityLog.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('IX-001.1: processNewMessages calls fetchNewMessages with the persisted lastUid', async () => {
    // Seed lastUid so we prove the cursor is honored, not always 0.
    activityLog.setState('lastUid', '42');

    const client = makeMockClient();
    client.fetchNewMessages.mockResolvedValue([]);

    const monitor = new Monitor(makeConfig([makeRule()]), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    expect(client.fetchNewMessages).toHaveBeenCalledTimes(1);
    expect(client.fetchNewMessages).toHaveBeenCalledWith(42);
  });

  it('IX-001.2: sentinel messages are skipped — no rule eval, no action, no log row', async () => {
    const client = makeMockClient();
    const sentinelHeaders = Buffer.from(
      `${SENTINEL_HEADER}: <sentinel-1@mail-manager.sentinel>\r\n`,
    );
    client.fetchNewMessages.mockResolvedValue([
      makeFetchResult({
        uid: 10,
        envelope: {
          from: [{ name: '', address: 'foo@bar.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'sentinel',
          messageId: '<sentinel-1@mail-manager.sentinel>',
        },
        headers: sentinelHeaders,
      }),
    ]);

    const rule = makeRule(); // would otherwise match foo@bar.com → Archive
    const monitor = new Monitor(makeConfig([rule]), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    // Sentinel guard short-circuits before action execution.
    expect(client.moveMessage).not.toHaveBeenCalled();
    expect(activityLog.getRecentActivity()).toHaveLength(0);
  });

  it('IX-001.3 / IX-001.5 / IX-001.6: first matching rule (by order) wins; AND semantics on match fields', async () => {
    const client = makeMockClient();
    client.fetchNewMessages.mockResolvedValue([
      makeFetchResult({
        uid: 5,
        envelope: {
          from: [{ name: '', address: 'foo@bar.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'Quarterly Update',
          messageId: '<m5@example.com>',
        },
      }),
    ]);

    // Two rules:
    //   r-broad (order 2) matches sender alone — would catch the message.
    //   r-specific (order 1) requires sender AND subject — both match here,
    //     so first-by-order wins (IX-001.6).
    const broad = makeRule({
      id: 'r-broad',
      name: 'Broad',
      match: { sender: 'foo@bar.com' },
      action: { type: 'move', folder: 'Archive' },
      order: 2,
    });
    const specific = makeRule({
      id: 'r-specific',
      name: 'Specific',
      // IX-001.5: AND across sender + subject — both must match.
      match: { sender: 'foo@bar.com', subject: '*Quarterly*' },
      action: { type: 'move', folder: 'Reports' },
      order: 1,
    });

    const monitor = new Monitor(makeConfig([broad, specific]), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    // IX-001.3: rules considered in order — specific (order 1) wins over broad.
    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(5, 'Reports', undefined);
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].rule_id).toBe('r-specific');
    expect(entries[0].folder).toBe('Reports');
  });

  it('IX-001.4: rules requiring envelope data are skipped when the message has none', async () => {
    const client = makeMockClient();
    client.fetchNewMessages.mockResolvedValue([
      makeFetchResult({
        uid: 7,
        envelope: {
          from: [{ name: '', address: 'foo@bar.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'No envelope header here',
          messageId: '<m7@example.com>',
        },
      }),
    ]);

    // Rule needing deliveredTo (envelope data) should be skipped — no
    // x-envelope-to header on the message → envelopeRecipient undefined.
    const envRule = makeRule({
      id: 'r-env',
      name: 'Needs envelope',
      match: { sender: 'foo@bar.com', deliveredTo: 'me@example.com' },
      action: { type: 'move', folder: 'EnvFolder' },
      order: 1,
    });
    // Fallback rule that does NOT need envelope data — should win because the
    // env-needing rule is filtered out (IX-001.4) rather than tried-and-failed.
    const fallback = makeRule({
      id: 'r-plain',
      name: 'Plain',
      match: { sender: 'foo@bar.com' },
      action: { type: 'move', folder: 'PlainFolder' },
      order: 2,
    });

    const monitor = new Monitor(makeConfig([envRule, fallback], 'X-Envelope-To'), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(7, 'PlainFolder', undefined);
    expect(activityLog.getRecentActivity()[0].rule_id).toBe('r-plain');
  });

  it('IX-001.6: no rule matches → null → message stays in INBOX, no log row', async () => {
    const client = makeMockClient();
    client.fetchNewMessages.mockResolvedValue([
      makeFetchResult({
        uid: 11,
        envelope: {
          from: [{ name: '', address: 'unknown@nowhere.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'Stranger',
          messageId: '<m11@example.com>',
        },
      }),
    ]);

    const rule = makeRule({ match: { sender: 'foo@bar.com' } }); // does NOT match
    const monitor = new Monitor(makeConfig([rule]), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    expect(client.moveMessage).not.toHaveBeenCalled();
    expect(activityLog.getRecentActivity()).toHaveLength(0);
  });

  it('IX-001.7: lastUid advances to the highest processed UID and is persisted', async () => {
    const client = makeMockClient();
    client.fetchNewMessages.mockResolvedValueOnce([
      makeFetchResult({
        uid: 100,
        envelope: {
          from: [{ name: '', address: 'unknown@nowhere.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'first',
          messageId: '<m100@example.com>',
        },
      }),
      makeFetchResult({
        uid: 101,
        envelope: {
          from: [{ name: '', address: 'unknown@nowhere.com' }],
          to: [{ name: '', address: 'me@example.com' }],
          cc: [],
          subject: 'second',
          messageId: '<m101@example.com>',
        },
      }),
    ]);

    // No rule matches — IX-001.7 should still fire (cursor advances on every
    // processed message, matched or not).
    const monitor = new Monitor(makeConfig([makeRule({ match: { sender: 'never@matches.com' } })]), {
      imapClient: client,
      activityLog,
      logger: silentLogger,
    });

    await monitor.processNewMessages();

    expect(activityLog.getState('lastUid')).toBe('101');

    // A second pass uses the persisted cursor.
    client.fetchNewMessages.mockResolvedValueOnce([]);
    await monitor.processNewMessages();
    expect(client.fetchNewMessages).toHaveBeenLastCalledWith(101);
  });
});
