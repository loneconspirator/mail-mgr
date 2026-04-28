/**
 * MOD-0011 SignalStore — see specs/modules/mod-0011-signal-store.md
 *
 * SQLite persistence for raw user-move signals. Source of truth for the
 * SignalStore module's public interface.
 */
import type Database from 'better-sqlite3';

export interface MoveSignalInput {
  messageId: string;
  sender: string;
  envelopeRecipient?: string;
  listId?: string;
  subject: string;
  readStatus: 'read' | 'unread';
  visibility?: string;
  sourceFolder: string;
  destinationFolder: string;
}

export interface MoveSignal extends MoveSignalInput {
  id: number;
  timestamp: string;
}

/**
 * Manages CRUD operations and pruning for the move_signals table.
 * Stores signals captured when a user manually moves messages.
 */
export class SignalStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Insert a move signal and return the new row id.
   */
  logSignal(input: MoveSignalInput): number {
    const stmt = this.db.prepare(`
      INSERT INTO move_signals (
        message_id, sender, envelope_recipient, list_id, subject,
        read_status, visibility, source_folder, destination_folder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.messageId,
      input.sender,
      input.envelopeRecipient ?? null,
      input.listId ?? null,
      input.subject,
      input.readStatus,
      input.visibility ?? null,
      input.sourceFolder,
      input.destinationFolder,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Retrieve recent signals in reverse chronological order.
   */
  getSignals(limit: number = 50): MoveSignal[] {
    const rows = this.db.prepare(
      'SELECT * FROM move_signals ORDER BY id DESC LIMIT ?',
    ).all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToSignal);
  }

  /**
   * Find a signal by its row id. Returns null if not found.
   */
  getSignalById(id: number): MoveSignal | null {
    const row = this.db.prepare(
      'SELECT * FROM move_signals WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row) : null;
  }

  /**
   * Find a signal by message_id. Returns null if not found.
   */
  getSignalByMessageId(messageId: string): MoveSignal | null {
    const row = this.db.prepare(
      'SELECT * FROM move_signals WHERE message_id = ? LIMIT 1',
    ).get(messageId) as Record<string, unknown> | undefined;
    return row ? rowToSignal(row) : null;
  }

  /**
   * Delete signals older than the specified number of days.
   * Returns the number of deleted rows.
   */
  prune(days: number = 90): number {
    const stmt = this.db.prepare(
      `DELETE FROM move_signals WHERE timestamp < datetime('now', ?)`,
    );
    const result = stmt.run(`-${days} days`);
    return result.changes;
  }
}

/** Map a SQLite row (snake_case) to a MoveSignal (camelCase). */
function rowToSignal(row: Record<string, unknown>): MoveSignal {
  return {
    id: row.id as number,
    timestamp: row.timestamp as string,
    messageId: row.message_id as string,
    sender: row.sender as string,
    envelopeRecipient: (row.envelope_recipient as string) ?? undefined,
    listId: (row.list_id as string) ?? undefined,
    subject: row.subject as string,
    readStatus: row.read_status as 'read' | 'unread',
    visibility: (row.visibility as string) ?? undefined,
    sourceFolder: row.source_folder as string,
    destinationFolder: row.destination_folder as string,
  };
}
