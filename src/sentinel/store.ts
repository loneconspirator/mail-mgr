import type Database from 'better-sqlite3';

export interface SentinelRow {
  message_id: string;
  folder_path: string;
  folder_purpose: string;
  created_at: string;
}

export interface Sentinel {
  messageId: string;
  folderPath: string;
  folderPurpose: string;
  createdAt: string;
}

export class SentinelStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsert(messageId: string, folderPath: string, folderPurpose: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO sentinels (message_id, folder_path, folder_purpose) VALUES (?, ?, ?)`
    ).run(messageId, folderPath, folderPurpose);
  }

  getByFolder(folderPath: string): Sentinel | null {
    const row = this.db.prepare(
      'SELECT * FROM sentinels WHERE folder_path = ?'
    ).get(folderPath) as SentinelRow | undefined;
    return row ? rowToSentinel(row) : null;
  }

  getByMessageId(messageId: string): Sentinel | null {
    const row = this.db.prepare(
      'SELECT * FROM sentinels WHERE message_id = ?'
    ).get(messageId) as SentinelRow | undefined;
    return row ? rowToSentinel(row) : null;
  }

  getAll(): Sentinel[] {
    const rows = this.db.prepare('SELECT * FROM sentinels').all() as SentinelRow[];
    return rows.map(rowToSentinel);
  }

  deleteByMessageId(messageId: string): boolean {
    const result = this.db.prepare('DELETE FROM sentinels WHERE message_id = ?').run(messageId);
    return result.changes > 0;
  }

  deleteByFolder(folderPath: string): boolean {
    const result = this.db.prepare('DELETE FROM sentinels WHERE folder_path = ?').run(folderPath);
    return result.changes > 0;
  }

  updateFolderPath(messageId: string, newFolderPath: string): boolean {
    const result = this.db.prepare(
      'UPDATE sentinels SET folder_path = ? WHERE message_id = ?'
    ).run(newFolderPath, messageId);
    return result.changes > 0;
  }
}

function rowToSentinel(row: SentinelRow): Sentinel {
  return {
    messageId: row.message_id,
    folderPath: row.folder_path,
    folderPurpose: row.folder_purpose,
    createdAt: row.created_at,
  };
}
