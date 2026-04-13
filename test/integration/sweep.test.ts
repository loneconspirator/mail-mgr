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

describe('Sweep lifecycle integration', () => {
  it('timer fires → fetches review folder → moves eligible → logs to DB', async () => {
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

  it('repeated timer fires produce multiple sweeps', async () => {
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
});
