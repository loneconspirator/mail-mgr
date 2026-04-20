import type { Rule } from '../config/schema.js';

/**
 * Check if a rule matches only on sender (no narrowing fields).
 * Extracted from dispositions.ts for shared use.
 */
export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    (m.readStatus === undefined || m.readStatus === 'any')
  );
}

/**
 * Find an enabled, sender-only rule matching the given sender and action type.
 * Used by the action folder processor for conflict detection (PROC-09).
 * Uses exact case-insensitive comparison per PROC-05 (bare email addresses).
 */
export function findSenderRule(
  sender: string,
  actionType: 'skip' | 'delete',
  rules: Rule[],
): Rule | undefined {
  return rules.find(
    (r) =>
      r.enabled &&
      isSenderOnly(r) &&
      r.action.type === actionType &&
      r.match.sender?.toLowerCase() === sender.toLowerCase(),
  );
}
