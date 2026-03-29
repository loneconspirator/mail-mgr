import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ActivityLog } from '../../../src/log/index.js';
import type { ActionResult } from '../../../src/actions/index.js';
import type { EmailMessage } from '../../../src/imap/index.js';
import type { Rule } from '../../../src/config/index.js';

let tmpDir: string;
let dbPath: string;
let log: ActivityLog;

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 42,
    messageId: '<msg-42@example.com>',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    subject: 'Test message',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    success: true,
    messageUid: 42,
    messageId: '<msg-42@example.com>',
    action: 'move',
    folder: 'Archive',
    rule: 'test-rule',
    timestamp: new Date('2026-02-24T12:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailmgr-log-'));
  dbPath = path.join(tmpDir, 'db.sqlite3');
  log = new ActivityLog(dbPath);
});

afterEach(() => {
  log.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ActivityLog', () => {
  it('creates the database and table on construction', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const entries = log.getRecentActivity();
    expect(entries).toEqual([]);
  });

  it('logs activity with all fields', () => {
    log.logActivity(makeResult(), makeMessage(), makeRule());

    const entries = log.getRecentActivity();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.message_uid).toBe(42);
    expect(e.message_id).toBe('<msg-42@example.com>');
    expect(e.message_from).toBe('alice@example.com');
    expect(e.message_to).toBe('bob@example.com');
    expect(e.message_subject).toBe('Test message');
    expect(e.rule_id).toBe('test-rule');
    expect(e.rule_name).toBe('Test Rule');
    expect(e.action).toBe('move');
    expect(e.folder).toBe('Archive');
    expect(e.success).toBe(1);
    expect(e.error).toBeNull();
  });

  it('logs failed actions with error message', () => {
    const result = makeResult({ success: false, error: 'Folder not found' });
    log.logActivity(result, makeMessage(), makeRule());

    const entries = log.getRecentActivity();
    expect(entries[0].success).toBe(0);
    expect(entries[0].error).toBe('Folder not found');
  });

  it('returns entries in reverse chronological order', () => {
    for (let i = 1; i <= 3; i++) {
      log.logActivity(
        makeResult({ messageUid: i, timestamp: new Date(`2026-02-2${i}T12:00:00Z`) }),
        makeMessage({ uid: i }),
        makeRule(),
      );
    }

    const entries = log.getRecentActivity();
    expect(entries).toHaveLength(3);
    expect(entries[0].message_uid).toBe(3);
    expect(entries[1].message_uid).toBe(2);
    expect(entries[2].message_uid).toBe(1);
  });

  it('supports pagination with limit and offset', () => {
    for (let i = 1; i <= 5; i++) {
      log.logActivity(
        makeResult({ messageUid: i }),
        makeMessage({ uid: i }),
        makeRule(),
      );
    }

    const page1 = log.getRecentActivity(2, 0);
    expect(page1).toHaveLength(2);
    expect(page1[0].message_uid).toBe(5);
    expect(page1[1].message_uid).toBe(4);

    const page2 = log.getRecentActivity(2, 2);
    expect(page2).toHaveLength(2);
    expect(page2[0].message_uid).toBe(3);
    expect(page2[1].message_uid).toBe(2);
  });

  it('prunes old entries and keeps recent ones', () => {
    // Insert an old entry by manipulating timestamp directly
    const db = (log as any).db;
    db.prepare(`
      INSERT INTO activity (timestamp, message_uid, action, success)
      VALUES (datetime('now', '-60 days'), 1, 'move', 1)
    `).run();

    // Insert a recent entry (use current time so it's within 30-day window)
    log.logActivity(makeResult({ messageUid: 99, timestamp: new Date() }), makeMessage({ uid: 99 }), makeRule());

    expect(log.getRecentActivity()).toHaveLength(2);

    const pruned = log.prune(30);
    expect(pruned).toBe(1);

    const remaining = log.getRecentActivity();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message_uid).toBe(99);
  });

  it('includes cc recipients in message_to field', () => {
    const msg = makeMessage({
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [{ name: 'Carol', address: 'carol@example.com' }],
    });
    log.logActivity(makeResult(), msg, makeRule());

    const entries = log.getRecentActivity();
    expect(entries[0].message_to).toBe('bob@example.com, carol@example.com');
  });
});
