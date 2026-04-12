import { describe, it, expect } from 'vitest';
import { parseMessage, reviewMessageToEmailMessage, parseHeaderLines, classifyVisibility, type ImapFetchResult, type ReviewMessage, type Visibility } from '../../../src/imap/index.js';

function makeFetchResult(overrides: Partial<ImapFetchResult> = {}): ImapFetchResult {
  return {
    uid: 42,
    flags: new Set(['\\Seen']),
    envelope: {
      date: new Date('2025-01-15T10:30:00Z'),
      subject: 'Test Subject',
      messageId: '<abc123@example.com>',
      from: [{ name: 'Alice', address: 'alice@example.com' }],
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [{ name: 'Charlie', address: 'charlie@example.com' }],
    },
    ...overrides,
  };
}

describe('parseMessage', () => {
  it('parses a complete envelope into EmailMessage', () => {
    const result = parseMessage(makeFetchResult());

    expect(result.uid).toBe(42);
    expect(result.messageId).toBe('<abc123@example.com>');
    expect(result.subject).toBe('Test Subject');
    expect(result.date).toEqual(new Date('2025-01-15T10:30:00Z'));
    expect(result.flags).toEqual(new Set(['\\Seen']));

    expect(result.from).toEqual({ name: 'Alice', address: 'alice@example.com' });
    expect(result.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }]);
    expect(result.cc).toEqual([{ name: 'Charlie', address: 'charlie@example.com' }]);
  });

  it('handles missing subject', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        date: new Date('2025-01-15T10:30:00Z'),
        messageId: '<abc@example.com>',
        from: [{ name: 'Alice', address: 'alice@example.com' }],
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        // no subject
      },
    }));

    expect(result.subject).toBe('');
  });

  it('handles missing messageId', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'Hello',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'c@d.com' }],
        // no messageId
      },
    }));

    expect(result.messageId).toBe('');
  });

  it('handles missing date', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'Hello',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'c@d.com' }],
        // no date
      },
    }));

    expect(result.date).toEqual(new Date(0));
  });

  it('handles multiple recipients in to and cc', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'Multi',
        messageId: '<m@x.com>',
        from: [{ address: 'sender@x.com' }],
        to: [
          { name: 'R1', address: 'r1@x.com' },
          { name: 'R2', address: 'r2@x.com' },
          { name: 'R3', address: 'r3@x.com' },
        ],
        cc: [
          { name: 'CC1', address: 'cc1@x.com' },
          { name: 'CC2', address: 'cc2@x.com' },
        ],
      },
    }));

    expect(result.to).toHaveLength(3);
    expect(result.cc).toHaveLength(2);
    expect(result.to[2]).toEqual({ name: 'R3', address: 'r3@x.com' });
    expect(result.cc[1]).toEqual({ name: 'CC2', address: 'cc2@x.com' });
  });

  it('handles empty from array', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'No sender',
        from: [],
        to: [{ address: 'b@c.com' }],
      },
    }));

    expect(result.from).toEqual({ name: '', address: '' });
  });

  it('handles missing from field entirely', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'No from',
        to: [{ address: 'b@c.com' }],
        // no from at all
      },
    }));

    expect(result.from).toEqual({ name: '', address: '' });
  });

  it('handles empty to and cc', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'Solo',
        from: [{ address: 'a@b.com' }],
        to: [],
        cc: [],
      },
    }));

    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
  });

  it('handles missing to and cc entirely', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'No recipients',
        from: [{ address: 'a@b.com' }],
        // no to, no cc
      },
    }));

    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
  });

  it('handles address with name but no address field', () => {
    const result = parseMessage(makeFetchResult({
      envelope: {
        subject: 'Weird',
        from: [{ name: 'Just A Name' }],
        to: [{ name: 'Another Name' }],
      },
    }));

    expect(result.from.name).toBe('Just A Name');
    expect(result.from.address).toBe('');
    expect(result.to[0].address).toBe('');
  });

  it('handles missing flags', () => {
    const result = parseMessage({
      uid: 99,
      // no flags
      envelope: {
        subject: 'No flags',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'c@d.com' }],
      },
    });

    expect(result.flags).toEqual(new Set());
  });

  it('handles missing envelope entirely', () => {
    const result = parseMessage({
      uid: 100,
      flags: new Set(),
      // no envelope at all
    });

    expect(result.uid).toBe(100);
    expect(result.messageId).toBe('');
    expect(result.subject).toBe('');
    expect(result.from).toEqual({ name: '', address: '' });
    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
    expect(result.date).toEqual(new Date(0));
  });
});

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 100,
    flags: new Set(['\\Seen']),
    internalDate: new Date('2026-03-15T08:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Review test',
      messageId: '<review-1@example.com>',
    },
    ...overrides,
  };
}

