import path from 'node:path';
import Database from 'better-sqlite3';
import type { ActionResult } from '../actions/index.js';
import type { EmailMessage } from '../imap/index.js';
import type { Rule } from '../config/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  message_uid INTEGER NOT NULL,
  message_id TEXT,
  message_from TEXT,
  message_to TEXT,
  message_subject TEXT,
  rule_id TEXT,
  rule_name TEXT,
  action TEXT NOT NULL,
  folder TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const PRUNE_DAYS = 30;

export interface ActivityEntry {
  id: number;
  timestamp: string;
  message_uid: number;
  message_id: string | null;
  message_from: string | null;
  message_to: string | null;
  message_subject: string | null;
  rule_id: string | null;
  rule_name: string | null;
  action: string;
  folder: string | null;
  source: string;
  success: number;
  error: string | null;
}

export class ActivityLog {
  private db: Database.Database;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Run idempotent migrations for schema changes added after initial release.
   */
  private migrate(): void {
    try {
      this.db.exec(`ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'`);
    } catch {
      // Column already exists — nothing to do.
    }
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_source ON activity(source)`);
    } catch {
      // Index already exists
    }
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_folder_success ON activity(folder, success)`);
    } catch {
      // Index already exists
    }
  }

  /**
   * Create an ActivityLog using the standard DATA_PATH convention.
   */
  static fromDataPath(dataPath?: string): ActivityLog {
    const base = dataPath ?? process.env.DATA_PATH ?? './data';
    return new ActivityLog(path.join(base, 'db.sqlite3'));
  }

  /**
   * Log an action result with message and rule context.
   */
  logActivity(result: ActionResult, message: EmailMessage, rule: Rule | null, source: 'arrival' | 'sweep' | 'batch' = 'arrival'): void {
    const stmt = this.db.prepare(`
      INSERT INTO activity (
        timestamp, message_uid, message_id, message_from, message_to,
        message_subject, rule_id, rule_name, action, folder, success, error, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const recipients = [...message.to, ...message.cc]
      .map((a) => a.address)
      .join(', ');

    stmt.run(
      result.timestamp.toISOString(),
      result.messageUid,
      result.messageId || null,
      message.from.address || null,
      recipients || null,
      message.subject || null,
      rule?.id ?? null,
      rule?.name ?? null,
      result.action,
      result.folder ?? null,
      result.success ? 1 : 0,
      result.error ?? null,
      source,
    );
  }

  /**
   * Get a persisted state value by key.
   */
  getState(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Set a persisted state value by key.
   */
  setState(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(key, value);
  }

  /**
   * Retrieve recent activity entries in reverse chronological order.
   */
  getRecentActivity(limit: number = 50, offset: number = 0): ActivityEntry[] {
    const stmt = this.db.prepare(
      'SELECT * FROM activity ORDER BY id DESC LIMIT ? OFFSET ?',
    );
    return stmt.all(limit, offset) as ActivityEntry[];
  }

  /**
   * Return distinct folder paths from recent successful actions, ordered by most recently used.
   */
  getRecentFolders(limit: number = 5): string[] {
    const rows = this.db.prepare(
      `SELECT folder FROM activity
       WHERE folder IS NOT NULL AND folder != '' AND success = 1
       GROUP BY folder
       ORDER BY MAX(id) DESC
       LIMIT ?`
    ).all(limit) as Array<{ folder: string }>;
    return rows.map(r => r.folder);
  }

  /**
   * Remove entries older than the specified number of days.
   */
  prune(days: number = PRUNE_DAYS): number {
    const stmt = this.db.prepare(
      `DELETE FROM activity WHERE timestamp < datetime('now', ?)`,
    );
    const result = stmt.run(`-${days} days`);
    return result.changes;
  }

  /**
   * Start daily pruning. Also prunes immediately on call.
   */
  startAutoPrune(): void {
    this.prune();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    this.pruneInterval = setInterval(() => this.prune(), ONE_DAY_MS);
  }

  /**
   * Stop the auto-prune interval.
   */
  stopAutoPrune(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }

  /**
   * Close the database connection and stop auto-prune.
   */
  close(): void {
    this.stopAutoPrune();
    this.db.close();
  }
}
