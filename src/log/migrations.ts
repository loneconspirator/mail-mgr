import type Database from 'better-sqlite3';

export interface Migration {
  version: string;
  description: string;
  up: (db: Database.Database) => void;
}

/** All migrations in version-sorted order. */
export const migrations: Migration[] = [
  {
    version: '20260411_001',
    description: 'Bootstrap: source column and indexes',
    up: (db: Database.Database): void => {
      const columns = db.pragma('table_info(activity)') as Array<{ name: string }>;
      const hasSource = columns.some(c => c.name === 'source');

      if (!hasSource) {
        db.exec(`ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'`);
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_source ON activity(source)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_folder_success ON activity(folder, success)`);
    },
  },
];

/**
 * Run all pending migrations against the database.
 * Creates the schema_version tracking table if it does not exist.
 * Each migration runs inside a transaction and is recorded after success.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: string }>)
      .map(r => r.version)
  );

  const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));

  for (const migration of sorted) {
    if (applied.has(migration.version)) {
      continue;
    }

    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    });

    run();
  }
}
