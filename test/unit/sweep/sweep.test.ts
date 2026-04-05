import { describe, it, expect } from 'vitest';
import type { SweepDeps, SweepState } from '../../../src/sweep/index.js';

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