describe('reviewMessageToEmailMessage', () => {
  it('maps envelope fields to EmailMessage', () => {
    const rm = makeReviewMessage();
    const em = reviewMessageToEmailMessage(rm);

    expect(em.uid).toBe(100);
    expect(em.messageId).toBe('<review-1@example.com>');
    expect(em.from).toEqual({ name: 'Alice', address: 'alice@example.com' });
    expect(em.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }]);
    expect(em.cc).toEqual([]);
    expect(em.subject).toBe('Review test');
    expect(em.date).toEqual(new Date('2026-03-15T08:00:00Z'));
    expect(em.flags).toEqual(new Set(['\\Seen']));
  });

  it('handles empty envelope fields', () => {
    const rm = makeReviewMessage({
      envelope: {
        from: { name: '', address: '' },
        to: [],
        cc: [],
        subject: '',
        messageId: '',
      },
    });
    const em = reviewMessageToEmailMessage(rm);

    expect(em.from).toEqual({ name: '', address: '' });
    expect(em.to).toEqual([]);
    expect(em.subject).toBe('');
    expect(em.messageId).toBe('');
  });

  it('uses internalDate for the date field', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const rm = makeReviewMessage({ internalDate: d });
    const em = reviewMessageToEmailMessage(rm);

    expect(em.date).toEqual(d);
  });

  it('passes through envelopeRecipient and visibility fields', () => {
    const rm = makeReviewMessage({
      envelopeRecipient: 'user@example.com',
      visibility: 'direct' as Visibility,
    });
    const em = reviewMessageToEmailMessage(rm);

    expect(em.envelopeRecipient).toBe('user@example.com');
    expect(em.visibility).toBe('direct');
  });

  it('leaves envelopeRecipient and visibility undefined when not set', () => {
    const rm = makeReviewMessage();
    const em = reviewMessageToEmailMessage(rm);

    expect(em.envelopeRecipient).toBeUndefined();
    expect(em.visibility).toBeUndefined();
  });
});

describe('parseHeaderLines', () => {
  it('returns empty Map for undefined input', () => {
    const result = parseHeaderLines(undefined);
    expect(result.size).toBe(0);
  });

  it('returns empty Map for empty Buffer', () => {
    const result = parseHeaderLines(Buffer.from(''));
    expect(result.size).toBe(0);
  });

  it('parses single header line', () => {
    const buf = Buffer.from('Delivered-To: user@example.com\r\n');
    const result = parseHeaderLines(buf);

    expect(result.get('delivered-to')).toBe('user@example.com');
  });

  it('handles folded headers (continuation lines)', () => {
    const buf = Buffer.from('List-Id: <very-long-list-name\r\n .example.com>\r\n');
    const result = parseHeaderLines(buf);

    expect(result.get('list-id')).toBe('<very-long-list-name .example.com>');
  });

  it('parses multiple headers from one Buffer', () => {
    const buf = Buffer.from('Delivered-To: user@example.com\r\nList-Id: <list.example.com>\r\n');
    const result = parseHeaderLines(buf);

    expect(result.get('delivered-to')).toBe('user@example.com');
    expect(result.get('list-id')).toBe('<list.example.com>');
  });
});

describe('classifyVisibility', () => {
  const toAddrs = [{ name: 'Bob', address: 'bob@example.com' }];
  const ccAddrs = [{ name: 'Charlie', address: 'charlie@example.com' }];

  it('returns undefined when envelopeRecipient is undefined', () => {
    expect(classifyVisibility(undefined, toAddrs, ccAddrs, undefined)).toBeUndefined();
  });

  it('returns list when listId is present', () => {
    expect(classifyVisibility('bob@example.com', toAddrs, ccAddrs, '<list.example.com>')).toBe('list');
  });

  it('returns direct when envelopeRecipient matches To address (case-insensitive)', () => {
    expect(classifyVisibility('BOB@EXAMPLE.COM', toAddrs, ccAddrs, undefined)).toBe('direct');
  });

  it('returns cc when envelopeRecipient matches CC address but not To', () => {
    expect(classifyVisibility('charlie@example.com', toAddrs, ccAddrs, undefined)).toBe('cc');
  });

  it('returns bcc when envelopeRecipient not in To or CC and no listId', () => {
    expect(classifyVisibility('secret@example.com', toAddrs, ccAddrs, undefined)).toBe('bcc');
  });
});

describe('parseMessage with headers', () => {
  it('populates envelopeRecipient and visibility when headers Buffer present', () => {
    const fetched: ImapFetchResult = {
      uid: 42,
      flags: new Set(['\\Seen']),
      envelope: {
        subject: 'Test',
        messageId: '<abc@example.com>',
        from: [{ name: 'Alice', address: 'alice@example.com' }],
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
      },
      headers: Buffer.from('Delivered-To: bob@example.com\r\n'),
    };

    const result = parseMessage(fetched, 'Delivered-To');

    expect(result.envelopeRecipient).toBe('bob@example.com');
    expect(result.visibility).toBe('direct');
  });

  it('sets visibility to list when List-Id header is present', () => {
    const fetched: ImapFetchResult = {
      uid: 43,
      flags: new Set(),
      envelope: {
        subject: 'List post',
        messageId: '<list@example.com>',
        from: [{ address: 'sender@example.com' }],
        to: [{ address: 'list@example.com' }],
      },
      headers: Buffer.from('Delivered-To: me@example.com\r\nList-Id: <mylist.example.com>\r\n'),
    };

    const result = parseMessage(fetched, 'Delivered-To');

    expect(result.envelopeRecipient).toBe('me@example.com');
    expect(result.visibility).toBe('list');
  });

  it('leaves envelopeRecipient and visibility undefined without headers Buffer', () => {
    const fetched: ImapFetchResult = {
      uid: 44,
      flags: new Set(),
      envelope: {
        subject: 'No headers',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'c@d.com' }],
      },
    };

    const result = parseMessage(fetched);

    expect(result.envelopeRecipient).toBeUndefined();
    expect(result.visibility).toBeUndefined();
  });

  it('leaves envelopeRecipient undefined when header value lacks @', () => {
    const fetched: ImapFetchResult = {
      uid: 45,
      flags: new Set(),
      envelope: {
        subject: 'Bad header',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'c@d.com' }],
      },
      headers: Buffer.from('Delivered-To: not-an-email\r\n'),
    };

    const result = parseMessage(fetched, 'Delivered-To');

    expect(result.envelopeRecipient).toBeUndefined();
    expect(result.visibility).toBeUndefined();
  });
});
