import { describe, it, expect, vi } from 'vitest';
import { PatternDetector } from '../../../src/tracking/detector.js';
import type { ProposalStore } from '../../../src/tracking/proposals.js';
import type { MoveSignal } from '../../../src/tracking/signals.js';

function makeSignal(overrides: Partial<MoveSignal> = {}): MoveSignal {
  return {
    id: 1,
    timestamp: '2026-04-13T00:00:00Z',
    messageId: '<test@example.com>',
    sender: 'alice@example.com',
    subject: 'Test Subject',
    readStatus: 'unread',
    sourceFolder: 'INBOX',
    destinationFolder: 'Archive',
    ...overrides,
  };
}

function createMockProposalStore(): { store: ProposalStore; upsertProposal: ReturnType<typeof vi.fn> } {
  const upsertProposal = vi.fn();
  const store = { upsertProposal } as unknown as ProposalStore;
  return { store, upsertProposal };
}

describe('PatternDetector', () => {
  it('calls upsertProposal with correct key and destination', () => {
    const { store, upsertProposal } = createMockProposalStore();
    const detector = new PatternDetector(store);

    const signal = makeSignal({
      sender: 'bob@example.com',
      sourceFolder: 'INBOX',
      destinationFolder: 'Projects',
      envelopeRecipient: 'me@example.com',
      id: 42,
    });

    detector.processSignal(signal);

    expect(upsertProposal).toHaveBeenCalledOnce();
    expect(upsertProposal).toHaveBeenCalledWith(
      {
        sender: 'bob@example.com',
        envelopeRecipient: 'me@example.com',
        sourceFolder: 'INBOX',
      },
      'Projects',
      42,
    );
  });

  it('passes null envelopeRecipient through correctly', () => {
    const { store, upsertProposal } = createMockProposalStore();
    const detector = new PatternDetector(store);

    const signal = makeSignal({ envelopeRecipient: undefined });
    detector.processSignal(signal);

    expect(upsertProposal).toHaveBeenCalledWith(
      expect.objectContaining({ envelopeRecipient: null }),
      'Archive',
      1,
    );
  });

  it('normalizes undefined envelopeRecipient to null', () => {
    const { store, upsertProposal } = createMockProposalStore();
    const detector = new PatternDetector(store);

    // Signal with no envelopeRecipient at all
    const signal = makeSignal();
    delete (signal as Record<string, unknown>).envelopeRecipient;

    detector.processSignal(signal);

    const calledKey = upsertProposal.mock.calls[0][0];
    expect(calledKey.envelopeRecipient).toBeNull();
  });

  it('extracts sender, sourceFolder, and destinationFolder from signal', () => {
    const { store, upsertProposal } = createMockProposalStore();
    const detector = new PatternDetector(store);

    const signal = makeSignal({
      sender: 'newsletter@corp.com',
      sourceFolder: 'Review',
      destinationFolder: 'Newsletters',
      id: 99,
    });

    detector.processSignal(signal);

    expect(upsertProposal).toHaveBeenCalledWith(
      {
        sender: 'newsletter@corp.com',
        envelopeRecipient: null,
        sourceFolder: 'Review',
      },
      'Newsletters',
      99,
    );
  });
});
