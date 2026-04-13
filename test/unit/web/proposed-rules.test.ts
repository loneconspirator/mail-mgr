import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerProposedRuleRoutes } from '../../../src/web/routes/proposed-rules.js';
import { ProposalStore } from '../../../src/tracking/proposals.js';
import type { ServerDeps } from '../../../src/web/server.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE move_signals (
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
  db.exec(`
    CREATE TABLE proposed_rules (
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
  db.exec(`CREATE UNIQUE INDEX idx_proposals_key
    ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder)`);
  return db;
}

function insertProposal(
  db: Database.Database,
  overrides: Partial<{
    sender: string;
    envelope_recipient: string | null;
    source_folder: string;
    destination_folder: string;
    matching_count: number;
    contradicting_count: number;
    destination_counts: string;
    status: string;
    dismissed_at: string | null;
    signals_since_dismiss: number;
  }> = {},
): number {
  const defaults = {
    sender: 'test@example.com',
    envelope_recipient: null,
    source_folder: 'INBOX',
    destination_folder: 'Archive',
    matching_count: 5,
    contradicting_count: 0,
    destination_counts: JSON.stringify({ Archive: 5 }),
    status: 'active',
    dismissed_at: null,
    signals_since_dismiss: 0,
  };
  const vals = { ...defaults, ...overrides };
  const stmt = db.prepare(`
    INSERT INTO proposed_rules (sender, envelope_recipient, source_folder, destination_folder,
      matching_count, contradicting_count, destination_counts, status, dismissed_at, signals_since_dismiss)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    vals.sender, vals.envelope_recipient, vals.source_folder, vals.destination_folder,
    vals.matching_count, vals.contradicting_count, vals.destination_counts,
    vals.status, vals.dismissed_at, vals.signals_since_dismiss,
  );
  return info.lastInsertRowid as number;
}

function insertSignal(db: Database.Database, sender: string, sourceFolder: string, subject: string, destFolder: string): void {
  db.prepare(`
    INSERT INTO move_signals (message_id, sender, subject, read_status, source_folder, destination_folder)
    VALUES (?, ?, ?, 'unread', ?, ?)
  `).run(`msg-${Math.random()}`, sender, subject, sourceFolder, destFolder);
}

let app: FastifyInstance;
let db: Database.Database;
let proposalStore: ProposalStore;
let mockAddRule: ReturnType<typeof vi.fn>;

function buildApp(): FastifyInstance {
  db = createTestDb();
  proposalStore = new ProposalStore(db);
  mockAddRule = vi.fn().mockReturnValue({
    id: 'fake-uuid-123',
    name: 'Auto: test@example.com',
    match: { sender: 'test@example.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 0,
  });

  const deps = {
    getProposalStore: () => proposalStore,
    configRepo: { addRule: mockAddRule },
  } as unknown as ServerDeps;

  const fastify = Fastify({ logger: false });
  registerProposedRuleRoutes(fastify, deps);
  return fastify;
}

beforeEach(() => {
  app = buildApp();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /api/proposed-rules', () => {
  it('returns 200 with empty array when no proposals exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it('returns proposals with strengthLabel, examples, conflictAnnotation, resurfacedNotice', async () => {
    insertProposal(db, {
      sender: 'news@example.com',
      matching_count: 6,
      contradicting_count: 0,
      destination_counts: JSON.stringify({ Archive: 6 }),
    });
    insertSignal(db, 'news@example.com', 'INBOX', 'Newsletter #1', 'Archive');
    insertSignal(db, 'news@example.com', 'INBOX', 'Newsletter #2', 'Archive');

    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });
    expect(res.statusCode).toBe(200);
    const cards = JSON.parse(res.payload);
    expect(cards).toHaveLength(1);

    const card = cards[0];
    expect(card.strengthLabel).toBe('Strong pattern (6 moves)');
    expect(card.examples).toHaveLength(2);
    expect(card.conflictAnnotation).toBeNull();
    expect(card.resurfacedNotice).toBeNull();
  });

  it('computes correct strength labels for different thresholds', async () => {
    // Strong: matching >= 5 (strength = 5 - 0 = 5)
    insertProposal(db, { sender: 'strong@e.com', matching_count: 5, contradicting_count: 0, destination_counts: JSON.stringify({ A: 5 }) });
    // Moderate: matching 3, strength = 3
    insertProposal(db, { sender: 'mod@e.com', matching_count: 3, contradicting_count: 0, destination_counts: JSON.stringify({ A: 3 }) });
    // Weak: matching 1, strength = 1
    insertProposal(db, { sender: 'weak@e.com', matching_count: 1, contradicting_count: 0, destination_counts: JSON.stringify({ A: 1 }) });
    // Ambiguous: matching 2, contradicting 3, strength = -1
    insertProposal(db, { sender: 'amb@e.com', matching_count: 2, contradicting_count: 3, destination_counts: JSON.stringify({ A: 2, B: 3 }) });

    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });
    const cards = JSON.parse(res.payload);

    const byLabel = (label: string) => cards.find((c: any) => c.strengthLabel === label);
    expect(byLabel('Strong pattern (5 moves)')).toBeTruthy();
    expect(byLabel('Moderate pattern (3 moves)')).toBeTruthy();
    expect(byLabel('Weak (1 move)')).toBeTruthy();
    expect(byLabel('Ambiguous \u2014 conflicting destinations')).toBeTruthy();
  });

  it('computes conflictAnnotation when contradictingCount > 0', async () => {
    insertProposal(db, {
      sender: 'conflict@e.com',
      destination_folder: 'Archive',
      matching_count: 5,
      contradicting_count: 2,
      destination_counts: JSON.stringify({ Archive: 5, Trash: 2 }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });
    const cards = JSON.parse(res.payload);
    expect(cards[0].conflictAnnotation).toBe('Also moved to: Trash (2)');
  });

  it('computes resurfacedNotice when dismissed proposal became active again', async () => {
    insertProposal(db, {
      sender: 'resurface@e.com',
      status: 'active',
      signals_since_dismiss: 3,
    });

    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });
    const cards = JSON.parse(res.payload);
    expect(cards[0].resurfacedNotice).toBe('Previously dismissed \u2014 3 new moves since then.');
  });
});

