import type Database from 'better-sqlite3';

export interface Migration {
  version: string;
  description: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [];

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
