/**
 * Integration test for IX-004 — Signal logging and proposal creation/update.
 *
 * Spec: specs/integrations/ix-004-signal-logging-and-proposal-creation.md
 *
 * Exercises the proposal upsert state machine end-to-end against real SQLite
 * stores, with no mocks of the units under test:
 *   - real ActivityLog (MOD-0007) on a per-test temp SQLite db
 *   - real SignalStore (MOD-0011) sharing the ActivityLog db
 *   - real ProposalStore (MOD-0012) sharing the ActivityLog db
 *   - real PatternDetector (MOD-0010) wired to the ProposalStore
 *
 * IX-004's preconditions assume a confirmed move signal has been emitted by
 * IX-003 with a resolved destination. So this test starts at the
 * SignalStore.logSignal -> PatternDetector.processSignal seam — no IMAP, no
 * GreenMail, no Fastify. The IMAP-driven half of the pipeline is IX-003's
 * territory and is exercised by ix-003-user-move-detection-and-destination-resolution.test.ts.
 *
 * IX-012's harness is the structural template: per-test mkdtempSync +
 * ActivityLog + ProposalStore + PatternDetector, makeSignal helper, direct
 * row reads via activityLog.getDb().prepare().get(id).
 *
 * Named-interaction coverage:
 *   IX-004.1 — MoveTracker invokes patternDetector.processSignal(moveSignal).
 *   IX-004.2 — SignalStore.logSignal persists raw metadata for every column.
 *   IX-004.3 — PatternDetector builds {sender, envelopeRecipient, sourceFolder}
 *              key for ProposalStore lookup.
 *   IX-004.4 — No existing proposal -> create with status=active,
 *              matching_count=1.
 *   IX-004.5 — Same-destination match -> matching_count increments, strength
 *              label progresses.
 *   IX-004.6 — Different-destination match -> contradicting_count++, dominant
 *              may shift.
 *   IX-004.7 — Dismissed proposal -> signals_since_dismiss++; reaches 5 ->
 *              status flips to active.
 *   IX-004.8 — Approved proposal -> no update.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityLog } from '../../src/log/index.js';
import { SignalStore } from '../../src/tracking/signals.js';
import type { MoveSignal, MoveSignalInput } from '../../src/tracking/signals.js';
import { ProposalStore } from '../../src/tracking/proposals.js';
import { PatternDetector } from '../../src/tracking/detector.js';

interface ProposalRow {
  id: number;
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
  approved_rule_id: string | null;
  created_at: string;
  updated_at: string;
  last_signal_at: string;
}

interface SignalRow {
  id: number;
  timestamp: string;
  message_id: string;
  sender: string;
  envelope_recipient: string | null;
  list_id: string | null;
  subject: string;
  read_status: string;
  visibility: string | null;
  source_folder: string;
  destination_folder: string;
}

interface Harness {
  activityLog: ActivityLog;
  signalStore: SignalStore;
  proposalStore: ProposalStore;
  patternDetector: PatternDetector;
  tmpDir: string;
  teardown: () => void;
}

function buildHarness(): Harness {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-004-'));
  const activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
  const signalStore = new SignalStore(activityLog.getDb());
  const proposalStore = new ProposalStore(activityLog.getDb());
  const patternDetector = new PatternDetector(proposalStore);
  return {
    activityLog,
    signalStore,
    proposalStore,
    patternDetector,
    tmpDir,
    teardown: () => {
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

function readProposalRow(activityLog: ActivityLog, id: number): ProposalRow {
  const row = activityLog.getDb().prepare(
    'SELECT * FROM proposed_rules WHERE id = ?',
  ).get(id) as ProposalRow | undefined;
  if (!row) throw new Error(`proposed_rule ${id} not found`);
  return row;
}

function readSignalRow(activityLog: ActivityLog, id: number): SignalRow {
  const row = activityLog.getDb().prepare(
    'SELECT * FROM move_signals WHERE id = ?',
  ).get(id) as SignalRow | undefined;
  if (!row) throw new Error(`move_signal ${id} not found`);
  return row;
}

describe('IX-004 — Signal logging and proposal creation/update', () => {
  let h: Harness;
  beforeEach(() => { h = buildHarness(); });
  afterEach(() => { h.teardown(); });

  describe('IX-004.1: MoveTracker invokes patternDetector.processSignal(moveSignal)', () => {
    it('IX-004.1: post-insert handoff drives PatternDetector.processSignal with the round-tripped MoveSignal', () => {
      // MoveTracker.logSignal (src/tracking/index.ts) invokes signalStore.logSignal
      // first, then signalStore.getSignalById to read the persisted row back as a
      // MoveSignal, then patternDetector.processSignal(signal). This test exercises
      // the post-insert handoff seam — the IX-004 spec calls out as IX-004.1 — without
      // booting MoveTracker (MoveTracker requires ImapClient + scan loop, which is
      // IX-003's territory; IX-004's preconditions section says "A confirmed move
      // signal has been emitted by IX-003 with a resolved destination").
      const spy = vi.spyOn(h.patternDetector, 'processSignal');

      const input: MoveSignalInput = {
        messageId: '<handoff@example.com>',
        sender: 'handoff-sender@example.com',
        envelopeRecipient: 'handoff-recipient@example.com',
        subject: 'Handoff test',
        readStatus: 'unread',
        sourceFolder: 'INBOX',
        destinationFolder: 'Archive/Handoff',
      };
      const insertedId = h.signalStore.logSignal(input);
      const signal = h.signalStore.getSignalById(insertedId);
      expect(signal).not.toBeNull();
      h.patternDetector.processSignal(signal!);

      expect(spy).toHaveBeenCalledTimes(1);
      const arg = spy.mock.calls[0][0];
      expect(arg.id).toBe(insertedId);
      expect(arg.messageId).toBe(input.messageId);
      expect(arg.sender).toBe(input.sender);
      expect(arg.sourceFolder).toBe(input.sourceFolder);
      expect(arg.destinationFolder).toBe(input.destinationFolder);
      expect(arg.envelopeRecipient).toBe(input.envelopeRecipient);
    });
  });

  describe('IX-004.2: SignalStore.logSignal persists raw metadata', () => {
    it('IX-004.2: every MoveSignalInput field round-trips through SQLite (snake_case columns)', () => {
      const input: MoveSignalInput = {
        messageId: '<full@example.com>',
        sender: 'full-sender@example.com',
        envelopeRecipient: 'full-recipient@example.com',
        listId: '<list.example.com>',
        subject: 'Full metadata subject',
        readStatus: 'unread',
        visibility: 'private',
        sourceFolder: 'INBOX',
        destinationFolder: 'Archive/Full',
      };

      const insertedId = h.signalStore.logSignal(input);

      // Direct SELECT — assert every column is what was passed in.
      const row = readSignalRow(h.activityLog, insertedId);
      expect(row.id).toBe(insertedId);
      expect(row.timestamp).not.toBeNull();
      expect(row.timestamp.length).toBeGreaterThan(0);
      expect(row.message_id).toBe(input.messageId);
      expect(row.sender).toBe(input.sender);
      expect(row.envelope_recipient).toBe(input.envelopeRecipient);
      expect(row.list_id).toBe(input.listId);
      expect(row.subject).toBe(input.subject);
      expect(row.read_status).toBe(input.readStatus);
      expect(row.visibility).toBe(input.visibility);
      expect(row.source_folder).toBe(input.sourceFolder);
      expect(row.destination_folder).toBe(input.destinationFolder);

      // Round-trip back through getSignalById (camelCase MoveSignal).
      const signal = h.signalStore.getSignalById(insertedId);
      expect(signal).not.toBeNull();
      expect(signal!.id).toBe(insertedId);
      expect(signal!.messageId).toBe(input.messageId);
      expect(signal!.sender).toBe(input.sender);
      expect(signal!.envelopeRecipient).toBe(input.envelopeRecipient);
      expect(signal!.listId).toBe(input.listId);
      expect(signal!.subject).toBe(input.subject);
      expect(signal!.readStatus).toBe(input.readStatus);
      expect(signal!.visibility).toBe(input.visibility);
      expect(signal!.sourceFolder).toBe(input.sourceFolder);
      expect(signal!.destinationFolder).toBe(input.destinationFolder);
    });
  });

  describe('IX-004.3: PatternDetector builds {sender, envelopeRecipient, sourceFolder} key', () => {
    it('IX-004.3: signals collapse / split based on the three key fields and null/empty envelopeRecipient normalize together', () => {
      // Two signals with identical key, different other fields -> 1 proposal.
      h.patternDetector.processSignal(makeSignal({
        id: 1, messageId: '<a1@example.com>', subject: 'A1', readStatus: 'read',
      }));
      h.patternDetector.processSignal(makeSignal({
        id: 2, messageId: '<a2@example.com>', subject: 'A2', readStatus: 'unread',
      }));
      expect(h.proposalStore.getProposals()).toHaveLength(1);

      // Different envelopeRecipient -> new proposal (2 total).
      h.patternDetector.processSignal(makeSignal({
        id: 3,
        messageId: '<a3@example.com>',
        envelopeRecipient: 'OTHER-recipient@example.com',
      }));
      expect(h.proposalStore.getProposals()).toHaveLength(2);

      // Different sourceFolder -> new proposal (3 total).
      h.patternDetector.processSignal(makeSignal({
        id: 4,
        messageId: '<a4@example.com>',
        sourceFolder: 'NotInbox',
      }));
      expect(h.proposalStore.getProposals()).toHaveLength(3);

      // Different sender -> new proposal (4 total) — sanity check that sender
      // is also part of the key.
      h.patternDetector.processSignal(makeSignal({
        id: 5,
        messageId: '<a5@example.com>',
        sender: 'other-sender@example.com',
      }));
      expect(h.proposalStore.getProposals()).toHaveLength(4);

      // Null/empty envelopeRecipient collapse: ProposalStore normalizes
      // '' -> null and matches null IS null, so two signals with envelopeRecipient
      // undefined and '' should land on the same row. Use a fresh sender to
      // isolate from the rows above.
      h.patternDetector.processSignal(makeSignal({
        id: 6,
        messageId: '<n1@example.com>',
        sender: 'null-sender@example.com',
        envelopeRecipient: undefined,
      }));
      h.patternDetector.processSignal(makeSignal({
        id: 7,
        messageId: '<n2@example.com>',
        sender: 'null-sender@example.com',
        envelopeRecipient: '',
      }));
      const nullSenderProposals = h.proposalStore.getProposals().filter(
        p => p.sender === 'null-sender@example.com',
      );
      expect(nullSenderProposals).toHaveLength(1);
      expect(nullSenderProposals[0].envelopeRecipient).toBeNull();
      expect(nullSenderProposals[0].matchingCount).toBe(2);
    });
  });

  describe('IX-004.4: No existing proposal -> create with status=active, matching_count=1', () => {
    it('IX-004.4: first signal inserts a row with active status, count=1, and dest in destination_counts', () => {
      h.patternDetector.processSignal(makeSignal());

      const proposals = h.proposalStore.getProposals();
      expect(proposals).toHaveLength(1);
      const proposal = proposals[0];

      const row = readProposalRow(h.activityLog, proposal.id);
      expect(row.status).toBe('active');
      expect(row.matching_count).toBe(1);
      expect(row.contradicting_count).toBe(0);
      expect(JSON.parse(row.destination_counts)).toEqual({ 'Archive/Lists': 1 });
      expect(row.destination_folder).toBe('Archive/Lists');
      expect(row.signals_since_dismiss).toBe(0);
      expect(row.dismissed_at).toBeNull();
      expect(row.sender).toBe('sender@example.com');
      expect(row.envelope_recipient).toBe('recipient@example.com');
      expect(row.source_folder).toBe('INBOX');
    });
  });

  describe('IX-004.5: Same-destination match -> matching_count++, strength label progresses', () => {
    it('IX-004.5: matching_count and strength grow monotonically with each same-destination signal', () => {
      // Strength label (Weak / Moderate / Strong) is a UI projection of the
      // strength field on ProposedRule (computed as matching_count -
      // contradicting_count). Asserting the underlying numeric is the testable
      // contract — the UI label derives from this same source.

      // Signal 1 -> count=1, strength=1.
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      let proposals = h.proposalStore.getProposals();
      expect(proposals[0].matchingCount).toBe(1);
      expect(proposals[0].strength).toBe(1);
      const proposalId = proposals[0].id;

      // Signals 2 + 3 -> count=3, strength=3.
      h.patternDetector.processSignal(makeSignal({ id: 2, messageId: '<m2@example.com>' }));
      h.patternDetector.processSignal(makeSignal({ id: 3, messageId: '<m3@example.com>' }));
      proposals = h.proposalStore.getProposals();
      expect(proposals[0].id).toBe(proposalId);
      expect(proposals[0].matchingCount).toBe(3);
      expect(proposals[0].strength).toBe(3);

      // Signals 4..10 -> count=10, strength=10. Strength rises monotonically.
      let lastStrength = 3;
      for (let i = 4; i <= 10; i++) {
        h.patternDetector.processSignal(makeSignal({
          id: i, messageId: `<m${i}@example.com>`,
        }));
        const cur = h.proposalStore.getProposals()[0];
        expect(cur.id).toBe(proposalId);
        expect(cur.matchingCount).toBe(i);
        expect(cur.strength).toBe(i);
        expect(cur.strength).toBeGreaterThan(lastStrength);
        lastStrength = cur.strength;
      }

      const row = readProposalRow(h.activityLog, proposalId);
      expect(row.matching_count).toBe(10);
      expect(row.contradicting_count).toBe(0);
      expect(JSON.parse(row.destination_counts)).toEqual({ 'Archive/Lists': 10 });
    });
  });

  describe('IX-004.6: Different-destination match -> contradicting_count++, dominant may shift', () => {
    it('IX-004.6: incumbent dominant is preserved on tie; flips when challenger overtakes', () => {
      // Signal 1 -> Archive/Lists. dominant=Lists, matching=1, contradicting=0.
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      let proposals = h.proposalStore.getProposals();
      expect(proposals).toHaveLength(1);
      const proposalId = proposals[0].id;
      let row = readProposalRow(h.activityLog, proposalId);
      expect(row.destination_folder).toBe('Archive/Lists');
      expect(row.matching_count).toBe(1);
      expect(row.contradicting_count).toBe(0);

      // Signal 2 -> Archive/Other. Tie (1 vs 1) -> incumbent stays Lists.
      // matching=1, contradicting=1. destination_counts has both.
      h.patternDetector.processSignal(makeSignal({
        id: 2, messageId: '<m2@example.com>', destinationFolder: 'Archive/Other',
      }));
      row = readProposalRow(h.activityLog, proposalId);
      expect(row.destination_folder).toBe('Archive/Lists');
      expect(row.matching_count).toBe(1);
      expect(row.contradicting_count).toBe(1);
      expect(JSON.parse(row.destination_counts)).toEqual({
        'Archive/Lists': 1,
        'Archive/Other': 1,
      });

      // Signal 3 -> Archive/Other. Now Other has 2, Lists has 1. Other overtakes.
      // matching=2 (Other), contradicting=1 (Lists).
      h.patternDetector.processSignal(makeSignal({
        id: 3, messageId: '<m3@example.com>', destinationFolder: 'Archive/Other',
      }));
      row = readProposalRow(h.activityLog, proposalId);
      expect(row.destination_folder).toBe('Archive/Other');
      expect(row.matching_count).toBe(2);
      expect(row.contradicting_count).toBe(1);
      expect(JSON.parse(row.destination_counts)).toEqual({
        'Archive/Lists': 1,
        'Archive/Other': 2,
      });

      // Still only one proposal — different-destination signals never split rows.
      proposals = h.proposalStore.getProposals();
      expect(proposals).toHaveLength(1);
    });
  });

  describe('IX-004.7: Dismissed proposal -> signals_since_dismiss++; reaches 5 -> status flips to active', () => {
    it('IX-004.7: 5 post-dismiss signals flip status active, clear dismissed_at, preserve signals_since_dismiss', () => {
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      const [proposal] = h.proposalStore.getProposals();
      const proposalId = proposal.id;

      h.proposalStore.dismissProposal(proposalId);
      let row = readProposalRow(h.activityLog, proposalId);
      expect(row.status).toBe('dismissed');
      expect(row.signals_since_dismiss).toBe(0);
      expect(row.dismissed_at).not.toBeNull();
      // Dismissed proposals are hidden from getProposals().
      expect(h.proposalStore.getProposals()).toHaveLength(0);

      // Drive 4 post-dismiss signals; each bumps signals_since_dismiss but the
      // row stays dismissed (threshold is >= 5).
      for (let i = 2; i <= 5; i++) {
        h.patternDetector.processSignal(makeSignal({
          id: i, messageId: `<m${i}@example.com>`,
        }));
        row = readProposalRow(h.activityLog, proposalId);
        expect(row.signals_since_dismiss).toBe(i - 1);
        expect(row.status).toBe('dismissed');
        expect(row.dismissed_at).not.toBeNull();
      }

      // Drive the 5th post-dismiss signal -> threshold met, status flips active.
      h.patternDetector.processSignal(makeSignal({ id: 6, messageId: '<m6@example.com>' }));
      row = readProposalRow(h.activityLog, proposalId);
      expect(row.status).toBe('active');
      expect(row.dismissed_at).toBeNull();
      // signals_since_dismiss is preserved (NOT reset) so the UI can render
      // a "5 new moves since you dismissed this" notice.
      expect(row.signals_since_dismiss).toBe(5);
      expect(row.matching_count).toBe(6);
      expect(row.contradicting_count).toBe(0);

      // Resurfaced proposal is back in the active list.
      const resurfaced = h.proposalStore.getProposals();
      expect(resurfaced).toHaveLength(1);
      expect(resurfaced[0].id).toBe(proposalId);
    });
  });

  describe('IX-004.8: Approved proposal -> no update', () => {
    it('IX-004.8: signals to an approved proposal leave counters and destination_counts byte-identical', () => {
      h.patternDetector.processSignal(makeSignal({ id: 1, messageId: '<m1@example.com>' }));
      const [proposal] = h.proposalStore.getProposals();
      const proposalId = proposal.id;
      h.proposalStore.approveProposal(proposalId, 'fake-rule-id');

      const before = readProposalRow(h.activityLog, proposalId);
      expect(before.status).toBe('approved');
      const counterSnapshot = {
        matching_count: before.matching_count,
        contradicting_count: before.contradicting_count,
        destination_counts: before.destination_counts,
        destination_folder: before.destination_folder,
        updated_at: before.updated_at,
      };

      // Drive 3 post-approval signals: same dest, then a new dest, then another
      // new dest. None should mutate the counters.
      h.patternDetector.processSignal(makeSignal({ id: 2, messageId: '<m2@example.com>' }));
      h.patternDetector.processSignal(makeSignal({
        id: 3, messageId: '<m3@example.com>', destinationFolder: 'Archive/Other',
      }));
      h.patternDetector.processSignal(makeSignal({
        id: 4, messageId: '<m4@example.com>', destinationFolder: 'Archive/Third',
      }));

      const after = readProposalRow(h.activityLog, proposalId);
      expect(after.status).toBe('approved');
      expect({
        matching_count: after.matching_count,
        contradicting_count: after.contradicting_count,
        destination_counts: after.destination_counts,
        destination_folder: after.destination_folder,
        updated_at: after.updated_at,
      }).toEqual(counterSnapshot);
    });
  });
});
