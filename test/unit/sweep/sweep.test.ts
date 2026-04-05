import { describe, it, expect } from 'vitest';
import { isEligibleForSweep } from '../../../src/sweep/index.js';
import type { SweepDeps, SweepState } from '../../../src/sweep/index.js';
import type { SweepConfig } from '../../../src/config/index.js';
import type { ReviewMessage } from '../../../src/imap/index.js';

describe('SweepDeps and SweepState', () => {
  it('SweepState has the expected shape', () => {
    const state: SweepState = {
      folder: 'Review',
      totalMessages: 0,
      unreadMessages: 0,
      readMessages: 0,
      nextSweepAt: null,
      lastSweep: null,
    };
    expect(state.folder).toBe('Review');
    expect(state.lastSweep).toBeNull();
  });
});

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

const defaultSweepConfig: SweepConfig = {
  intervalHours: 6,
  readMaxAgeDays: 7,
  unreadMaxAgeDays: 14,
};

describe('isEligibleForSweep', () => {
  const now = new Date('2026-04-01T00:00:00Z');

  it('read message older than readMaxAgeDays is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-20T00:00:00Z'), // 12 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('read message younger than readMaxAgeDays is not eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-28T00:00:00Z'), // 4 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(false);
  });

  it('unread message older than unreadMaxAgeDays is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-10T00:00:00Z'), // 22 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('unread message younger than unreadMaxAgeDays is not eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-25T00:00:00Z'), // 7 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(false);
  });

  it('read message exactly at readMaxAgeDays boundary is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(['\\Seen']),
      internalDate: new Date('2026-03-25T00:00:00Z'), // exactly 7 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });

  it('unread message exactly at unreadMaxAgeDays boundary is eligible', () => {
    const msg = makeReviewMessage({
      flags: new Set(),
      internalDate: new Date('2026-03-18T00:00:00Z'), // exactly 14 days old
    });
    expect(isEligibleForSweep(msg, defaultSweepConfig, now)).toBe(true);
  });
});