describe('POST /api/proposed-rules/:id/approve', () => {
  it('creates a real rule via configRepo.addRule and marks proposal approved', async () => {
    const id = insertProposal(db, { sender: 'approve@e.com', destination_folder: 'Work' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/proposed-rules/${id}/approve`,
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    expect(body.id).toBe('fake-uuid-123');
    expect(mockAddRule).toHaveBeenCalledWith({
      name: 'Auto: approve@e.com',
      match: { sender: 'approve@e.com' },
      action: { type: 'move', folder: 'Work' },
      enabled: true,
      order: 0,
    });

    // Verify proposal was marked approved
    const proposal = proposalStore.getById(id);
    expect(proposal?.status).toBe('approved');
    expect(proposal?.approvedRuleId).toBe('fake-uuid-123');
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proposed-rules/9999/approve',
    });
    expect(res.statusCode).toBe(404);
  });

  it('includes deliveredTo in match when envelopeRecipient is set', async () => {
    const id = insertProposal(db, {
      sender: 'multi@e.com',
      envelope_recipient: 'me+tag@e.com',
      destination_folder: 'Tagged',
    });

    await app.inject({ method: 'POST', url: `/api/proposed-rules/${id}/approve` });

    expect(mockAddRule).toHaveBeenCalledWith(
      expect.objectContaining({
        match: { sender: 'multi@e.com', deliveredTo: 'me+tag@e.com' },
      }),
    );
  });
});

describe('POST /api/proposed-rules/:id/dismiss', () => {
  it('marks proposal as dismissed and returns 204', async () => {
    const id = insertProposal(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/proposed-rules/${id}/dismiss`,
    });
    expect(res.statusCode).toBe(204);

    const proposal = proposalStore.getById(id);
    expect(proposal?.status).toBe('dismissed');
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proposed-rules/9999/dismiss',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/proposed-rules/:id/modify', () => {
  it('returns pre-fill data for the rule editor', async () => {
    const id = insertProposal(db, {
      sender: 'modify@e.com',
      envelope_recipient: 'me@e.com',
      destination_folder: 'Projects',
      source_folder: 'INBOX',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/proposed-rules/${id}/modify`,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      proposalId: id,
      sender: 'modify@e.com',
      envelopeRecipient: 'me@e.com',
      destinationFolder: 'Projects',
      sourceFolder: 'INBOX',
    });
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proposed-rules/9999/modify',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/proposed-rules/:id/mark-approved', () => {
  it('marks proposal approved with given ruleId WITHOUT creating a rule', async () => {
    const id = insertProposal(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/proposed-rules/${id}/mark-approved`,
      payload: { ruleId: 'existing-rule-456' },
    });
    expect(res.statusCode).toBe(204);

    // Verify proposal status updated
    const proposal = proposalStore.getById(id);
    expect(proposal?.status).toBe('approved');
    expect(proposal?.approvedRuleId).toBe('existing-rule-456');

    // Verify configRepo.addRule was NOT called
    expect(mockAddRule).not.toHaveBeenCalled();
  });

  it('returns 400 when ruleId is missing', async () => {
    const id = insertProposal(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/proposed-rules/${id}/mark-approved`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for non-existent proposal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proposed-rules/9999/mark-approved',
      payload: { ruleId: 'some-id' },
    });
    expect(res.statusCode).toBe(404);
  });
});
