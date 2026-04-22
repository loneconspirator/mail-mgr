import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/log/migrations.js';
import { SentinelStore } from '../../../src/sentinel/store.js';
import type { Sentinel } from '../../../src/sentinel/store.js';

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

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

describe('SentinelStore', () => {
  let db: Database.Database;
  let store: SentinelStore;

  beforeEach(() => {
    db = makeDb();
    store = new SentinelStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsert inserts a row; getByMessageId returns it with camelCase fields', () => {
    store.upsert('<abc@mail-manager.sentinel>', 'Archive/Newsletters', 'archive');
    const result = store.getByMessageId('<abc@mail-manager.sentinel>');
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('<abc@mail-manager.sentinel>');
    expect(result!.folderPath).toBe('Archive/Newsletters');
    expect(result!.folderPurpose).toBe('archive');
    expect(result!.createdAt).toBeTruthy();
  });

  it('upsert with same message_id updates folder_path and folder_purpose', () => {
    store.upsert('<abc@mail-manager.sentinel>', 'Archive/Newsletters', 'archive');
    store.upsert('<abc@mail-manager.sentinel>', 'Archive/Tech', 'review');
    const result = store.getByMessageId('<abc@mail-manager.sentinel>');
    expect(result).not.toBeNull();
    expect(result!.folderPath).toBe('Archive/Tech');
    expect(result!.folderPurpose).toBe('review');
  });

  it('getByFolder returns sentinel for that folder', () => {
    store.upsert('<abc@mail-manager.sentinel>', 'Archive/Newsletters', 'archive');
    const result = store.getByFolder('Archive/Newsletters');
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('<abc@mail-manager.sentinel>');
  });

  it('getByFolder returns null if none found', () => {
    const result = store.getByFolder('NonExistent/Folder');
    expect(result).toBeNull();
  });

  it('getByMessageId returns null if none found', () => {
    const result = store.getByMessageId('<nonexistent@mail-manager.sentinel>');
    expect(result).toBeNull();
  });

  it('getAll returns all sentinels as Sentinel[]', () => {
    store.upsert('<a@sentinel>', 'Folder/A', 'archive');
    store.upsert('<b@sentinel>', 'Folder/B', 'review');
    store.upsert('<c@sentinel>', 'Folder/C', 'action');
    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all.every((s: Sentinel) => s.messageId && s.folderPath && s.folderPurpose)).toBe(true);
  });

  it('getAll returns empty array when no sentinels exist', () => {
    const all = store.getAll();
    expect(all).toEqual([]);
  });

  it('deleteByMessageId removes the row and returns true', () => {
    store.upsert('<abc@sentinel>', 'Folder/A', 'archive');
    const deleted = store.deleteByMessageId('<abc@sentinel>');
    expect(deleted).toBe(true);
    expect(store.getByMessageId('<abc@sentinel>')).toBeNull();
  });

  it('deleteByMessageId returns false if not found', () => {
    const deleted = store.deleteByMessageId('<nonexistent@sentinel>');
    expect(deleted).toBe(false);
  });

  it('deleteByFolder removes the row and returns true', () => {
    store.upsert('<abc@sentinel>', 'Folder/A', 'archive');
    const deleted = store.deleteByFolder('Folder/A');
    expect(deleted).toBe(true);
    expect(store.getByFolder('Folder/A')).toBeNull();
  });

  it('deleteByFolder returns false if not found', () => {
    const deleted = store.deleteByFolder('NonExistent/Folder');
    expect(deleted).toBe(false);
  });

  it('updateFolderPath updates the folder_path column', () => {
    store.upsert('<abc@sentinel>', 'Folder/Old', 'archive');
    const updated = store.updateFolderPath('<abc@sentinel>', 'Folder/New');
    expect(updated).toBe(true);
    const result = store.getByMessageId('<abc@sentinel>');
    expect(result!.folderPath).toBe('Folder/New');
  });

  it('updateFolderPath returns false for non-existent messageId', () => {
    const updated = store.updateFolderPath('<nonexistent@sentinel>', 'Folder/New');
    expect(updated).toBe(false);
  });

  it('createdAt is populated automatically by SQLite DEFAULT', () => {
    store.upsert('<abc@sentinel>', 'Folder/A', 'archive');
    const result = store.getByMessageId('<abc@sentinel>');
    expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('sentinel migration', () => {
  it('migration creates sentinels table with expected columns', () => {
    const db = makeDb();
    const cols = db.pragma('table_info(sentinels)') as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('message_id');
    expect(colNames).toContain('folder_path');
    expect(colNames).toContain('folder_purpose');
    expect(colNames).toContain('created_at');
    db.close();
  });

  it('migration creates idx_sentinels_folder_path index', () => {
    const db = makeDb();
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sentinels'"
    ).all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_sentinels_folder_path');
    db.close();
  });

  it('runMigrations is idempotent (running twice does not error)', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    runMigrations(db);
    runMigrations(db);
    const applied = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>;
    expect(applied.length).toBeGreaterThan(0);
    db.close();
  });
});
