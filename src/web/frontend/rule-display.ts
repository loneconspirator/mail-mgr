import type { EmailMatch } from '../../shared/types.js';

/** Generate a human-readable description of a rule's match conditions. */
export function generateBehaviorDescription(match: EmailMatch): string {
  const parts: string[] = [];
  if (match.sender) parts.push(`sender: ${match.sender}`);
  if (match.recipient) parts.push(`to: ${match.recipient}`);
  if (match.subject) parts.push(`subject: ${match.subject}`);
  if (match.deliveredTo) parts.push(`delivered-to: ${match.deliveredTo}`);
  if (match.visibility) parts.push(`field: ${match.visibility}`);
  if (match.readStatus) parts.push(`status: ${match.readStatus}`);
  return parts.join(', ');
}
