import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, migrations } from '../../../src/log/migrations.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
});

afterEach(() => {
  db.close();
});

describe('runMigrations', () => {
  it('creates move_signals table', () => {
    runMigrations(db);

    const columns = db.pragma('table_info(move_signals)') as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('message_id');
    expect(columnNames).toContain('sender');
    expect(columnNames).toContain('envelope_recipient');
    expect(columnNames).toContain('list_id');
    expect(columnNames).toContain('subject');
    expect(columnNames).toContain('read_status');
    expect(columnNames).toContain('visibility');
    expect(columnNames).toContain('source_folder');
    expect(columnNames).toContain('destination_folder');
    expect(columnNames).toHaveLength(11);
  });

  it('creates indexes on move_signals', () => {
    runMigrations(db);

    const indexes = db.pragma('index_list(move_signals)') as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_signals_timestamp');
    expect(indexNames).toContain('idx_signals_sender');
    expect(indexNames).toContain('idx_signals_destination');
  });

  it('is idempotent -- running twice does not error', () => {
    runMigrations(db);
    runMigrations(db);

    const columns = db.pragma('table_info(move_signals)') as Array<{ name: string }>;
    expect(columns).toHaveLength(11);
  });

  it('has migration with version 20260412_001', () => {
    const migration = migrations.find((m) => m.version === '20260412_001');
    expect(migration).toBeDefined();
    expect(migration!.description).toContain('move_signals');
  });
});
