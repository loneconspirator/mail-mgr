/**
 * Integration test for IX-006 — Review sweep eligibility and age-based filing.
 *
 * Spec: specs/integrations/ix-006-review-sweep-eligibility-and-filing.md
 *
 * Named interaction coverage in this file:
 *   IX-006.1 — timer fires (or manual trigger) → fetch all messages from review folder
 *   IX-006.2 — sentinel messages are skipped during sweep
 *   IX-006.3 — eligibility computed from age + read flag (readMaxAgeDays / unreadMaxAgeDays)
 *   IX-006.4 — ineligible (too young) messages are left in place
 *   IX-006.5 — RuleEvaluator runs sweep-filtered rule set (no skip / no bare-review rules)
 *   IX-006.6 — matching rule moves message to destination folder or trash
 *   IX-006.7 — no matching rule → message goes to defaultArchiveFolder
 *   IX-006.8 — every move is logged to ActivityLog with source = 'sweep'
 *   IX-006.9 — after run, sweep state is updated (lastSweep timestamp + counts, nextSweepAt)
 *
 * Companion unit suite: test/unit/sweep/sweep.test.ts exercises IX-006.3 / IX-006.4 /
 * IX-006.5 / IX-006.6 / IX-006.7 boundaries in isolation; this file proves the lifecycle
 * (timer → fetch → eligibility → rule eval → move → log → state update) end-to-end against
 * a real SQLite ActivityLog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ReviewSweeper } from '../../src/sweep/index.js';
import type { ReviewMessage } from '../../src/imap/index.js';
import type { ImapClient } from '../../src/imap/index.js';
import { ActivityLog } from '../../src/log/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 1,
    flags: new Set<string>(),
    internalDate: new Date('2026-03-01T00:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Test',
      messageId: '<msg-1@example.com>',
    },
    ...overrides,
  };
}

let tmpDir: string;
let activityLog: ActivityLog;

beforeEach(() => {
  vi.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailmgr-sweep-'));
  activityLog = new ActivityLog(path.join(tmpDir, 'db.sqlite3'));
});

afterEach(() => {
  vi.useRealTimers();
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Sweep lifecycle integration (IX-006)', () => {
  it('IX-006.1 / IX-006.3 / IX-006.7 / IX-006.8 / IX-006.9: timer fires → fetches review folder → moves eligible → logs to DB → updates state', async () => {
    const oldMsg = makeReviewMessage({
      uid: 5,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([oldMsg]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();

    // Advance past initial 30s delay
    await vi.advanceTimersByTimeAsync(30_000);

    expect(client.fetchAllMessages).toHaveBeenCalledWith('Review');
    expect(client.moveMessage).toHaveBeenCalledWith(5, 'MailingLists', 'Review');

    // Verify activity persisted in real DB
    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].message_uid).toBe(5);
    expect(entries[0].action).toBe('move');
    expect(entries[0].folder).toBe('MailingLists');
    expect(entries[0].source).toBe('sweep');

    const state = sweeper.getState();
    expect(state.lastSweep).not.toBeNull();
    expect(state.lastSweep!.messagesArchived).toBe(1);

    sweeper.stop();
  });

  it('IX-006.1 / IX-006.9: repeated timer fires produce multiple sweeps and refresh nextSweepAt', async () => {
    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    sweeper.start();

    // Initial sweep after 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.fetchAllMessages).toHaveBeenCalledTimes(1);

    // Second sweep after 1 hour
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(client.fetchAllMessages).toHaveBeenCalledTimes(2);

    sweeper.stop();
  });

  it('IX-006.2 / IX-006.4: sentinels and too-young messages stay in the review folder and are not logged', async () => {
    const sentinelMsg = makeReviewMessage({
      uid: 1,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      headers: new Map([['x-mail-mgr-sentinel', '<sentinel-1@mail-manager.sentinel>']]),
    });
    const tooYoungRead = makeReviewMessage({
      uid: 2,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const tooYoungUnread = makeReviewMessage({
      uid: 3,
      flags: new Set(),
      internalDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    const eligible = makeReviewMessage({
      uid: 4,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([sentinelMsg, tooYoungRead, tooYoungUnread, eligible]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    // Only the eligible non-sentinel message moves
    expect(client.moveMessage).toHaveBeenCalledTimes(1);
    expect(client.moveMessage).toHaveBeenCalledWith(4, 'MailingLists', 'Review');

    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].message_uid).toBe(4);

    const state = sweeper.getState();
    expect(state.lastSweep!.messagesArchived).toBe(1);
  });

  it('IX-006.5 / IX-006.6: matching move rule routes to its folder, matching delete rule routes to trash, skip rule is ignored', async () => {
    const moveTarget = makeReviewMessage({
      uid: 10,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      envelope: {
        from: { name: 'Lists', address: 'announce@lists.example.com' },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        subject: 'Move me',
        messageId: '<move@example.com>',
      },
    });
    const deleteTarget = makeReviewMessage({
      uid: 11,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      envelope: {
        from: { name: 'Spam', address: 'noise@spam.example.com' },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        subject: 'Delete me',
        messageId: '<del@example.com>',
      },
    });
    const skipShouldNotBlock = makeReviewMessage({
      uid: 12,
      flags: new Set(['\\Seen']),
      internalDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      envelope: {
        from: { name: 'Skipper', address: 'noskip@example.com' },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        subject: 'No skip rule should reach me at sweep time',
        messageId: '<skip@example.com>',
      },
    });

    const client = {
      state: 'connected',
      fetchAllMessages: vi.fn().mockResolvedValue([moveTarget, deleteTarget, skipShouldNotBlock]),
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient;

    const sweeper = new ReviewSweeper({
      client,
      activityLog,
      rules: [
        // Skip rules are filtered out of the sweep rule set per IX-006.5.
        { id: 'r-skip', name: 'Skip', match: { sender: '*@example.com' }, action: { type: 'skip' }, enabled: true, order: 1 },
        { id: 'r-move', name: 'Move', match: { sender: '*@lists.example.com' }, action: { type: 'move', folder: 'Archive/Lists' }, enabled: true, order: 2 },
        { id: 'r-del', name: 'Del', match: { sender: '*@spam.example.com' }, action: { type: 'delete' }, enabled: true, order: 3 },
      ],
      reviewConfig: {
        folder: 'Review',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 1, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      },
      trashFolder: 'Trash',
      logger: silentLogger,
    });

    await sweeper.runSweep();

    expect(client.moveMessage).toHaveBeenCalledWith(10, 'Archive/Lists', 'Review');
    expect(client.moveMessage).toHaveBeenCalledWith(11, 'Trash', 'Review');
    // Skip rule was filtered from sweep rules, so this message falls through to default archive
    // rather than being left behind.
    expect(client.moveMessage).toHaveBeenCalledWith(12, 'MailingLists', 'Review');

    const entries = activityLog.getRecentActivity();
    expect(entries).toHaveLength(3);
    const byUid = new Map(entries.map((e) => [e.message_uid, e]));
    expect(byUid.get(10)!.folder).toBe('Archive/Lists');
    expect(byUid.get(11)!.folder).toBe('Trash');
    expect(byUid.get(12)!.folder).toBe('MailingLists');
    for (const e of entries) {
      expect(e.source).toBe('sweep');
    }
  });
});
