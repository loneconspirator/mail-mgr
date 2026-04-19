import { describe, it, expect } from 'vitest';
import { checkProposalConflict } from '../../../src/rules/conflict-checker.js';
import type { Rule } from '../../../src/config/schema.js';

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: 'foo@bar.com' },
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

describe('checkProposalConflict', () => {
  it('detects exact match — same sender, no deliveredTo', () => {
    const rules = [makeRule({ match: { sender: 'foo@bar.com' } })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('exact');
    expect(result!.rule.id).toBe('rule-1');
  });

  it('detects exact match with deliveredTo', () => {
    const rules = [makeRule({ match: { sender: 'foo@bar.com', deliveredTo: 'me@bar.com' } })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: 'me@bar.com' }, rules);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('exact');
  });

  it('returns null when no conflict — different sender', () => {
    const rules = [makeRule({ match: { sender: 'other@bar.com' } })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).toBeNull();
  });

  it('detects shadow — existing rule with same sender at lower order', () => {
    const rules = [makeRule({ match: { sender: 'foo@bar.com' }, order: 0 })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    // This is an exact match actually (same sender, no extra fields)
    // Shadow is when the existing rule uses a glob that INCLUDES the proposal sender
    expect(result).not.toBeNull();
  });

  it('detects shadow with broader existing glob rule', () => {
    const rules = [makeRule({ match: { sender: '*@bar.com' }, order: 0 })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('shadow');
    expect(result!.rule.id).toBe('rule-1');
  });

  it('not shadowed when existing rule has MORE restrictive match (extra fields like subject)', () => {
    const rules = [makeRule({ match: { sender: '*@bar.com', subject: '*newsletter*' }, order: 0 })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).toBeNull();
  });

  it('ignores disabled rules in conflict checking', () => {
    const rules = [makeRule({ match: { sender: 'foo@bar.com' }, enabled: false })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).toBeNull();
  });

  it('exact match is case-insensitive', () => {
    const rules = [makeRule({ match: { sender: 'FOO@BAR.COM' } })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('exact');
  });

  it('not exact when existing rule has extra narrowing match fields', () => {
    // Rule has sender + subject — it's narrower than the proposal (sender only)
    const rules = [makeRule({ match: { sender: 'foo@bar.com', subject: '*newsletter*' } })];
    const result = checkProposalConflict({ sender: 'foo@bar.com', envelopeRecipient: null }, rules);
    expect(result).toBeNull();
  });
});
