/**
 * Integration test for IX-012 — Proposal dismissal and signal-driven
 * resurfacing.
 *
 * Spec: specs/integrations/ix-012-proposal-dismissal-and-resurfacing.md
 *
 * Real Fastify server + real ProposalStore on a temp SQLite ActivityLog db,
 * driven by a real PatternDetector. MoveTracker / DestinationResolver /
 * SignalStore are upstream of this IX, so we synthesize signals by calling
 * PatternDetector.processSignal directly with hand-built MoveSignal objects.
 *
 * Named-interaction coverage:
 *   IX-012.1 — POST /api/proposed-rules/:id/dismiss for non-existent id
 *              returns 404 and does not mutate any row.
 *   IX-012.2 — On hit, dismissProposal sets status='dismissed',
 *              dismissed_at non-null, signals_since_dismiss=0; route 204.
 *   IX-012.3 — getProposals() and GET /api/proposed-rules exclude dismissed
 *              rows from the active card list.
 *   IX-012.4 — A new signal for the same key feeds via PatternDetector and
 *              increments signals_since_dismiss on the dismissed proposal.
 *   IX-012.5 — upsertProposal is a no-op on approved proposals; on dismissed
 *              it proceeds with the resurfacing rule.
 *   IX-012.6 — Per-signal resurfacing: dest counts, dominant, matching/
 *              contradicting counts, and signals_since_dismiss update; at
 *              count >= 5 status flips to 'active', dismissed_at clears, and
 *              signals_since_dismiss is preserved.
 *   IX-012.7 — GET /api/proposed-rules after resurface returns the proposal
 *              with a non-null resurfacedNotice and cumulative matchingCount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { ActivityLog } from '../../src/log/index.js';
import { ProposalStore } from '../../src/tracking/proposals.js';
import { PatternDetector } from '../../src/tracking/detector.js';
import { buildServer } from '../../src/web/server.js';
import type { ServerDeps } from '../../src/web/server.js';
import type { ConfigRepository } from '../../src/config/index.js';
import type { MoveSignal } from '../../src/tracking/signals.js';
import type { ProposedRuleCard } from '../../src/shared/types.js';

const silentLogger = pino({ level: 'silent' });

interface DismissProposalRow {
  id: number;
  status: string;
  dismissed_at: string | null;
  signals_since_dismiss: number;
  destination_folder: string;
  destination_counts: string;
  matching_count: number;
  contradicting_count: number;
}

interface Harness {
  app: FastifyInstance;
  activityLog: ActivityLog;
  proposalStore: ProposalStore;
  patternDetector: PatternDetector;
  tmpDir: string;
  teardown: () => Promise<void>;
}

function buildHarness(): Harness {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-012-'));
  const activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
  const proposalStore = new ProposalStore(activityLog.getDb());
  const patternDetector = new PatternDetector(proposalStore);

  // ConfigRepository is required by ServerDeps but unused on the routes under
  // test (dismiss / GET); a minimal stub keeps the type checker happy.
  const configRepoStub = {
    getRules: () => [],
    addRule: vi.fn(),
    nextOrder: () => 1,
    reorderRules: vi.fn(),
  } as unknown as ConfigRepository;

  const deps: ServerDeps = {
    configRepo: configRepoStub,
    activityLog,
    getMonitor: vi.fn(),
    getSweeper: vi.fn(),
    getFolderCache: vi.fn(),
    getBatchEngine: vi.fn(),
    getMoveTracker: vi.fn(),
    getProposalStore: () => proposalStore,
    staticRoot: tmpDir,
  };

  const app = buildServer(deps);
  return {
    app,
    activityLog,
    proposalStore,
    patternDetector,
    tmpDir,
    teardown: async () => {
      await app.close().catch(() => {});
      activityLog.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function makeSignal(overrides: Partial<MoveSignal> = {}): MoveSignal {
  return {
    id: 1,
    timestamp: '2026-04-01T00:00:00Z',
    messageId: '<m1@example.com>',
    sender: 'sender@example.com',
    envelopeRecipient: 'recipient@example.com',
    subject: 'Hello',
    readStatus: 'read',
    sourceFolder: 'INBOX',
    destinationFolder: 'Archive/Lists',
    ...overrides,
  };
}

function readRow(activityLog: ActivityLog, id: number): DismissProposalRow {
  const row = activityLog.getDb().prepare(
    'SELECT * FROM proposed_rules WHERE id = ?',
  ).get(id) as DismissProposalRow | undefined;
  if (!row) throw new Error(`proposed_rule ${id} not found`);
  return row;
}

describe('IX-012 — Proposal dismissal and signal-driven resurfacing', () => {
  let h: Harness;
  beforeEach(async () => {
    h = buildHarness();
    await h.app.ready();
  });
  afterEach(async () => { await h.teardown(); });

  describe('IX-012.1: dismiss non-existent id', () => {
    it('IX-012.1: POST /api/proposed-rules/:id/dismiss with unknown id returns 404 and does not mutate rows', async () => {
      h.patternDetector.processSignal(makeSignal());
      const before = h.proposalStore.getProposals();
      expect(before).toHaveLength(1);
      const beforeRow = readRow(h.activityLog, before[0].id);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/proposed-rules/99999/dismiss',
      });

      expect(res.statusCode).toBe(404);
      const afterRow = readRow(h.activityLog, before[0].id);
      expect(afterRow).toEqual(beforeRow);
    });
  });

  describe('IX-012.2: dismiss success path', () => {
    it('IX-012.2: dismiss sets status=dismissed, dismissed_at non-null, signals_since_dismiss=0; returns 204', async () => {
      h.patternDetector.processSignal(makeSignal());
      const [proposal] = h.proposalStore.getProposals();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/proposed-rules/${proposal.id}/dismiss`,
      });

      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      const row = readRow(h.activityLog, proposal.id);
      expect(row.status).toBe('dismissed');
      expect(row.dismissed_at).not.toBeNull();
      expect(row.signals_since_dismiss).toBe(0);
    });
  });

  describe('IX-012.3: getProposals excludes dismissed rows', () => {
    it('IX-012.3: dismissed proposal disappears from getProposals() and from GET /api/proposed-rules', async () => {
      h.patternDetector.processSignal(makeSignal({ sender: 'a@example.com' }));
      h.patternDetector.processSignal(makeSignal({ sender: 'b@example.com', messageId: '<m2@example.com>' }));
      const all = h.proposalStore.getProposals();
      expect(all).toHaveLength(2);
      const target = all.find(p => p.sender === 'a@example.com')!;

      h.proposalStore.dismissProposal(target.id);

      expect(h.proposalStore.getProposals().map(p => p.sender)).toEqual(['b@example.com']);

      const res = await h.app.inject({ method: 'GET', url: '/api/proposed-rules' });
      expect(res.statusCode).toBe(200);
      const cards = res.json() as ProposedRuleCard[];
      expect(cards.map(c => c.sender)).toEqual(['b@example.com']);
    });
  });

  describe('IX-012.4: post-dismiss signal increments signals_since_dismiss via PatternDetector', () => {
    it('IX-012.4: a new signal for the same key bumps signals_since_dismiss to 1', async () => {
      h.patternDetector.processSignal(makeSignal());
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.dismissProposal(proposal.id);
      expect(readRow(h.activityLog, proposal.id).signals_since_dismiss).toBe(0);

      h.patternDetector.processSignal(makeSignal({ id: 2, messageId: '<m2@example.com>' }));

      const row = readRow(h.activityLog, proposal.id);
      expect(row.signals_since_dismiss).toBe(1);
      expect(row.status).toBe('dismissed');
    });
  });

  describe('IX-012.5: upsertProposal no-op on approved, proceeds on dismissed', () => {
    it('IX-012.5: approved proposal absorbs no signal updates (counters frozen)', async () => {
      h.patternDetector.processSignal(makeSignal());
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.approveProposal(proposal.id, 'fake-rule-id');
      const beforeRow = readRow(h.activityLog, proposal.id);

      h.patternDetector.processSignal(makeSignal({ id: 2, messageId: '<m2@example.com>' }));

      const afterRow = readRow(h.activityLog, proposal.id);
      expect(afterRow.matching_count).toBe(beforeRow.matching_count);
      expect(afterRow.contradicting_count).toBe(beforeRow.contradicting_count);
      expect(afterRow.destination_counts).toBe(beforeRow.destination_counts);
      expect(afterRow.status).toBe('approved');
    });

    it('IX-012.5: dismissed proposal continues to accept signal updates (resurfacing rule applies)', async () => {
      h.patternDetector.processSignal(makeSignal());
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.dismissProposal(proposal.id);

      h.patternDetector.processSignal(makeSignal({ id: 2, messageId: '<m2@example.com>' }));

      const row = readRow(h.activityLog, proposal.id);
      expect(row.signals_since_dismiss).toBe(1);
      expect(JSON.parse(row.destination_counts)).toEqual({ 'Archive/Lists': 2 });
      expect(row.matching_count).toBe(2);
    });
  });

  describe('IX-012.6: resurfacing rule per signal', () => {
    it('IX-012.6: 5 same-destination signals after dismiss flip status=active, clear dismissed_at, preserve counter', async () => {
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.dismissProposal(proposal.id);

      for (let i = 2; i <= 6; i++) {
        h.patternDetector.processSignal(makeSignal({ id: i, messageId: `<m${i}@example.com>` }));
      }

      const row = readRow(h.activityLog, proposal.id);
      expect(row.status).toBe('active');
      expect(row.dismissed_at).toBeNull();
      // signals_since_dismiss is preserved (not reset) so the UI can show the count.
      expect(row.signals_since_dismiss).toBe(5);
      expect(JSON.parse(row.destination_counts)).toEqual({ 'Archive/Lists': 6 });
      expect(row.destination_folder).toBe('Archive/Lists');
      expect(row.matching_count).toBe(6);
      expect(row.contradicting_count).toBe(0);
    });

    it('IX-012.6: a competing destination during resurfacing recomputes dominant and contradicting counts', async () => {
      // Pre-dismiss: 1 signal to Archive/Lists (incumbent dominant).
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.dismissProposal(proposal.id);

      // Post-dismiss: 3 to a competing dest, then 1 back to original. 3 > 1+1
      // so the dominant flips. signals_since_dismiss=4, still under threshold.
      for (let i = 2; i <= 4; i++) {
        h.patternDetector.processSignal(makeSignal({
          id: i, messageId: `<m${i}@example.com>`, destinationFolder: 'Archive/Other',
        }));
      }
      h.patternDetector.processSignal(makeSignal({ id: 5, messageId: '<m5@example.com>' }));

      const row = readRow(h.activityLog, proposal.id);
      expect(JSON.parse(row.destination_counts)).toEqual({
        'Archive/Lists': 2,
        'Archive/Other': 3,
      });
      expect(row.destination_folder).toBe('Archive/Other');
      expect(row.matching_count).toBe(3);
      expect(row.contradicting_count).toBe(2);
      expect(row.signals_since_dismiss).toBe(4);
      expect(row.status).toBe('dismissed');
    });
  });

  describe('IX-012.7: GET /api/proposed-rules after resurface', () => {
    it('IX-012.7: resurfaced proposal appears with non-null resurfacedNotice and cumulative matchingCount', async () => {
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.dismissProposal(proposal.id);
      for (let i = 2; i <= 6; i++) {
        h.patternDetector.processSignal(makeSignal({ id: i, messageId: `<m${i}@example.com>` }));
      }

      const res = await h.app.inject({ method: 'GET', url: '/api/proposed-rules' });
      expect(res.statusCode).toBe(200);
      const cards = res.json() as ProposedRuleCard[];
      const card = cards.find(c => c.id === proposal.id);
      expect(card).toBeDefined();
      expect(card!.status).toBe('active');
      expect(card!.resurfacedNotice).not.toBeNull();
      expect(card!.resurfacedNotice).toContain('Previously dismissed');
      expect(card!.resurfacedNotice).toContain('5 new moves');
      // 1 pre-dismissal + 5 post-dismissal signals were all to Archive/Lists.
      expect(card!.matchingCount).toBe(6);
      expect(card!.signalsSinceDismiss).toBe(5);
    });
  });

  describe('Failure handling: dismiss of already-approved proposal', () => {
    it('IX-012 failure handling: dismissProposal overwrites status and dismissed_at on an approved proposal (latent issue per spec)', async () => {
      h.patternDetector.processSignal(makeSignal());
      const [proposal] = h.proposalStore.getProposals();
      h.proposalStore.approveProposal(proposal.id, 'fake-rule-id');
      expect(readRow(h.activityLog, proposal.id).status).toBe('approved');

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/proposed-rules/${proposal.id}/dismiss`,
      });

      // Current behavior: 204 and the row is now dismissed. Spec flags this as
      // a latent issue (orphans approved_rule_id). When a future guard lands
      // this assertion should be inverted to expect a 4xx and an unchanged row.
      expect(res.statusCode).toBe(204);
      const row = readRow(h.activityLog, proposal.id);
      expect(row.status).toBe('dismissed');
      expect(row.dismissed_at).not.toBeNull();
    });
  });
});
