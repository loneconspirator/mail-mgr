import type { ProposalStore } from './proposals.js';
import type { MoveSignal } from './signals.js';
import type { ProposalKey } from '../shared/types.js';

/**
 * Processes move signals into proposal upserts for pattern detection.
 * Runs in real-time after each signal is logged by MoveTracker.
 *
 * Spec: MOD-0010 (specs/modules/mod-0010-pattern-detector.md)
 */
export class PatternDetector {
  constructor(private proposalStore: ProposalStore) {}

  processSignal(signal: MoveSignal): void {
    const key: ProposalKey = {
      sender: signal.sender,
      envelopeRecipient: signal.envelopeRecipient ?? null,
      sourceFolder: signal.sourceFolder,
    };
    this.proposalStore.upsertProposal(key, signal.destinationFolder, signal.id);
  }
}
