import type { Rule } from '../config/index.js';
import type { EmailMessage } from '../imap/index.js';
import { matchRule } from './matcher.js';

/**
 * Evaluate an array of rules against a message.
 * Rules are sorted by `order`, filtered to enabled only,
 * and the first match wins.
 * Returns the matching rule, or null if nothing matches.
 */
export function evaluateRules(rules: Rule[], message: EmailMessage): Rule | null {
  const candidates = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  for (const rule of candidates) {
    if (matchRule(rule, message)) {
      return rule;
    }
  }

  return null;
}
