import picomatch from 'picomatch';
import type { Rule } from '../config/schema.js';
import type { ProposalConflict } from '../shared/types.js';

interface ProposalInput {
  sender: string;
  envelopeRecipient: string | null;
}

/**
 * Match fields that narrow a rule beyond sender/deliveredTo.
 * If a rule has any of these set, it's more restrictive than a bare
 * sender(+deliveredTo) proposal.
 */
const NARROWING_FIELDS = ['recipient', 'subject', 'visibility', 'readStatus'] as const;

function hasNarrowingFields(match: Rule['match']): boolean {
  return NARROWING_FIELDS.some((f) => match[f] !== undefined);
}

function senderMatches(ruleSender: string, proposalSender: string): boolean {
  return ruleSender.toLowerCase() === proposalSender.toLowerCase();
}

function deliveredToMatches(
  ruleDeliveredTo: string | undefined,
  proposalRecipient: string | null,
): boolean {
  // Both absent => match
  if (!ruleDeliveredTo && !proposalRecipient) return true;
  // One absent, other present => no match
  if (!ruleDeliveredTo || !proposalRecipient) return false;
  return ruleDeliveredTo.toLowerCase() === proposalRecipient.toLowerCase();
}

/**
 * Check whether approving a proposal would conflict with existing rules.
 *
 * Returns:
 *  - `{ type: 'exact', rule }` if an existing rule matches the same criteria
 *  - `{ type: 'shadow', rule }` if a broader existing rule would catch the same messages
 *  - `null` if no conflict
 */
export function checkProposalConflict(
  proposal: ProposalInput,
  rules: Rule[],
): ProposalConflict | null {
  const enabledRules = rules.filter((r) => r.enabled);

  // 1. Check for exact match
  for (const rule of enabledRules) {
    if (hasNarrowingFields(rule.match)) continue;
    if (!rule.match.sender) continue;
    if (!senderMatches(rule.match.sender, proposal.sender)) continue;
    if (!deliveredToMatches(rule.match.deliveredTo, proposal.envelopeRecipient)) continue;

    return {
      type: 'exact',
      rule: {
        id: rule.id,
        name: rule.name,
        match: rule.match as Record<string, string | undefined>,
        order: rule.order,
        action: {
          type: rule.action.type,
          ...('folder' in rule.action ? { folder: rule.action.folder } : {}),
        },
      },
    };
  }

  // 2. Check for shadow (broader glob catches proposal's sender)
  for (const rule of enabledRules) {
    if (hasNarrowingFields(rule.match)) continue;
    if (!rule.match.sender) continue;

    // Skip exact matches (already handled above — if we're here, exact didn't match)
    // Check if the rule's sender glob matches the proposal's sender
    if (!picomatch.isMatch(proposal.sender, rule.match.sender, { nocase: true })) continue;

    // Verify deliveredTo compatibility
    if (!deliveredToMatches(rule.match.deliveredTo, proposal.envelopeRecipient)) continue;

    return {
      type: 'shadow',
      rule: {
        id: rule.id,
        name: rule.name,
        match: rule.match as Record<string, string | undefined>,
        order: rule.order,
        action: {
          type: rule.action.type,
          ...('folder' in rule.action ? { folder: rule.action.folder } : {}),
        },
      },
    };
  }

  return null;
}
