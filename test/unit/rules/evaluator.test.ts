import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../../../src/rules/index.js';
import type { Rule } from '../../../src/config/index.js';
import type { EmailMessage } from '../../../src/imap/index.js';

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 1,
    messageId: '<test@example.com>',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    subject: 'Hello World',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(id: string, order: number, match: Rule['match'], overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    name: `Rule ${id}`,
    match,
    action: { type: 'move', folder: `Folder/${id}` },
    enabled: true,
    order,
    ...overrides,
  };
}

describe('evaluateRules', () => {
  it('returns the first matching rule by order', () => {
    const rules = [
      makeRule('second', 2, { sender: '*@example.com' }),
      makeRule('first', 1, { sender: '*@example.com' }),
    ];
    const msg = makeMessage();

    const result = evaluateRules(rules, msg);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('first');
  });

  it('returns null when no rules match', () => {
    const rules = [
      makeRule('nope', 1, { sender: '*@github.com' }),
    ];
    const msg = makeMessage();

    expect(evaluateRules(rules, msg)).toBeNull();
  });

  it('returns null for empty rules array', () => {
    expect(evaluateRules([], makeMessage())).toBeNull();
  });

  it('skips disabled rules', () => {
    const rules = [
      makeRule('disabled', 1, { sender: '*@example.com' }, { enabled: false }),
      makeRule('enabled', 2, { sender: '*@example.com' }),
    ];
    const msg = makeMessage();

    const result = evaluateRules(rules, msg);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('enabled');
  });

  it('returns null when all matching rules are disabled', () => {
    const rules = [
      makeRule('off1', 1, { sender: '*@example.com' }, { enabled: false }),
      makeRule('off2', 2, { sender: '*@example.com' }, { enabled: false }),
    ];
    const msg = makeMessage();

    expect(evaluateRules(rules, msg)).toBeNull();
  });

  it('respects order regardless of array position', () => {
    const rules = [
      makeRule('z-last', 10, { subject: '*' }),
      makeRule('a-first', 1, { subject: '*' }),
      makeRule('m-mid', 5, { subject: '*' }),
    ];
    const msg = makeMessage();

    const result = evaluateRules(rules, msg);
    expect(result!.id).toBe('a-first');
  });

  it('stops at the first match (does not evaluate further)', () => {
    const rules = [
      makeRule('catch-all', 1, { sender: '*@example.com' }),
      makeRule('specific', 2, { sender: 'alice@example.com' }),
    ];
    const msg = makeMessage();

    const result = evaluateRules(rules, msg);
    expect(result!.id).toBe('catch-all');
  });

  it('falls through non-matching rules to find a match', () => {
    const rules = [
      makeRule('no-match', 1, { sender: '*@github.com' }),
      makeRule('match', 2, { sender: '*@example.com' }),
    ];
    const msg = makeMessage();

    const result = evaluateRules(rules, msg);
    expect(result!.id).toBe('match');
  });

  describe('envelope-unavailable skip logic', () => {
    // Skip logic: rules with deliveredTo or visibility are skipped when no envelope data

    it('skips rule with deliveredTo when message has no envelopeRecipient', () => {
      const rules = [
        makeRule('dt', 1, { deliveredTo: '*@example.com' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      expect(evaluateRules(rules, msg)).toBeNull();
    });

    it('skips rule with visibility when message has no envelopeRecipient', () => {
      const rules = [
        makeRule('vis', 1, { sender: '*@example.com', visibility: 'direct' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      expect(evaluateRules(rules, msg)).toBeNull();
    });

    it('skips rule with both deliveredTo AND sender when no envelope (whole rule bypassed)', () => {
      const rules = [
        makeRule('combo', 1, { sender: '*@example.com', deliveredTo: '*@example.com' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      expect(evaluateRules(rules, msg)).toBeNull();
    });

    it('does NOT skip rule with only readStatus when no envelope', () => {
      const rules = [
        makeRule('rs', 1, { readStatus: 'unread' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient, flags empty = unread
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rs');
    });

    it('does NOT skip rule with only sender when no envelope', () => {
      const rules = [
        makeRule('sender', 1, { sender: '*@example.com' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sender');
    });

    it('skips rule with readStatus + visibility when no envelope (visibility triggers skip)', () => {
      const rules = [
        makeRule('rs-vis', 1, { readStatus: 'unread', visibility: 'direct' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      expect(evaluateRules(rules, msg)).toBeNull();
    });

    // Fallthrough ordering tests

    it('skipped envelope rule falls through to non-envelope rule', () => {
      const rules = [
        makeRule('envelope', 1, { deliveredTo: '*@example.com' }),
        makeRule('sender', 2, { sender: '*@example.com' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sender');
    });

    it('skipped visibility rule falls through to readStatus rule', () => {
      const rules = [
        makeRule('vis', 1, { visibility: 'direct' }),
        makeRule('rs', 2, { readStatus: 'unread' }),
      ];
      const msg = makeMessage(); // no envelopeRecipient, flags empty = unread
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rs');
    });

    // Normal operation (envelope available)

    it('evaluates deliveredTo normally when message HAS envelopeRecipient (matching)', () => {
      const rules = [
        makeRule('dt', 1, { deliveredTo: '*@example.com' }),
      ];
      const msg = makeMessage({ envelopeRecipient: '<mike@example.com>', visibility: 'direct' });
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('dt');
    });

    it('evaluates deliveredTo normally when message HAS envelopeRecipient (non-matching)', () => {
      const rules = [
        makeRule('dt', 1, { deliveredTo: '*@other.com' }),
      ];
      const msg = makeMessage({ envelopeRecipient: '<mike@example.com>', visibility: 'direct' });
      expect(evaluateRules(rules, msg)).toBeNull();
    });

    it('evaluates visibility normally when message HAS visibility', () => {
      const rules = [
        makeRule('vis', 1, { visibility: 'direct' }),
      ];
      const msg = makeMessage({ envelopeRecipient: '<mike@example.com>', visibility: 'direct' });
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('vis');
    });

    // readStatus works even when envelope is absent

    it('readStatus unread matches unread message even when envelopeRecipient is undefined', () => {
      const rules = [
        makeRule('rs', 1, { readStatus: 'unread' }),
      ];
      const msg = makeMessage(); // flags empty = unread, no envelopeRecipient
      const result = evaluateRules(rules, msg);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rs');
    });
  });
});
