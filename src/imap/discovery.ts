import type { ImapClient } from './client.js';
import { parseHeaderLines } from './messages.js';
import pino from 'pino';

const logger = pino({ name: 'mail-mgr:discovery' });

/** Candidate headers to probe, in order per D-02 */
export const CANDIDATE_HEADERS = [
  'Delivered-To',
  'X-Delivered-To',
  'X-Original-To',
  'X-Resolved-To',
  'Envelope-To',
] as const;

const MIN_CONSENSUS = 3;

/**
 * Probe the 10 most recent INBOX messages for envelope recipient headers.
 * Returns the header name with the highest count above threshold, or null.
 */
export async function probeEnvelopeHeaders(client: ImapClient): Promise<string | null> {
  const results = await client.withMailboxLock('INBOX', async (flow) => {
    // Fetch only the last 10 messages by sequence number to avoid
    // pulling the entire mailbox over the wire (WR-02).
    const status = await flow.status('INBOX', { messages: true });
    const count = status.messages ?? 0;
    if (count === 0) return [];
    const start = Math.max(1, count - 9);
    const msgs: Array<{ headers?: Buffer }> = [];
    for await (const msg of flow.fetch(`${start}:*`, {
      uid: true,
      headers: [...CANDIDATE_HEADERS],
    }, { uid: true })) {
      msgs.push(msg as { headers?: Buffer });
    }
    return msgs;
  });

  if (results.length === 0) {
    logger.info('discovery: no messages found in INBOX');
    return null;
  }

  logger.info({ messageCount: results.length }, 'discovery: probing %d messages', results.length);

  const counts = new Map<string, number>();
  for (const raw of results) {
    const parsed = parseHeaderLines(raw.headers as Buffer | undefined);
    for (const candidate of CANDIDATE_HEADERS) {
      const value = parsed.get(candidate.toLowerCase());
      if (value && value.includes('@')) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
  }

  let bestHeader: string | null = null;
  let bestCount = 0;
  for (const [header, count] of counts) {
    if (count >= MIN_CONSENSUS && count > bestCount) {
      bestHeader = header;
      bestCount = count;
    }
  }

  if (bestHeader) {
    logger.info({ header: bestHeader, count: bestCount }, 'discovery: found envelope header');
  } else {
    logger.info({ counts: Object.fromEntries(counts) }, 'discovery: no header reached consensus threshold of %d', MIN_CONSENSUS);
  }

  return bestHeader;
}
