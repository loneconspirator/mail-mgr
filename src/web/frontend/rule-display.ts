import type { Rule } from '../../shared/types.js';

/** Format a rule's action for display. */
export function formatRuleAction(action: Rule['action']): string {
  switch (action.type) {
    case 'move': return `\u2192 ${'folder' in action ? action.folder : ''}`;
    case 'review': return 'folder' in action && action.folder ? `\u2192 Review \u2192 ${action.folder}` : '\u2192 Review';
    case 'skip': return '\u2014 Inbox';
    case 'delete': return '\u2715 Delete';
    default: return (action as Record<string, string>).type;
  }
}

/** Generate a behavior description for a rule showing populated match fields and action. */
export function generateBehaviorDescription(rule: Rule): string {
  const parts: string[] = [];
  if (rule.match.sender) parts.push(`sender:${rule.match.sender}`);
  if (rule.match.recipient) parts.push(`recipient:${rule.match.recipient}`);
  if (rule.match.subject) parts.push(`subject:${rule.match.subject}`);
  const matchStr = parts.join(', ');
  const dest = formatRuleAction(rule.action);
  return matchStr ? `${matchStr} ${dest}` : dest;
}
