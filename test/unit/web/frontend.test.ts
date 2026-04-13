import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { stringify as stringifyYaml } from 'yaml';
import { buildServer } from '../../../src/web/server.js';
import type { ServerDeps } from '../../../src/web/server.js';
import type { Config } from '../../../src/config/index.js';
import { ConfigRepository } from '../../../src/config/repository.js';
import { ActivityLog } from '../../../src/log/index.js';
import { ProposalStore } from '../../../src/tracking/proposals.js';
import { runMigrations } from '../../../src/log/migrations.js';

// --- Helpers ---

function makeConfig(rules: Config['rules'] = []): Config {
  return {
    imap: {
      host: 'imap.test.com',
      port: 993,
      tls: true,
      auth: { user: 'test@test.com', pass: 'secret123' },
      idleTimeout: 300000,
      pollInterval: 60000,
    },
    server: { port: 3000, host: '0.0.0.0' },
    rules,
  };
}

let tmpDir: string;
let configPath: string;
let activityLog: ActivityLog;

function makeDeps(config: Config): ServerDeps {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
  const configRepo = new ConfigRepository(configPath);
  const proposalDb = new Database(':memory:');
  runMigrations(proposalDb);
  return {
    configRepo,
    activityLog,
    staticRoot: path.join(process.cwd(), 'dist', 'public'),
    getMonitor: () => ({
      getState() {
        return {
          connectionStatus: 'connected',
          lastProcessedAt: new Date('2026-01-01T00:00:00Z'),
          messagesProcessed: 42,
        };
      },
    } as any),
    getSweeper: () => undefined,
    getFolderCache: () => { throw new Error('not wired in frontend tests'); },
    getBatchEngine: () => { throw new Error('not wired in frontend tests'); },
    getMoveTracker: () => undefined,
    getProposalStore: () => new ProposalStore(proposalDb),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-mgr-fe-test-'));
  configPath = path.join(tmpDir, 'config.yml');
  activityLog = new ActivityLog(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Happy Calf Tests: Frontend SPA Serving ---

describe('Frontend SPA serving', () => {
  it('serves index.html at root with correct content', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mail Manager');
    expect(res.body).toContain('<script src="/app.js">');
    expect(res.body).toContain('<link rel="stylesheet" href="/styles.css">');
  });

  it('serves bundled app.js', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/app.js' });

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('serves styles.css', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/styles.css' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('font-family');
  });

  it('falls back to index.html for unknown non-API routes (SPA routing)', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/some/deep/route' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mail Manager');
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('API routes still work alongside static file serving', async () => {
    const config = makeConfig([{
      id: 'r1', name: 'Test', match: { sender: '*@test.com' },
      action: { type: 'move', folder: 'Test' }, enabled: true, order: 0,
    }]);
    const app = buildServer(makeDeps(config));

    const rulesRes = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(rulesRes.statusCode).toBe(200);
    expect(rulesRes.json()).toHaveLength(1);

    const statusRes = await app.inject({ method: 'GET', url: '/api/status' });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().connectionStatus).toBe('connected');

    const activityRes = await app.inject({ method: 'GET', url: '/api/activity' });
    expect(activityRes.statusCode).toBe(200);

    const imapRes = await app.inject({ method: 'GET', url: '/api/config/imap' });
    expect(imapRes.statusCode).toBe(200);
    expect(imapRes.json().host).toBe('imap.test.com');
  });

  it('index.html contains Proposed nav button with badge', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-page="proposed"');
    expect(res.body).toContain('nav-badge');
    expect(res.body).toContain('proposed-badge');
  });

  it('styles.css contains Phase 11 proposal card styles', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/styles.css' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('.proposal-card');
    expect(res.body).toContain('.strength-strong');
    expect(res.body).toContain('.strength-moderate');
    expect(res.body).toContain('.strength-weak');
    expect(res.body).toContain('.strength-ambiguous');
    expect(res.body).toContain('.btn-dismiss');
    expect(res.body).toContain('.nav-badge');
  });

  it('compiled app.js contains proposed page logic', async () => {
    const app = buildServer(makeDeps(makeConfig()));
    const res = await app.inject({ method: 'GET', url: '/app.js' });

    expect(res.statusCode).toBe(200);
    // Check for string literals that survive minification
    expect(res.body).toContain('Proposed Rules');
    expect(res.body).toContain('No proposed rules yet');
    expect(res.body).toContain('/api/proposed-rules');
    expect(res.body).toContain('strength-strong');
    expect(res.body).toContain('strength-moderate');
    expect(res.body).toContain('strength-weak');
    expect(res.body).toContain('strength-ambiguous');
    expect(res.body).toContain('proposal-card');
    expect(res.body).toContain('mark-approved');
    expect(res.body).toContain('Approve Rule');
    expect(res.body).toContain('Dismiss');
  });
});

// --- Proposed Rules page tests ---

function createProposalDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE move_signals (
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
  db.exec(`
    CREATE TABLE proposed_rules (
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
  db.exec(`CREATE UNIQUE INDEX idx_proposals_key
    ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder)`);
  return db;
}

function makeDepsWithProposals(config: Config, proposalDb: Database.Database): ServerDeps {
  fs.writeFileSync(configPath, stringifyYaml(config), 'utf-8');
  const configRepo = new ConfigRepository(configPath);
  const proposalStore = new ProposalStore(proposalDb);
  return {
    configRepo,
    activityLog,
    staticRoot: path.join(process.cwd(), 'dist', 'public'),
    getMonitor: () => ({
      getState() {
        return {
          connectionStatus: 'connected',
          lastProcessedAt: new Date('2026-01-01T00:00:00Z'),
          messagesProcessed: 42,
        };
      },
    } as any),
    getProposalStore: () => proposalStore,
  } as ServerDeps;
}

describe('Proposed Rules page', () => {
  it('GET /api/proposed-rules returns proposals with card fields', async () => {
    const db = createProposalDb();
    db.prepare(`
      INSERT INTO proposed_rules (sender, source_folder, destination_folder, matching_count, contradicting_count, destination_counts, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('news@example.com', 'INBOX', 'Newsletters', 5, 0, JSON.stringify({ Newsletters: 5 }), 'active');
    db.prepare(`
      INSERT INTO move_signals (message_id, sender, subject, read_status, source_folder, destination_folder)
      VALUES (?, ?, ?, 'unread', ?, ?)
    `).run('msg-1', 'news@example.com', 'Weekly digest', 'INBOX', 'Newsletters');

    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });

    expect(res.statusCode).toBe(200);
    const cards = res.json();
    expect(cards).toHaveLength(1);
    expect(cards[0].sender).toBe('news@example.com');
    expect(cards[0].destinationFolder).toBe('Newsletters');
    expect(cards[0].strengthLabel).toBeDefined();
    expect(cards[0].examples).toBeDefined();
    expect(Array.isArray(cards[0].examples)).toBe(true);
    db.close();
  });

  it('GET /api/proposed-rules returns empty array when no proposals exist', async () => {
    const db = createProposalDb();
    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    db.close();
  });

  it('POST /api/proposed-rules/:id/approve creates a rule and returns it', async () => {
    const db = createProposalDb();
    const id = db.prepare(`
      INSERT INTO proposed_rules (sender, source_folder, destination_folder, matching_count, destination_counts, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test@example.com', 'INBOX', 'Archive', 5, JSON.stringify({ Archive: 5 }), 'active').lastInsertRowid;

    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'POST', url: `/api/proposed-rules/${id}/approve` });

    expect(res.statusCode).toBe(200);
    const rule = res.json();
    expect(rule.id).toBeDefined();
    expect(rule.match.sender).toBe('test@example.com');
    expect(rule.action.folder).toBe('Archive');
    db.close();
  });

  it('POST /api/proposed-rules/:id/dismiss returns 204', async () => {
    const db = createProposalDb();
    const id = db.prepare(`
      INSERT INTO proposed_rules (sender, source_folder, destination_folder, matching_count, destination_counts, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test@example.com', 'INBOX', 'Archive', 5, JSON.stringify({ Archive: 5 }), 'active').lastInsertRowid;

    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'POST', url: `/api/proposed-rules/${id}/dismiss` });

    expect(res.statusCode).toBe(204);

    // Verify status changed
    const row = db.prepare('SELECT status FROM proposed_rules WHERE id = ?').get(id) as any;
    expect(row.status).toBe('dismissed');
    db.close();
  });

  it('proposal card includes conflict annotation when contradicting_count > 0', async () => {
    const db = createProposalDb();
    db.prepare(`
      INSERT INTO proposed_rules (sender, source_folder, destination_folder, matching_count, contradicting_count, destination_counts, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('test@example.com', 'INBOX', 'Archive', 5, 2, JSON.stringify({ Archive: 5, Trash: 2 }), 'active');

    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });

    expect(res.statusCode).toBe(200);
    const cards = res.json();
    expect(cards).toHaveLength(1);
    expect(cards[0].conflictAnnotation).toBeTruthy();
    expect(cards[0].contradictingCount).toBe(2);
    db.close();
  });

  it('proposal card includes resurfaced notice for previously dismissed proposals', async () => {
    const db = createProposalDb();
    db.prepare(`
      INSERT INTO proposed_rules (sender, source_folder, destination_folder, matching_count, destination_counts, status, dismissed_at, signals_since_dismiss)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-1 day'), ?)
    `).run('test@example.com', 'INBOX', 'Archive', 8, JSON.stringify({ Archive: 8 }), 'active', 6);

    const app = buildServer(makeDepsWithProposals(makeConfig(), db));
    const res = await app.inject({ method: 'GET', url: '/api/proposed-rules' });

    expect(res.statusCode).toBe(200);
    const cards = res.json();
    expect(cards).toHaveLength(1);
    expect(cards[0].resurfacedNotice).toBeTruthy();
    expect(cards[0].signalsSinceDismiss).toBe(6);
    db.close();
  });
});
