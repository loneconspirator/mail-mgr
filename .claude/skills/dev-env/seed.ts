/**
 * Dev environment seed script.
 * Reads seed-data.yml and populates GreenMail (via SMTP) and SQLite (direct inserts).
 *
 * Usage: npx tsx .claude/skills/dev-environment/seed.ts
 *
 * Expects:
 *   - GreenMail running on localhost:3025 (SMTP) and localhost:3143 (IMAP)
 *   - DATA_PATH env var set (defaults to /tmp/mail-mgr-dev)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';
import { sendTestEmail } from '../../../test/integration/helpers.js';
import { runMigrations } from '../../../src/log/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.DATA_PATH ?? '/tmp/mail-mgr-dev';
const DB_PATH = path.join(DATA_PATH, 'db.sqlite3');
const SEED_PATH = path.join(__dirname, 'seed-data.yml');

interface SeedData {
  folders?: string[];
  rules: Array<{
    id: string;
    name?: string;
    match: Record<string, string>;
    action: Record<string, string>;
    order: number;
  }>;
  emails: Array<{
    from: string;
    subject: string;
    body: string;
  }>;
  move_signals: Array<{
    sender: string;
    source_folder: string;
    destination_folder: string;
    subject: string;
    count: number;
  }>;
  proposed_rules: Array<{
    sender: string;
    envelope_recipient?: string;
    source_folder: string;
    destination_folder: string;
    matching_count: number;
    contradicting_count?: number;
    destination_counts: string;
    status: string;
  }>;
  activity: Array<{
    message_from: string;
    message_subject: string;
    rule_name: string | null;
    rule_id: string | null;
    action: string;
    folder: string | null;
    source: string;
    success: boolean;
  }>;
}

function loadSeedData(): SeedData {
  const raw = fs.readFileSync(SEED_PATH, 'utf-8');
  return parseYaml(raw) as SeedData;
}

function generateConfig(seed: SeedData): string {
  const config = {
    imap: {
      host: 'localhost',
      port: 3143,
      tls: false,
      auth: { user: 'user', pass: 'pass' },
      idleTimeout: 300000,
      pollInterval: 60000,
    },
    server: {
      port: 3001,
      host: '0.0.0.0',
    },
    rules: seed.rules,
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
    },
  };

  return stringifyYaml(config);
}

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create base tables (same as ActivityLog constructor)
  db.exec(`
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
    );
  `);

  // Add source column (same migration as ActivityLog.migrate())
  try {
    db.exec(`ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'`);
  } catch {
    // Column already exists
  }

  // Run remaining migrations (move_signals, proposed_rules)
  runMigrations(db);

  return db;
}

function seedMoveSignals(db: Database.Database, signals: SeedData['move_signals']): number {
  const stmt = db.prepare(`
    INSERT INTO move_signals (
      timestamp, message_id, sender, envelope_recipient, list_id,
      subject, read_status, visibility, source_folder, destination_folder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let total = 0;
  for (const signal of signals) {
    for (let i = 0; i < signal.count; i++) {
      const daysAgo = signal.count - i;
      const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
      stmt.run(
        timestamp,
        `seed-signal-${signal.sender}-${i}@dev`,
        signal.sender,
        null,  // envelope_recipient
        null,  // list_id
        `${signal.subject} #${i + 1}`,
        'unread',
        'direct',
        signal.source_folder,
        signal.destination_folder,
      );
      total++;
    }
  }
  return total;
}

function seedProposedRules(db: Database.Database, proposals: SeedData['proposed_rules']): number {
  const stmt = db.prepare(`
    INSERT INTO proposed_rules (
      sender, envelope_recipient, source_folder, destination_folder,
      matching_count, contradicting_count, destination_counts, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of proposals) {
    stmt.run(
      p.sender,
      p.envelope_recipient ?? null,
      p.source_folder,
      p.destination_folder,
      p.matching_count,
      p.contradicting_count ?? 0,
      p.destination_counts,
      p.status,
    );
  }
  return proposals.length;
}

function seedActivity(db: Database.Database, entries: SeedData['activity']): number {
  const stmt = db.prepare(`
    INSERT INTO activity (
      timestamp, message_uid, message_id, message_from, message_to,
      message_subject, rule_id, rule_name, action, folder, success, error, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let uid = 1000;
  for (const entry of entries) {
    const daysAgo = entries.length - entries.indexOf(entry);
    const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
    stmt.run(
      timestamp,
      uid++,
      `seed-activity-${uid}@dev`,
      entry.message_from,
      null,  // message_to
      entry.message_subject,
      entry.rule_id,
      entry.rule_name,
      entry.action,
      entry.folder,
      entry.success ? 1 : 0,
      null,  // error
      entry.source,
    );
  }
  return entries.length;
}

async function createImapFolders(folders: string[]): Promise<number> {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'localhost', port: 3143,
    auth: { user: 'user', pass: 'pass' },
    secure: false, logger: false,
  });
  await client.connect();
  let created = 0;
  for (const folder of folders) {
    try {
      await client.mailboxCreate(folder);
      created++;
    } catch {
      // Folder already exists
    }
  }
  await client.logout();
  return created;
}

async function seedEmails(emails: SeedData['emails']): Promise<number> {
  for (const email of emails) {
    await sendTestEmail({
      from: email.from,
      to: 'user@localhost',
      subject: email.subject,
      body: email.body,
    });
  }
  return emails.length;
}

async function main(): Promise<void> {
  console.log('Loading seed data...');
  const seed = loadSeedData();

  // Ensure data directory exists
  fs.mkdirSync(DATA_PATH, { recursive: true });

  // Generate config.yml
  console.log('Generating config.yml...');
  const configContent = await generateConfig(seed);
  fs.writeFileSync(path.join(DATA_PATH, 'config.yml'), configContent);

  // Initialize database with schema
  console.log('Initializing database...');
  const db = initDb();

  // Seed database tables
  const signalCount = seedMoveSignals(db, seed.move_signals);
  console.log(`  Inserted ${signalCount} move signals`);

  const proposalCount = seedProposedRules(db, seed.proposed_rules);
  console.log(`  Inserted ${proposalCount} proposed rules`);

  const activityCount = seedActivity(db, seed.activity);
  console.log(`  Inserted ${activityCount} activity entries`);

  db.close();

  // Create IMAP folders in GreenMail
  if (seed.folders?.length) {
    console.log('Creating IMAP folders...');
    const folderCount = await createImapFolders(seed.folders);
    console.log(`  Created ${folderCount} folders`);
  }

  // Send emails via SMTP to GreenMail
  console.log('Sending emails to GreenMail...');
  const emailCount = await seedEmails(seed.emails);
  console.log(`  Sent ${emailCount} emails`);

  console.log('\nSeed complete!');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
