import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectTrackedFolders } from '../../../src/sentinel/lifecycle.js';
import type { Config } from '../../../src/config/schema.js';
import type { FolderPurpose } from '../../../src/sentinel/format.js';

/** Build a minimal Config with overrides for testing. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    imap: {
      host: 'localhost',
      port: 993,
      tls: true,
      auth: { user: 'test', pass: 'test' },
      idleTimeout: 300_000,
      pollInterval: 60_000,
    },
    server: { port: 3000, host: '0.0.0.0' },
    rules: [],
    review: {
      folder: 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
      moveTracking: { enabled: true, scanInterval: 30 },
    },
    actionFolders: {
      enabled: true,
      prefix: 'Actions',
      pollInterval: 15,
      folders: {
        vip: '\u2B50 VIP Sender',
        block: '\uD83D\uDEAB Block Sender',
        undoVip: '\u21A9\uFE0F Undo VIP',
        unblock: '\u2705 Unblock Sender',
      },
    },
    ...overrides,
  } as Config;
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    match: { sender: 'test@example.com' },
    action: { type: 'move' as const, folder: 'Archive' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

describe('collectTrackedFolders', () => {
  it('includes move rule target as rule-target', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'Archive' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Archive')).toBe('rule-target');
  });

  it('includes review folder as review', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Review')).toBe('review');
  });

  it('includes review rule with custom folder as review', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'review', folder: 'Review/Special' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Review/Special')).toBe('review');
  });

  it('includes defaultArchiveFolder as sweep-target', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('MailingLists')).toBe('sweep-target');
  });

  it('includes action folder paths when actionFolders enabled', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: {
        enabled: true,
        prefix: 'Actions',
        pollInterval: 15,
        folders: { vip: '\u2B50 VIP Sender', block: '\uD83D\uDEAB Block Sender', undoVip: '\u21A9\uFE0F Undo VIP', unblock: '\u2705 Unblock Sender' },
      },
    });
    const result = collectTrackedFolders(config);
    expect(result.get('Actions/\u2B50 VIP Sender')).toBe('action-folder');
    expect(result.get('Actions/\uD83D\uDEAB Block Sender')).toBe('action-folder');
    expect(result.get('Actions/\u21A9\uFE0F Undo VIP')).toBe('action-folder');
    expect(result.get('Actions/\u2705 Unblock Sender')).toBe('action-folder');
  });

  it('excludes action folders when actionFolders disabled', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: {
        enabled: false,
        prefix: 'Actions',
        pollInterval: 15,
        folders: { vip: '\u2B50 VIP Sender', block: '\uD83D\uDEAB Block Sender', undoVip: '\u21A9\uFE0F Undo VIP', unblock: '\u2705 Unblock Sender' },
      },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('Actions/\u2B50 VIP Sender')).toBe(false);
  });

  it('excludes INBOX from move rule targets', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'INBOX' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('INBOX')).toBe(false);
  });

  it('excludes INBOX from review folder (edge case)', () => {
    const config = makeConfig({
      rules: [],
      review: {
        folder: 'INBOX',
        defaultArchiveFolder: 'MailingLists',
        trashFolder: 'Trash',
        sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
        moveTracking: { enabled: true, scanInterval: 30 },
      },
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('INBOX')).toBe(false);
  });

  it('skips disabled rules', () => {
    const config = makeConfig({
      rules: [makeRule({ enabled: false, action: { type: 'move', folder: 'Archive' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.has('Archive')).toBe(false);
  });

  it('first purpose wins when multiple sources point to same folder', () => {
    const config = makeConfig({
      rules: [makeRule({ action: { type: 'move', folder: 'Review' } })],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    // Rules are processed first, so 'Review' should be 'rule-target', not 'review'
    expect(result.get('Review')).toBe('rule-target');
  });

  it('returns review folder + defaultArchiveFolder with empty rules', () => {
    const config = makeConfig({
      rules: [],
      actionFolders: { enabled: false, prefix: 'Actions', pollInterval: 15, folders: { vip: 'a', block: 'b', undoVip: 'c', unblock: 'd' } },
    });
    const result = collectTrackedFolders(config);
    expect(result.size).toBe(2);
    expect(result.has('Review')).toBe(true);
    expect(result.has('MailingLists')).toBe(true);
  });
});
