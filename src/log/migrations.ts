import type Database from 'better-sqlite3';

export interface Migration {
  version: string;
  description: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
  {
    version: '20260412_001',
    description: 'Create move_signals table for user move tracking',
    up: (db) => {
      db.exec(`
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
      db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON move_signals(timestamp)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_sender ON move_signals(sender)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_destination ON move_signals(destination_folder)`);
    },
  },
  {
    version: '20260413_001',
    description: 'Create proposed_rules table for pattern detection',
    up: (db) => {
      db.exec(`
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
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_key
        ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposed_rules(status)`);
    },
  },
  {
    version: '20260421_001',
    description: 'Create sentinels table for folder tracking',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sentinels (
          message_id TEXT PRIMARY KEY,
          folder_path TEXT NOT NULL,
          folder_purpose TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sentinels_folder_path ON sentinels(folder_path)`);
    },
  },
];

/**
 * Run all pending migrations in order. Tracks applied versions in
 * the `schema_migrations` table so each migration runs at most once.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  for (const migration of migrations) {
    const applied = db.prepare(
      'SELECT version FROM schema_migrations WHERE version = ?',
    ).get(migration.version);

    if (!applied) {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(
        migration.version,
      );
    }
  }
}
