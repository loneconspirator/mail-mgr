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
    expect(e.source).toBe('arrival');
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

  it('getState returns undefined for missing keys', () => {
    expect(log.getState('nonexistent')).toBeUndefined();
  });

  it('setState and getState round-trip values', () => {
    log.setState('lastUid', '42');
    expect(log.getState('lastUid')).toBe('42');

    log.setState('lastUid', '99');
    expect(log.getState('lastUid')).toBe('99');
  });

  it('state persists across ActivityLog instances', () => {
    log.setState('lastUid', '123');
    log.close();

    const log2 = new ActivityLog(dbPath);
    expect(log2.getState('lastUid')).toBe('123');
    log2.close();

    // Re-open for afterEach cleanup
    log = new ActivityLog(dbPath);
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

  describe('source column migration', () => {
    it('adds source column on fresh database', () => {
      // Fresh DB created in beforeEach — source column should exist
      log.logActivity(makeResult(), makeMessage(), makeRule(), 'arrival');
      const entries = log.getRecentActivity();
      expect(entries[0].source).toBe('arrival');
    });

    it('adds source column idempotently on existing database without it', () => {
      // Simulate a pre-migration DB: drop the source column by creating a DB
      // without the migration, then re-open with the migration
      log.close();
      fs.rmSync(dbPath, { force: true });

      // Create a DB with the old schema (no source column)
      const Database = require('better-sqlite3');
      const rawDb = new Database(dbPath);
      rawDb.pragma('journal_mode = WAL');
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          message_uid INTEGER NOT NULL,
          message_id TEXT,
          message_from TEXT,
          message_to TEXT,
          message_subject TEXT,
          rule_id TEXT,
          rule_name TEXT,
          action TEXT NOT NULL,
          folder TEXT,
          success INTEGER NOT NULL DEFAULT 1,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      // Insert a row without source column
      rawDb.prepare(`INSERT INTO activity (timestamp, message_uid, action, success) VALUES (datetime('now'), 1, 'move', 1)`).run();
      rawDb.close();

      // Re-open with ActivityLog — migration should add the column
      log = new ActivityLog(dbPath);
      const entries = log.getRecentActivity();
      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe('arrival'); // DEFAULT value
    });
  });

  describe('getRecentFolders', () => {
    it('returns empty array when no activity exists', () => {
      expect(log.getRecentFolders()).toEqual([]);
    });

    it('returns distinct folder paths from successful moves ordered by most recent', () => {
      // Log activities to different folders at different times
      log.logActivity(
        makeResult({ messageUid: 1, folder: 'Archive', timestamp: new Date('2026-01-01T01:00:00Z') }),
        makeMessage({ uid: 1 }),
        makeRule(),
      );
      log.logActivity(
        makeResult({ messageUid: 2, folder: 'Lists', timestamp: new Date('2026-01-01T02:00:00Z') }),
        makeMessage({ uid: 2 }),
        makeRule(),
      );
      log.logActivity(
        makeResult({ messageUid: 3, folder: 'Archive', timestamp: new Date('2026-01-01T03:00:00Z') }),
        makeMessage({ uid: 3 }),
        makeRule(),
      );

      const folders = log.getRecentFolders();
      // Archive was used most recently (id=3), then Lists (id=2)
      expect(folders).toEqual(['Archive', 'Lists']);
    });

    it('excludes rows where success = 0', () => {
      log.logActivity(
        makeResult({ messageUid: 1, folder: 'Archive', success: false }),
        makeMessage({ uid: 1 }),
        makeRule(),
      );
      log.logActivity(
        makeResult({ messageUid: 2, folder: 'Lists', success: true }),
        makeMessage({ uid: 2 }),
        makeRule(),
      );

      const folders = log.getRecentFolders();
      expect(folders).toEqual(['Lists']);
    });

    it('excludes rows where folder is null or empty', () => {
      // Skip action has no folder
      log.logActivity(
        makeResult({ messageUid: 1, action: 'skip', folder: undefined }),
        makeMessage({ uid: 1 }),
        makeRule(),
      );
      log.logActivity(
        makeResult({ messageUid: 2, folder: 'Archive' }),
        makeMessage({ uid: 2 }),
        makeRule(),
      );

      const folders = log.getRecentFolders();
      expect(folders).toEqual(['Archive']);
    });

    it('respects limit parameter', () => {
      log.logActivity(makeResult({ messageUid: 1, folder: 'A' }), makeMessage({ uid: 1 }), makeRule());
      log.logActivity(makeResult({ messageUid: 2, folder: 'B' }), makeMessage({ uid: 2 }), makeRule());
      log.logActivity(makeResult({ messageUid: 3, folder: 'C' }), makeMessage({ uid: 3 }), makeRule());

      const folders = log.getRecentFolders(2);
      expect(folders).toHaveLength(2);
      expect(folders).toEqual(['C', 'B']);
    });

    it('deduplicates folders using GROUP BY', () => {
      for (let i = 1; i <= 5; i++) {
        log.logActivity(
          makeResult({ messageUid: i, folder: 'Archive' }),
          makeMessage({ uid: i }),
          makeRule(),
        );
      }

      const folders = log.getRecentFolders();
      expect(folders).toEqual(['Archive']);
    });
  });

  describe('logActivity with sweep source and null rule', () => {
    it('logs with sweep source', () => {
      log.logActivity(makeResult(), makeMessage(), makeRule(), 'sweep');
      const entries = log.getRecentActivity();
      expect(entries[0].source).toBe('sweep');
    });

    it('logs with null rule', () => {
      log.logActivity(makeResult(), makeMessage(), null, 'sweep');
      const entries = log.getRecentActivity();
      expect(entries[0].rule_id).toBeNull();
      expect(entries[0].rule_name).toBeNull();
      expect(entries[0].source).toBe('sweep');
    });

    it('defaults source to arrival when omitted', () => {
      log.logActivity(makeResult(), makeMessage(), makeRule());
      const entries = log.getRecentActivity();
      expect(entries[0].source).toBe('arrival');
    });
  });
});
