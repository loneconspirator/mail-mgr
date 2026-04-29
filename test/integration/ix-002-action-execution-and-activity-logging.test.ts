/**
 * Integration test for IX-002 — Rule-matched action execution and activity logging.
 *
 * Spec: specs/integrations/ix-002-action-execution-and-activity-logging.md
 *
 * Drives ActionExecutor (MOD-0006) end-to-end against a mocked ImapClient
 * (MOD-0002) and a real ActivityLog (MOD-0007) backed by SQLite. The caller
 * role (Monitor / ReviewSweeper / BatchEngine) is impersonated by direct
 * calls to executeAction + activityLog.logActivity, mirroring how every real
 * caller uses these two collaborators.
 *
 * Named-interaction coverage:
 *   IX-002.1 — executeAction receives message + matched rule + source context.
 *   IX-002.2 — `move` action → ImapClient.moveMessage(uid, rule.action.folder).
 *   IX-002.3 — `review` action → moveMessage to the review folder.
 *   IX-002.4 — `skip` action → no IMAP operation.
 *   IX-002.5 — `delete` action → moveMessage to the trash folder.
 *   IX-002.6 — Missing destination folder triggers createMailbox + retry.
 *   IX-002.7 — ActivityLog records timestamp, metadata, rule, action, folder,
 *              source, success/error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAction, type ActionContext } from '../../src/actions/index.js';
import { ActivityLog } from '../../src/log/index.js';
import type { ImapClient, EmailMessage } from '../../src/imap/index.js';
import type { Rule } from '../../src/config/index.js';

const REVIEW = 'Review';
const TRASH = 'Trash';

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 42,
    messageId: '<m42@example.com>',
    from: { name: 'Foo', address: 'foo@bar.com' },
    to: [{ name: 'Me', address: 'me@example.com' }],
    cc: [],
    subject: 'Hello',
    date: new Date('2026-04-01T00:00:00Z'),
    flags: new Set<string>(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Move foo',
    match: { sender: 'foo@bar.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeMockClient(): ImapClient & {
  moveMessage: ReturnType<typeof vi.fn>;
  createMailbox: ReturnType<typeof vi.fn>;
} {
  return {
    state: 'connected',
    moveMessage: vi.fn().mockResolvedValue(undefined),
    createMailbox: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient & {
    moveMessage: ReturnType<typeof vi.fn>;
    createMailbox: ReturnType<typeof vi.fn>;
  };
}

describe('IX-002 — Action execution and activity logging', () => {
  let tmpDir: string;
  let activityLog: ActivityLog;
  let client: ReturnType<typeof makeMockClient>;
  let ctx: ActionContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-002-'));
    activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
    client = makeMockClient();
    ctx = {
      client,
      reviewFolder: REVIEW,
      trashFolder: TRASH,
      sourceFolder: 'INBOX',
    };
  });

  afterEach(() => {
    activityLog.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('IX-002.1 / IX-002.2 / IX-002.7: move action invokes moveMessage with the rule destination and writes an activity row tagged with the source', async () => {
    const message = makeMessage({ uid: 100 });
    const rule = makeRule({ action: { type: 'move', folder: 'Archive/Reports' } });

    // IX-002.1: caller passes message + matched rule (source folder is on ctx).
    const result = await executeAction(ctx, message, rule);

    // IX-002.2: client.moveMessage called with rule.action.folder.
    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(100, 'Archive/Reports', 'INBOX');
    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(result.folder).toBe('Archive/Reports');

    // IX-002.7: caller logs the result with a source tag (here: arrival).
    activityLog.logActivity(result, message, rule, 'arrival');
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message_uid: 100,
      message_id: '<m42@example.com>',
      rule_id: 'rule-1',
      rule_name: 'Move foo',
      action: 'move',
      folder: 'Archive/Reports',
      source: 'arrival',
      success: 1,
      error: null,
    });
    expect(entries[0].timestamp).toBeTruthy();
  });

  it('IX-002.3: review action moves the message to the review folder configured on the context', async () => {
    const message = makeMessage({ uid: 101 });
    const rule = makeRule({ id: 'r-rev', action: { type: 'review' } });

    const result = await executeAction(ctx, message, rule);

    expect(client.moveMessage).toHaveBeenCalledWith(101, REVIEW, 'INBOX');
    expect(result.action).toBe('review');
    expect(result.folder).toBe(REVIEW);
    expect(result.success).toBe(true);

    activityLog.logActivity(result, message, rule, 'arrival');
    const e = activityLog.getRecentActivity()[0];
    expect(e.action).toBe('review');
    expect(e.folder).toBe(REVIEW);
  });

  it('IX-002.4: skip action performs no IMAP operation but still produces a logged success result', async () => {
    const message = makeMessage({ uid: 102 });
    const rule = makeRule({ id: 'r-skip', action: { type: 'skip' } });

    const result = await executeAction(ctx, message, rule);

    expect(client.moveMessage).not.toHaveBeenCalled();
    expect(client.createMailbox).not.toHaveBeenCalled();
    expect(result.action).toBe('skip');
    expect(result.success).toBe(true);
    expect(result.folder).toBeUndefined();

    activityLog.logActivity(result, message, rule, 'arrival');
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('skip');
    expect(entries[0].folder).toBeNull();
  });

  it('IX-002.5: delete action moves the message to the trash folder', async () => {
    const message = makeMessage({ uid: 103 });
    const rule = makeRule({ id: 'r-del', action: { type: 'delete' } });

    const result = await executeAction(ctx, message, rule);

    expect(client.moveMessage).toHaveBeenCalledWith(103, TRASH, 'INBOX');
    expect(result.action).toBe('delete');
    expect(result.folder).toBe(TRASH);
    expect(result.success).toBe(true);

    activityLog.logActivity(result, message, rule, 'arrival');
    expect(activityLog.getRecentActivity()[0].folder).toBe(TRASH);
  });

  it('IX-002.6: missing destination folder triggers createMailbox + retry; activity reflects success', async () => {
    const message = makeMessage({ uid: 200 });
    const rule = makeRule({ action: { type: 'move', folder: 'Archive/NewBucket' } });

    // First moveMessage call fails (folder missing); second call (after
    // createMailbox) succeeds. This is the IX-002.6 auto-create retry path.
    client.moveMessage
      .mockRejectedValueOnce(new Error('NO [TRYCREATE] Mailbox does not exist'))
      .mockResolvedValueOnce(undefined);

    const result = await executeAction(ctx, message, rule);

    expect(client.moveMessage).toHaveBeenCalledTimes(2);
    expect(client.createMailbox).toHaveBeenCalledTimes(1);
    expect(client.createMailbox).toHaveBeenCalledWith('Archive/NewBucket');
    expect(client.moveMessage).toHaveBeenNthCalledWith(2, 200, 'Archive/NewBucket', 'INBOX');
    expect(result.success).toBe(true);
    expect(result.folder).toBe('Archive/NewBucket');

    activityLog.logActivity(result, message, rule, 'arrival');
    const e = activityLog.getRecentActivity()[0];
    expect(e.success).toBe(1);
    expect(e.folder).toBe('Archive/NewBucket');
  });

  it('IX-002.7: failed move (e.g. retry also fails) is logged as success=0 with the error preserved', async () => {
    const message = makeMessage({ uid: 300 });
    const rule = makeRule({ action: { type: 'move', folder: 'BadFolder' } });

    client.moveMessage
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('still broken after createMailbox'));

    const result = await executeAction(ctx, message, rule);

    expect(result.success).toBe(false);
    expect(result.error).toContain('still broken');

    activityLog.logActivity(result, message, rule, 'sweep');
    const e = activityLog.getRecentActivity()[0];
    expect(e.success).toBe(0);
    expect(e.error).toContain('still broken');
    expect(e.source).toBe('sweep');
  });
});
