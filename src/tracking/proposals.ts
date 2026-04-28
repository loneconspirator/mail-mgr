/**
 * MOD-0012 ProposalStore — interface schema.
 * See specs/modules/mod-0012-proposal-store.md.
 */
import type Database from 'better-sqlite3';
import type { ProposedRule, ProposalKey, ExampleMessage } from '../shared/types.js';

/**
 * Manages CRUD operations for the proposed_rules table.
 * Proposals represent detected patterns from user move behavior.
 */
export class ProposalStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create or update a proposal for the given key+destination.
   * Skips approved proposals. Handles dismissed resurface logic.
   */
  upsertProposal(key: ProposalKey, destination: string, _signalId: number): void {
    const normalizedRecipient = key.envelopeRecipient === '' ? null : (key.envelopeRecipient ?? null);

    const txn = this.db.transaction(() => {
      // Find existing proposal by key
      const existing = this.db.prepare(`
        SELECT * FROM proposed_rules
        WHERE sender = ?
          AND (envelope_recipient IS ? OR (envelope_recipient IS NULL AND ? IS NULL))
          AND source_folder = ?
      `).get(
        key.sender,
        normalizedRecipient,
        normalizedRecipient,
        key.sourceFolder,
      ) as Record<string, unknown> | undefined;

      if (existing) {
        // Skip approved proposals
        if (existing.status === 'approved') {
          return;
        }

        // Parse destination_counts
        let destCounts: Record<string, number>;
        try {
          destCounts = JSON.parse(existing.destination_counts as string);
        } catch {
          destCounts = {};
        }

        // Increment count for this destination
        destCounts[destination] = (destCounts[destination] ?? 0) + 1;

        // Determine dominant destination (highest count).
        // Seed with incumbent to preserve it on ties (avoid non-deterministic flipping).
        let dominantDest = existing.destination_folder as string;
        let maxCount = 0;
        for (const [dest, count] of Object.entries(destCounts)) {
          if (count > maxCount) {
            maxCount = count;
            dominantDest = dest;
          }
        }

        // Compute matching_count (max destination count) and contradicting_count (sum of others)
        const matchingCount = maxCount;
        let contradictingCount = 0;
        for (const [dest, count] of Object.entries(destCounts)) {
          if (dest !== dominantDest) {
            contradictingCount += count;
          }
        }

        // Handle dismissed resurface
        let newStatus = existing.status as string;
        let signalsSinceDismiss = existing.signals_since_dismiss as number;
        let dismissedAt = existing.dismissed_at;

        if (newStatus === 'dismissed') {
          signalsSinceDismiss += 1;
          if (signalsSinceDismiss >= 5) {
            newStatus = 'active';
            // Keep signalsSinceDismiss so resurfacedNotice can display the count
            dismissedAt = null;
          }
        }

        this.db.prepare(`
          UPDATE proposed_rules SET
            destination_folder = ?,
            matching_count = ?,
            contradicting_count = ?,
            destination_counts = ?,
            status = ?,
            dismissed_at = ?,
            signals_since_dismiss = ?,
            updated_at = datetime('now'),
            last_signal_at = datetime('now')
          WHERE id = ?
        `).run(
          dominantDest,
          matchingCount,
          contradictingCount,
          JSON.stringify(destCounts),
          newStatus,
          dismissedAt,
          signalsSinceDismiss,
          existing.id,
        );
      } else {
        // Insert new proposal
        const destCounts: Record<string, number> = { [destination]: 1 };
        this.db.prepare(`
          INSERT INTO proposed_rules (
            sender, envelope_recipient, source_folder, destination_folder,
            matching_count, contradicting_count, destination_counts
          ) VALUES (?, ?, ?, ?, 1, 0, ?)
        `).run(
          key.sender,
          normalizedRecipient,
          key.sourceFolder,
          destination,
          JSON.stringify(destCounts),
        );
      }
    });

    txn();
  }

  /**
   * Get all non-approved proposals sorted by strength DESC, then last_signal_at DESC.
   */
  getProposals(): ProposedRule[] {
    const rows = this.db.prepare(`
      SELECT *, (matching_count - contradicting_count) AS strength
      FROM proposed_rules
      WHERE status = 'active'
      ORDER BY strength DESC, last_signal_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToProposal);
  }

  /**
   * Get a single proposal by id, or null if not found.
   */
  getById(id: number): ProposedRule | null {
    const row = this.db.prepare(`
      SELECT *, (matching_count - contradicting_count) AS strength
      FROM proposed_rules WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? rowToProposal(row) : null;
  }

  /**
   * Get example subjects from move_signals matching the proposal key.
   */
  getExampleSubjects(
    sender: string,
    envelopeRecipient: string | null,
    sourceFolder: string,
    limit: number = 3,
  ): ExampleMessage[] {
    const rows = this.db.prepare(`
      SELECT subject, timestamp AS date, destination_folder
      FROM move_signals
      WHERE sender = ?
        AND (envelope_recipient IS ? OR (envelope_recipient IS NULL AND ? IS NULL))
        AND source_folder = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(
      sender,
      envelopeRecipient,
      envelopeRecipient,
      sourceFolder,
      limit,
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      subject: row.subject as string,
      date: row.date as string,
      destinationFolder: row.destination_folder as string,
    }));
  }

  /**
   * Mark a proposal as approved and store the rule id it was converted to.
   */
  approveProposal(id: number, ruleId: string): void {
    this.db.prepare(`
      UPDATE proposed_rules
      SET status = 'approved', approved_rule_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(ruleId, id);
  }

  /**
   * Mark a proposal as dismissed, resetting signals_since_dismiss counter.
   */
  dismissProposal(id: number): void {
    this.db.prepare(`
      UPDATE proposed_rules
      SET status = 'dismissed', dismissed_at = datetime('now'), signals_since_dismiss = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }
}

/** Map a SQLite row (snake_case) to a ProposedRule (camelCase). */
function rowToProposal(row: Record<string, unknown>): ProposedRule {
  let destCounts: Record<string, number>;
  try {
    destCounts = JSON.parse(row.destination_counts as string);
  } catch {
    destCounts = {};
  }

  return {
    id: row.id as number,
    sender: row.sender as string,
    envelopeRecipient: (row.envelope_recipient as string) ?? null,
    sourceFolder: row.source_folder as string,
    destinationFolder: row.destination_folder as string,
    matchingCount: row.matching_count as number,
    contradictingCount: row.contradicting_count as number,
    destinationCounts: destCounts,
    status: row.status as 'active' | 'approved' | 'dismissed',
    dismissedAt: (row.dismissed_at as string) ?? null,
    signalsSinceDismiss: row.signals_since_dismiss as number,
    approvedRuleId: (row.approved_rule_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastSignalAt: row.last_signal_at as string,
    strength: row.strength as number,
  };
}
