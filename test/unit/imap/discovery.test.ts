import { describe, it, expect, vi } from 'vitest';
import type { ImapClient } from '../../../src/imap/client.js';
import { probeEnvelopeHeaders, CANDIDATE_HEADERS } from '../../../src/imap/discovery.js';

function makeHeaderBuf(headers: Record<string, string>): Buffer {
  const lines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  return Buffer.from(lines + '\r\n');
}

function makeMockClient(messages: Array<{ headers?: Buffer }>): ImapClient {
  return {
    withMailboxLock: vi.fn().mockImplementation(
      async (_folder: string, fn: (flow: unknown) => Promise<unknown>) => {
        const flow = {
          fetch: vi.fn().mockReturnValue({
            async *[Symbol.asyncIterator]() {
              for (const msg of messages) {
                yield { uid: Math.floor(Math.random() * 10000), ...msg };
              }
            },
          }),
        };
        return fn(flow);
      },
    ),
  } as unknown as ImapClient;
}

describe('probeEnvelopeHeaders', () => {
  it('returns null when client fetch returns no messages', async () => {
    const client = makeMockClient([]);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBeNull();
  });

  it('returns null when no candidate header reaches threshold of 3', async () => {
    const messages = [
      { headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) },
      { headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) },
      { headers: makeHeaderBuf({}) },
      { headers: makeHeaderBuf({}) },
      { headers: makeHeaderBuf({}) },
    ];
    const client = makeMockClient(messages);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBeNull();
  });

  it('returns Delivered-To when 5 of 10 messages have it', async () => {
    const messages: Array<{ headers?: Buffer }> = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) });
    }
    for (let i = 0; i < 5; i++) {
      messages.push({ headers: makeHeaderBuf({}) });
    }
    const client = makeMockClient(messages);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBe('Delivered-To');
  });

  it('returns the header with highest count when multiple candidates are present', async () => {
    const messages: Array<{ headers?: Buffer }> = [];
    // 4 messages with X-Original-To
    for (let i = 0; i < 4; i++) {
      messages.push({ headers: makeHeaderBuf({ 'X-Original-To': 'user@example.com' }) });
    }
    // 6 messages with Delivered-To
    for (let i = 0; i < 6; i++) {
      messages.push({ headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) });
    }
    const client = makeMockClient(messages);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBe('Delivered-To');
  });

  it('ignores header values that do not contain @', async () => {
    const messages: Array<{ headers?: Buffer }> = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ headers: makeHeaderBuf({ 'Delivered-To': 'not-an-email' }) });
    }
    const client = makeMockClient(messages);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBeNull();
  });

  it('works with fewer than 10 messages (e.g., new mailbox with 3 messages)', async () => {
    const messages = [
      { headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) },
      { headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) },
      { headers: makeHeaderBuf({ 'Delivered-To': 'user@example.com' }) },
    ];
    const client = makeMockClient(messages);
    const result = await probeEnvelopeHeaders(client);
    expect(result).toBe('Delivered-To');
  });

  it('CANDIDATE_HEADERS contains exactly the expected headers per D-02', () => {
    expect([...CANDIDATE_HEADERS]).toEqual([
      'Delivered-To',
      'X-Delivered-To',
      'X-Original-To',
      'X-Resolved-To',
      'Envelope-To',
    ]);
  });
});
