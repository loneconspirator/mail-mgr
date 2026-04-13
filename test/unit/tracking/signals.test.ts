import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SignalStore } from '../../../src/tracking/signals.js';
import type { MoveSignalInput } from '../../../src/tracking/signals.js';

let db: Database.Database;
let store: SignalStore;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS move_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      message_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      envelope_recipient TEXT,
      list_id TEXT,
      subject TEXT NOT NULL,
      read_status TEXT NOT NULL,
      visibility TEXT,
      source_folder TEXT NOT NULL,
      destination_folder TEXT NOT NULL
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON move_signals(timestamp)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_signals_sender ON move_signals(sender)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_signals_destination ON move_signals(destination_folder)`);
}

function makeInput(overrides: Partial<MoveSignalInput> = {}): MoveSignalInput {
  return {
    messageId: '<test-msg@example.com>',
    sender: 'alice@example.com',
    subject: 'Test Subject',
    readStatus: 'unread',
    sourceFolder: 'INBOX',
    destinationFolder: 'Archive',
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  createSchema(db);
  store = new SignalStore(db);
});

afterEach(() => {
  db.close();
});

describe('SignalStore', () => {
  describe('logSignal', () => {
    it('inserts a row with all fields and returns the inserted id', () => {
      const id = store.logSignal(makeInput({
        envelopeRecipient: 'bob@example.com',
        listId: '<list.example.com>',
        visibility: 'normal',
      }));

      expect(id).toBe(1);

      const row = db.prepare('SELECT * FROM move_signals WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row.message_id).toBe('<test-msg@example.com>');
      expect(row.sender).toBe('alice@example.com');
      expect(row.envelope_recipient).toBe('bob@example.com');
      expect(row.list_id).toBe('<list.example.com>');
      expect(row.subject).toBe('Test Subject');
      expect(row.read_status).toBe('unread');
      expect(row.visibility).toBe('normal');
      expect(row.source_folder).toBe('INBOX');
      expect(row.destination_folder).toBe('Archive');
    });

    it('inserts with optional fields as null', () => {
      const id = store.logSignal(makeInput());

      const row = db.prepare('SELECT * FROM move_signals WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row.envelope_recipient).toBeNull();
      expect(row.list_id).toBeNull();
      expect(row.visibility).toBeNull();
    });
  });

  describe('getSignals', () => {
    it('returns recent signals in reverse chronological order', () => {
      store.logSignal(makeInput({ messageId: '<msg-1@example.com>' }));
      store.logSignal(makeInput({ messageId: '<msg-2@example.com>' }));
      store.logSignal(makeInput({ messageId: '<msg-3@example.com>' }));

      const signals = store.getSignals();
      expect(signals).toHaveLength(3);
      expect(signals[0].messageId).toBe('<msg-3@example.com>');
      expect(signals[1].messageId).toBe('<msg-2@example.com>');
      expect(signals[2].messageId).toBe('<msg-1@example.com>');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        store.logSignal(makeInput({ messageId: `<msg-${i}@example.com>` }));
      }

      const signals = store.getSignals(2);
      expect(signals).toHaveLength(2);
    });
  });

  describe('getSignalByMessageId', () => {
    it('returns null when no signal exists for a message_id', () => {
      const result = store.getSignalByMessageId('<nonexistent@example.com>');
      expect(result).toBeNull();
    });

    it('returns the signal when one exists', () => {
      store.logSignal(makeInput({ messageId: '<found@example.com>', sender: 'found@test.com' }));

      const result = store.getSignalByMessageId('<found@example.com>');
      expect(result).not.toBeNull();
      expect(result!.messageId).toBe('<found@example.com>');
      expect(result!.sender).toBe('found@test.com');
    });
  });

  describe('prune', () => {
    it('deletes signals older than specified days', () => {
      // Insert an old signal by manipulating timestamp directly
      db.prepare(`
        INSERT INTO move_signals (timestamp, message_id, sender, subject, read_status, source_folder, destination_folder)
        VALUES (datetime('now', '-100 days'), '<old@example.com>', 'old@test.com', 'Old', 'read', 'INBOX', 'Archive')
      `).run();

      // Insert a recent signal
      store.logSignal(makeInput({ messageId: '<recent@example.com>' }));

      const pruned = store.prune(90);
      expect(pruned).toBe(1);

      const remaining = store.getSignals();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].messageId).toBe('<recent@example.com>');
    });

    it('keeps signals newer than the threshold', () => {
      store.logSignal(makeInput({ messageId: '<recent@example.com>' }));

      const pruned = store.prune(90);
      expect(pruned).toBe(0);

      const remaining = store.getSignals();
      expect(remaining).toHaveLength(1);
    });

    it('defaults to 90 days', () => {
      // Insert a signal 91 days old
      db.prepare(`
        INSERT INTO move_signals (timestamp, message_id, sender, subject, read_status, source_folder, destination_folder)
        VALUES (datetime('now', '-91 days'), '<old@example.com>', 'old@test.com', 'Old', 'read', 'INBOX', 'Archive')
      `).run();

      const pruned = store.prune();
      expect(pruned).toBe(1);
    });
  });
});
