import { parseHeaderLines } from '../imap/messages.js';

/** Lowercase header name for sentinel detection. Matches parseHeaderLines() output. */
export const SENTINEL_HEADER = 'x-mail-mgr-sentinel';

/**
 * Check whether a message is a sentinel by looking for the
 * X-Mail-Mgr-Sentinel header in its parsed header map.
 * Per D-02: header-based detection only, not Message-ID validation.
 * Per D-05: accepts the headers Map each processor already has.
 */
export function isSentinel(headers: Map<string, string> | undefined): boolean {
  if (!headers) return false;
  return headers.has(SENTINEL_HEADER);
}

/**
 * Check whether raw IMAP headers Buffer contains the sentinel header.
 * Use in processors that have raw Buffer but no parsed Map (e.g., move tracker).
 */
export function isSentinelRaw(headersBuffer: Buffer | undefined): boolean {
  if (!headersBuffer) return false;
  const parsed = parseHeaderLines(headersBuffer);
  return parsed.has(SENTINEL_HEADER);
}
