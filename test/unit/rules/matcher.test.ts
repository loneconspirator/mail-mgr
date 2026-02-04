import { describe, it, expect } from 'vitest';
import { matchRule } from '../../../src/rules/index.js';
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

function makeRule(match: Rule['match'], overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match,
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}

describe('matchRule', () => {
  describe('sender matching', () => {
    it('matches exact sender address', () => {
      const rule = makeRule({ sender: 'alice@example.com' });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches sender with glob pattern', () => {
      const rule = makeRule({ sender: '*@github.com' });
      const msg = makeMessage({
        from: { name: 'GitHub', address: 'notifications@github.com' },
      });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('does not match when sender differs', () => {
      const rule = makeRule({ sender: '*@github.com' });
      const msg = makeMessage({
        from: { name: 'Alice', address: 'alice@example.com' },
      });

      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches sender case-insensitively', () => {
      const rule = makeRule({ sender: '*@GitHub.COM' });
      const msg = makeMessage({
        from: { name: 'GH', address: 'noreply@github.com' },
      });

      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('recipient matching', () => {
    it('matches recipient in to field', () => {
      const rule = makeRule({ recipient: 'bob@example.com' });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches recipient in cc field', () => {
      const rule = makeRule({ recipient: 'carol@example.com' });
      const msg = makeMessage({
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [{ name: 'Carol', address: 'carol@example.com' }],
      });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches recipient glob across to and cc', () => {
      const rule = makeRule({ recipient: 'mike+oss@example.com' });
      const msg = makeMessage({
        to: [{ name: 'Mike', address: 'mike+oss@example.com' }],
      });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('does not match when no recipient matches', () => {
      const rule = makeRule({ recipient: 'nobody@nowhere.com' });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches recipient case-insensitively', () => {
      const rule = makeRule({ recipient: 'BOB@EXAMPLE.COM' });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('subject matching', () => {
    it('matches exact subject', () => {
      const rule = makeRule({ subject: 'Hello World' });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches subject with glob', () => {
      const rule = makeRule({ subject: '*invoice*' });
      const msg = makeMessage({ subject: 'Your monthly invoice #42' });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('does not match when subject differs', () => {
      const rule = makeRule({ subject: '*invoice*' });
      const msg = makeMessage({ subject: 'Hello World' });

      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches subject case-insensitively', () => {
      const rule = makeRule({ subject: '*HELLO*' });
      const msg = makeMessage({ subject: 'hello world' });

      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('multi-field AND logic', () => {
    it('matches when all specified fields match', () => {
      const rule = makeRule({
        sender: '*@github.com',
        recipient: 'mike+oss@example.com',
        subject: '*pull request*',
      });
      const msg = makeMessage({
        from: { name: 'GH', address: 'notifications@github.com' },
        to: [{ name: 'Mike', address: 'mike+oss@example.com' }],
        subject: 'Re: [repo] pull request #99',
      });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('fails when sender matches but recipient does not', () => {
      const rule = makeRule({
        sender: '*@github.com',
        recipient: 'wrong@example.com',
      });
      const msg = makeMessage({
        from: { name: 'GH', address: 'notifications@github.com' },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
      });

      expect(matchRule(rule, msg)).toBe(false);
    });

    it('fails when subject matches but sender does not', () => {
      const rule = makeRule({
        sender: '*@github.com',
        subject: '*Hello*',
      });
      const msg = makeMessage();

      expect(matchRule(rule, msg)).toBe(false);
    });
  });

  describe('unspecified fields are wildcards', () => {
    it('matches any sender when sender is not specified', () => {
      const rule = makeRule({ subject: 'Hello World' });
      const msg = makeMessage({
        from: { name: 'Anyone', address: 'anyone@anywhere.org' },
      });

      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches any recipient when recipient is not specified', () => {
      const rule = makeRule({ sender: 'alice@example.com' });
      const msg = makeMessage({
        to: [{ name: 'Whoever', address: 'whoever@whatever.org' }],
      });

      expect(matchRule(rule, msg)).toBe(true);
    });
  });
});
