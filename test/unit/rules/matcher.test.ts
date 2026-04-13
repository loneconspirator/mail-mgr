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

  describe('deliveredTo matching', () => {
    it('matches envelopeRecipient with glob pattern', () => {
      const rule = makeRule({ deliveredTo: '*@example.com' });
      const msg = makeMessage({ envelopeRecipient: 'user@example.com' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches envelopeRecipient with +tag variant', () => {
      const rule = makeRule({ deliveredTo: 'mike+*@example.com' });
      const msg = makeMessage({ envelopeRecipient: 'mike+news@example.com' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('does not match when envelopeRecipient differs', () => {
      const rule = makeRule({ deliveredTo: '*@example.com' });
      const msg = makeMessage({ envelopeRecipient: 'user@other.com' });
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches case-insensitively', () => {
      const rule = makeRule({ deliveredTo: '*@EXAMPLE.COM' });
      const msg = makeMessage({ envelopeRecipient: 'user@example.com' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('returns false when envelopeRecipient is undefined', () => {
      const rule = makeRule({ deliveredTo: '*@example.com' });
      const msg = makeMessage();
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches envelopeRecipient with angle brackets', () => {
      const rule = makeRule({ deliveredTo: '*@example.com' });
      const msg = makeMessage({ envelopeRecipient: '<user@example.com>' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches any envelopeRecipient when deliveredTo not specified', () => {
      const rule = makeRule({ sender: 'alice@example.com' });
      const msg = makeMessage({ envelopeRecipient: 'anything@anywhere.com' });
      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('visibility matching', () => {
    it('matches direct visibility', () => {
      const rule = makeRule({ visibility: 'direct' });
      const msg = makeMessage({ visibility: 'direct' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches cc visibility', () => {
      const rule = makeRule({ visibility: 'cc' });
      const msg = makeMessage({ visibility: 'cc' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches bcc visibility', () => {
      const rule = makeRule({ visibility: 'bcc' });
      const msg = makeMessage({ visibility: 'bcc' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches list visibility', () => {
      const rule = makeRule({ visibility: 'list' });
      const msg = makeMessage({ visibility: 'list' });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('does not match when visibility differs', () => {
      const rule = makeRule({ visibility: 'direct' });
      const msg = makeMessage({ visibility: 'list' });
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('returns false when message visibility is undefined', () => {
      const rule = makeRule({ visibility: 'direct' });
      const msg = makeMessage();
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('matches any message when visibility not specified', () => {
      const rule = makeRule({ sender: 'alice@example.com' });
      const msg = makeMessage({ visibility: 'list' });
      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('readStatus matching', () => {
    it('readStatus read matches message with \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'read' });
      const msg = makeMessage({ flags: new Set(['\\Seen']) });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('readStatus read does not match message without \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'read' });
      const msg = makeMessage({ flags: new Set() });
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('readStatus unread matches message without \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'unread' });
      const msg = makeMessage({ flags: new Set() });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('readStatus unread does not match message with \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'unread' });
      const msg = makeMessage({ flags: new Set(['\\Seen']) });
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('readStatus any matches message with \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'any' });
      const msg = makeMessage({ flags: new Set(['\\Seen']) });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('readStatus any matches message without \\Seen flag', () => {
      const rule = makeRule({ readStatus: 'any' });
      const msg = makeMessage({ flags: new Set() });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('matches any message when readStatus not specified', () => {
      const rule = makeRule({ sender: 'alice@example.com' });
      const msg = makeMessage({ flags: new Set(['\\Seen']) });
      expect(matchRule(rule, msg)).toBe(true);
    });
  });

  describe('multi-field AND logic with new fields', () => {
    it('sender + deliveredTo both match', () => {
      const rule = makeRule({ sender: '*@github.com', deliveredTo: '*@example.com' });
      const msg = makeMessage({
        from: { name: 'GH', address: 'noreply@github.com' },
        envelopeRecipient: 'mike@example.com',
      });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('sender matches but deliveredTo does not', () => {
      const rule = makeRule({ sender: '*@github.com', deliveredTo: '*@example.com' });
      const msg = makeMessage({
        from: { name: 'GH', address: 'noreply@github.com' },
        envelopeRecipient: 'mike@other.com',
      });
      expect(matchRule(rule, msg)).toBe(false);
    });

    it('sender + visibility + readStatus all match', () => {
      const rule = makeRule({ sender: '*@github.com', visibility: 'direct', readStatus: 'unread' });
      const msg = makeMessage({
        from: { name: 'GH', address: 'noreply@github.com' },
        visibility: 'direct',
        flags: new Set(),
      });
      expect(matchRule(rule, msg)).toBe(true);
    });

    it('all six fields set and all match', () => {
      const rule = makeRule({
        sender: '*@github.com',
        recipient: 'mike@example.com',
        subject: '*PR*',
        deliveredTo: '*@example.com',
        visibility: 'direct',
        readStatus: 'read',
      });
      const msg = makeMessage({
        from: { name: 'GH', address: 'noreply@github.com' },
        to: [{ name: 'Mike', address: 'mike@example.com' }],
        subject: 'New PR #42',
        envelopeRecipient: 'mike@example.com',
        visibility: 'direct',
        flags: new Set(['\\Seen']),
      });
      expect(matchRule(rule, msg)).toBe(true);
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
