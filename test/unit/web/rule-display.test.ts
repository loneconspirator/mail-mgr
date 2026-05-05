import { describe, it, expect } from 'vitest';
import { generateBehaviorDescription } from '../../../src/web/frontend/rule-display.js';

describe('generateBehaviorDescription', () => {
  it('returns sender label for sender-only match', () => {
    expect(generateBehaviorDescription({ sender: '*@example.com' })).toBe('sender: *@example.com');
  });

  it('returns subject label for subject-only match', () => {
    expect(generateBehaviorDescription({ subject: '*newsletter*' })).toBe('subject: *newsletter*');
  });

  it('returns delivered-to label for deliveredTo match', () => {
    expect(generateBehaviorDescription({ deliveredTo: '*@work.com' })).toBe('delivered-to: *@work.com');
  });

  it('returns field label for visibility match', () => {
    expect(generateBehaviorDescription({ visibility: 'direct' })).toBe('field: direct');
  });

  it('returns status label for readStatus match', () => {
    expect(generateBehaviorDescription({ readStatus: 'unread' })).toBe('status: unread');
  });

  it('returns to label for recipient match', () => {
    expect(generateBehaviorDescription({ recipient: 'user@example.com' })).toBe('to: user@example.com');
  });

  it('joins multiple fields with comma-space', () => {
    expect(generateBehaviorDescription({ sender: '*@ex.com', subject: '*news*', readStatus: 'read' }))
      .toBe('sender: *@ex.com, subject: *news*, status: read');
  });

  it('returns empty string for empty match', () => {
    expect(generateBehaviorDescription({})).toBe('');
  });

  it('outputs fields in canonical order: sender, to, subject, delivered-to, reply-to, field, status', () => {
    const match = {
      readStatus: 'unread',
      visibility: 'cc',
      replyTo: '*@bulk.io',
      deliveredTo: '*@work.com',
      subject: '*test*',
      recipient: 'a@b.com',
      sender: '*@ex.com',
    };
    expect(generateBehaviorDescription(match))
      .toBe('sender: *@ex.com, to: a@b.com, subject: *test*, delivered-to: *@work.com, reply-to: *@bulk.io, field: cc, status: unread');
  });

  it('returns reply-to label for replyTo-only match', () => {
    expect(generateBehaviorDescription({ replyTo: '*@bulk.io' })).toBe('reply-to: *@bulk.io');
  });

  it('combines sender + reply-to in correct order', () => {
    expect(generateBehaviorDescription({ sender: 'a@b.com', replyTo: '*@bulk.io' }))
      .toBe('sender: a@b.com, reply-to: *@bulk.io');
  });

  it('combines delivered-to + reply-to in correct order (reply-to immediately after delivered-to)', () => {
    expect(generateBehaviorDescription({ deliveredTo: '*@work.com', replyTo: '*@bulk.io' }))
      .toBe('delivered-to: *@work.com, reply-to: *@bulk.io');
  });
});
