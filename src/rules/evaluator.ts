/**
 * MOD-0004 — RuleEvaluator
 * See specs/modules/mod-0004-rule-evaluator.md for the spec of record.
 */
import type { Rule } from '../config/index.js';
import type { EmailMessage } from '../imap/index.js';
import { matchRule } from './matcher.js';

/**
 * Check whether a rule references match fields that require envelope data.
 * NOTE: `replyTo` is intentionally NOT included here — Reply-To is read from
 * the per-message headers map populated by the IMAP layer, not from the
 * envelope. A replyTo-only rule is fully evaluable even when envelope discovery
 * has not run.
 */
function needsEnvelopeData(rule: Rule): boolean {
  return rule.match.deliveredTo !== undefined || rule.match.visibility !== undefined;
}

/**
 * Evaluate an array of rules against a message.
 * Rules are sorted by `order`, filtered to enabled only,
 * and the first match wins.
 * Rules referencing deliveredTo or visibility are skipped when
 * the message lacks envelope data (D-08). readStatus and replyTo are
 * never skipped (D-09; replyTo lives in headers, not envelope).
 * Returns the matching rule, or null if nothing matches.
 */
export function evaluateRules(rules: Rule[], message: EmailMessage): Rule | null {
  const candidates = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  const envelopeAvailable = message.envelopeRecipient !== undefined;

  for (const rule of candidates) {
    if (!envelopeAvailable && needsEnvelopeData(rule)) continue;
    if (matchRule(rule, message)) return rule;
  }

  return null;
}
