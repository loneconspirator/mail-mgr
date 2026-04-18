import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProposalStore } from '../../../src/tracking/proposals.js';
import type { ProposalKey } from '../../../src/shared/types.js';

let db: Database.Database;
let store: ProposalStore;

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
  database.exec(`
    CREATE TABLE IF NOT EXISTS proposed_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      envelope_recipient TEXT,
      source_folder TEXT NOT NULL,
      destination_folder TEXT NOT NULL,
      matching_count INTEGER NOT NULL DEFAULT 0,
      contradicting_count INTEGER NOT NULL DEFAULT 0,
      destination_counts TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      dismissed_at TEXT,
      signals_since_dismiss INTEGER NOT NULL DEFAULT 0,
      approved_rule_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_signal_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_key
    ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposed_rules(status)`);
}

function makeKey(overrides: Partial<ProposalKey> = {}): ProposalKey {
  return {
    sender: 'alice@example.com',
    envelopeRecipient: null,
    sourceFolder: 'INBOX',
    ...overrides,
  };
}

function insertSignal(database: Database.Database, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    message_id: `<msg-${Date.now()}-${Math.random()}@example.com>`,
    sender: 'alice@example.com',
    subject: 'Test Subject',
    read_status: 'unread',
    source_folder: 'INBOX',
    destination_folder: 'Archive',
    ...overrides,
  };
  const result = database.prepare(`
    INSERT INTO move_signals (message_id, sender, envelope_recipient, subject, read_status, source_folder, destination_folder)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaults.message_id,
    defaults.sender,
    defaults.envelope_recipient ?? null,
    defaults.subject,
    defaults.read_status,
    defaults.source_folder,
    defaults.destination_folder,
  );
  return result.lastInsertRowid as number;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  createSchema(db);
  store = new ProposalStore(db);
});

afterEach(() => {
  db.close();
});

describe('ProposalStore', () => {
  describe('upsertProposal', () => {
    it('creates a new proposal with matching_count=1 for a new key', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].sender).toBe('alice@example.com');
      expect(proposals[0].envelopeRecipient).toBeNull();
      expect(proposals[0].sourceFolder).toBe('INBOX');
      expect(proposals[0].destinationFolder).toBe('Archive');
      expect(proposals[0].matchingCount).toBe(1);
      expect(proposals[0].contradictingCount).toBe(0);
      expect(proposals[0].destinationCounts).toEqual({ Archive: 1 });
      expect(proposals[0].status).toBe('active');
    });

    it('increments matching_count for same key + same destination', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);
      store.upsertProposal(key, 'Archive', 2);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].matchingCount).toBe(2);
      expect(proposals[0].contradictingCount).toBe(0);
      expect(proposals[0].destinationCounts).toEqual({ Archive: 2 });
    });

    it('increments contradicting_count for same key + different destination', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);
      store.upsertProposal(key, 'Trash', 2);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      // Archive=1, Trash=1; dominant=Archive (first seen), matching=1, contradicting=1
      expect(proposals[0].matchingCount).toBe(1);
      expect(proposals[0].contradictingCount).toBe(1);
      expect(proposals[0].destinationCounts).toEqual({ Archive: 1, Trash: 1 });
    });

    it('keeps dominant destination as destination_folder when conflicting', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);
      store.upsertProposal(key, 'Trash', 2);
      store.upsertProposal(key, 'Trash', 3);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      // Trash=2, Archive=1 -> dominant=Trash
      expect(proposals[0].destinationFolder).toBe('Trash');
      expect(proposals[0].matchingCount).toBe(2);
      expect(proposals[0].contradictingCount).toBe(1);
    });

    it('skips upsert when status is approved', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);

      // Manually approve
      const proposals = store.getProposals();
      store.approveProposal(proposals[0].id, 'rule-123');

      // Try to upsert again
      store.upsertProposal(key, 'Archive', 2);

      // Should not have changed
      const byId = store.getById(proposals[0].id);
      expect(byId).not.toBeNull();
      expect(byId!.matchingCount).toBe(1);
      expect(byId!.status).toBe('approved');
    });

    it('increments signals_since_dismiss for dismissed proposals and resurfaces at 5', () => {
      const key = makeKey();
      store.upsertProposal(key, 'Archive', 1);

      const proposals = store.getProposals();
      store.dismissProposal(proposals[0].id);

      // Verify dismissed
      let byId = store.getById(proposals[0].id);
      expect(byId!.status).toBe('dismissed');
      expect(byId!.signalsSinceDismiss).toBe(0);

      // Send 4 more signals — still dismissed
      for (let i = 2; i <= 5; i++) {
        store.upsertProposal(key, 'Archive', i);
      }
      byId = store.getById(proposals[0].id);
      expect(byId!.status).toBe('dismissed');
      expect(byId!.signalsSinceDismiss).toBe(4);

      // 5th signal after dismiss — resurfaces
      store.upsertProposal(key, 'Archive', 6);
      byId = store.getById(proposals[0].id);
      expect(byId!.status).toBe('active');
      expect(byId!.signalsSinceDismiss).toBe(0);
    });

    it('normalizes empty string envelope_recipient to null', () => {
      const key = makeKey({ envelopeRecipient: '' });
      store.upsertProposal(key, 'Archive', 1);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].envelopeRecipient).toBeNull();
    });

    it('treats null and empty envelope_recipient as the same key', () => {
      store.upsertProposal(makeKey({ envelopeRecipient: null }), 'Archive', 1);
      store.upsertProposal(makeKey({ envelopeRecipient: '' }), 'Archive', 2);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].matchingCount).toBe(2);
    });
  });

  describe('getProposals', () => {
    it('returns proposals sorted by strength DESC then last_signal_at DESC', () => {
      store.upsertProposal(makeKey({ sender: 'weak@example.com' }), 'Archive', 1);
      store.upsertProposal(makeKey({ sender: 'strong@example.com' }), 'Archive', 2);
      store.upsertProposal(makeKey({ sender: 'strong@example.com' }), 'Archive', 3);
      store.upsertProposal(makeKey({ sender: 'strong@example.com' }), 'Archive', 4);

      const proposals = store.getProposals();
      expect(proposals).toHaveLength(2);
      expect(proposals[0].sender).toBe('strong@example.com');
      expect(proposals[0].strength).toBe(3);
      expect(proposals[1].sender).toBe('weak@example.com');
      expect(proposals[1].strength).toBe(1);
    });

    it('includes computed strength field', () => {
      store.upsertProposal(makeKey(), 'Archive', 1);
      store.upsertProposal(makeKey(), 'Trash', 2);

      const proposals = store.getProposals();
      expect(proposals[0].strength).toBe(0); // 1 matching - 1 contradicting
    });

    it('excludes approved proposals', () => {
      store.upsertProposal(makeKey({ sender: 'a@example.com' }), 'Archive', 1);
      store.upsertProposal(makeKey({ sender: 'b@example.com' }), 'Archive', 2);

      const proposals = store.getProposals();
      store.approveProposal(proposals[0].id, 'rule-1');

      const remaining = store.getProposals();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sender).toBe('b@example.com');
    });

    it('excludes dismissed proposals from the list', () => {
      store.upsertProposal(makeKey({ sender: 'a@example.com' }), 'Archive', 1);
      store.upsertProposal(makeKey({ sender: 'b@example.com' }), 'Archive', 2);

      const proposals = store.getProposals();
      store.dismissProposal(proposals[0].id);

      const remaining = store.getProposals();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sender).toBe('b@example.com');
    });
  });

  describe('getById', () => {
    it('returns a single proposal by id', () => {
      store.upsertProposal(makeKey(), 'Archive', 1);
      const proposals = store.getProposals();
      const result = store.getById(proposals[0].id);
      expect(result).not.toBeNull();
      expect(result!.sender).toBe('alice@example.com');
    });

    it('returns null for non-existent id', () => {
      expect(store.getById(999)).toBeNull();
    });
  });

  describe('getExampleSubjects', () => {
    it('returns up to N recent subjects matching the proposal key', () => {
      // Insert signals matching the key
      for (let i = 1; i <= 5; i++) {
        insertSignal(db, {
          message_id: `<msg-${i}@example.com>`,
          sender: 'alice@example.com',
          subject: `Subject ${i}`,
          source_folder: 'INBOX',
          destination_folder: 'Archive',
        });
      }

      const examples = store.getExampleSubjects('alice@example.com', null, 'INBOX', 3);
      expect(examples).toHaveLength(3);
      // Most recent first
      expect(examples[0].subject).toBe('Subject 5');
      expect(examples[1].subject).toBe('Subject 4');
      expect(examples[2].subject).toBe('Subject 3');
    });

    it('returns empty array when no matching signals exist', () => {
      const examples = store.getExampleSubjects('nobody@example.com', null, 'INBOX', 3);
      expect(examples).toHaveLength(0);
    });
  });

  describe('approveProposal', () => {
    it('sets status to approved and stores approved_rule_id', () => {
      store.upsertProposal(makeKey(), 'Archive', 1);
      const proposals = store.getProposals();
      store.approveProposal(proposals[0].id, 'rule-abc');

      const byId = store.getById(proposals[0].id);
      expect(byId!.status).toBe('approved');
      expect(byId!.approvedRuleId).toBe('rule-abc');
    });
  });

  describe('dismissProposal', () => {
    it('sets status to dismissed with dismissed_at and resets signals_since_dismiss', () => {
      store.upsertProposal(makeKey(), 'Archive', 1);
      const proposals = store.getProposals();
      store.dismissProposal(proposals[0].id);

      const byId = store.getById(proposals[0].id);
      expect(byId!.status).toBe('dismissed');
      expect(byId!.dismissedAt).not.toBeNull();
      expect(byId!.signalsSinceDismiss).toBe(0);
    });
  });
});
