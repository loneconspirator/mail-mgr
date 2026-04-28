import picomatch from 'picomatch';
import type { Rule } from '../config/index.js';
import type { EmailMessage } from '../imap/index.js';

/**
 * MOD-0005 RuleMatcher — interface schema.
 * Spec: specs/modules/mod-0005-rule-matcher.md
 *
 * Test whether a single rule matches a message.
 * All specified match fields must match (AND logic).
 * Fields: sender, recipient (To+CC), subject, deliveredTo (envelope),
 * visibility (direct/cc/bcc/list), readStatus (read/unread/any).
 * All glob comparisons are case-insensitive.
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

  // deliveredTo: envelope recipient glob match
  if (match.deliveredTo !== undefined) {
    if (!message.envelopeRecipient) return false;
    const recipient = message.envelopeRecipient.replace(/^<|>$/g, '');
    if (!picomatch.isMatch(recipient, match.deliveredTo, { nocase: true })) {
      return false;
    }
  }

  // visibility: exact enum equality
  if (match.visibility !== undefined) {
    if (message.visibility !== match.visibility) {
      return false;
    }
  }

  // readStatus: check \Seen flag ('any' is pass-through)
  if (match.readStatus !== undefined && match.readStatus !== 'any') {
    const isRead = message.flags.has('\\Seen');
    if (match.readStatus === 'read' && !isRead) return false;
    if (match.readStatus === 'unread' && isRead) return false;
  }

  return true;
}
