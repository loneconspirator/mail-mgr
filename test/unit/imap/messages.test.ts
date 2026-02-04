import { describe, it, expect } from 'vitest';
import { parseMessage, type ImapFetchResult } from '../../../src/imap/index.js';

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
