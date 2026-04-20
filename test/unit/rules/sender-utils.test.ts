import { describe, it, expect } from 'vitest';
import { isSenderOnly, findSenderRule } from '../../../src/rules/sender-utils.js';
import type { Rule } from '../../../src/config/schema.js';

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r0',
    name: 'Test Rule',
    match: { sender: 'test@example.com' },
    action: { type: 'skip' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

describe('isSenderOnly', () => {
  it('returns true for a rule with only sender match field', () => {
    const rule = makeRule({ match: { sender: 'alice@example.com' } });
    expect(isSenderOnly(rule)).toBe(true);
  });

  it('returns false for a rule with sender + subject match fields', () => {
    const rule = makeRule({ match: { sender: 'alice@example.com', subject: '*invoice*' } });
    expect(isSenderOnly(rule)).toBe(false);
  });

  it('returns true for a rule with sender + readStatus=any', () => {
    const rule = makeRule({ match: { sender: 'alice@example.com', readStatus: 'any' } });
    expect(isSenderOnly(rule)).toBe(true);
  });
});

describe('findSenderRule', () => {
  const rules: Rule[] = [
    makeRule({ id: 'r1', name: 'VIP alice', match: { sender: 'alice@example.com' }, action: { type: 'skip' }, enabled: true, order: 1 }),
    makeRule({ id: 'r2', name: 'Block bob', match: { sender: 'bob@example.com' }, action: { type: 'delete' }, enabled: true, order: 2 }),
    makeRule({ id: 'r3', name: 'Disabled', match: { sender: 'carol@example.com' }, action: { type: 'skip' }, enabled: false, order: 3 }),
    makeRule({ id: 'r4', name: 'Narrowed', match: { sender: 'dave@example.com', subject: '*invoice*' }, action: { type: 'skip' }, enabled: true, order: 4 }),
  ];

  it('returns matching rule when sender and action type match', () => {
    const result = findSenderRule('alice@example.com', 'skip', rules);
    expect(result).toBeDefined();
    expect(result!.id).toBe('r1');
  });

  it('returns undefined when no rule matches sender', () => {
    const result = findSenderRule('unknown@example.com', 'skip', rules);
    expect(result).toBeUndefined();
  });

  it('returns undefined when sender matches but action type differs', () => {
    const result = findSenderRule('alice@example.com', 'delete', rules);
    expect(result).toBeUndefined();
  });

  it('ignores disabled rules', () => {
    const result = findSenderRule('carol@example.com', 'skip', rules);
    expect(result).toBeUndefined();
  });

  it('ignores rules that are not sender-only (have narrowing fields)', () => {
    const result = findSenderRule('dave@example.com', 'skip', rules);
    expect(result).toBeUndefined();
  });

  it('is case-insensitive on sender comparison', () => {
    const result = findSenderRule('ALICE@EXAMPLE.COM', 'skip', rules);
    expect(result).toBeDefined();
    expect(result!.id).toBe('r1');
  });
});
