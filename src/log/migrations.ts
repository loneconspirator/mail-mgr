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
