import picomatch from 'picomatch';
import type { Rule } from '../config/index.js';
import type { EmailMessage } from '../imap/index.js';

/**
 * Test whether a single rule matches a message.
 * All specified match fields must match (AND logic).
 * Recipient checks both to and cc.
 * All comparisons are case-insensitive.
 */
export function matchRule(rule: Rule, message: EmailMessage): boolean {
  const { match } = rule;

  if (match.sender !== undefined) {
    if (!picomatch.isMatch(message.from.address, match.sender, { nocase: true })) {
      return false;
    }
  }

  if (match.recipient !== undefined) {
    const allRecipients = [...message.to, ...message.cc];
    const recipientMatched = allRecipients.some(
      (addr) => picomatch.isMatch(addr.address, match.recipient!, { nocase: true }),
    );
    if (!recipientMatched) {
      return false;
    }
  }

  if (match.subject !== undefined) {
    if (!picomatch.isMatch(message.subject, match.subject, { nocase: true })) {
      return false;
    }
  }

  return true;
}
