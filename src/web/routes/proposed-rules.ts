import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { ProposedRule, ProposedRuleCard, ExampleMessage } from '../../shared/types.js';
import { checkProposalConflict } from '../../rules/conflict-checker.js';

function strengthLabel(proposal: ProposedRule): string {
  const strength = proposal.strength;
  if (strength <= 0) return 'Ambiguous \u2014 conflicting destinations';
  if (strength === 1) return 'Weak (1 move)';
  if (strength <= 4) return `Moderate pattern (${proposal.matchingCount} moves)`;
  return `Strong pattern (${proposal.matchingCount} moves)`;
}

function conflictAnnotation(proposal: ProposedRule): string | null {
  if (proposal.contradictingCount === 0) return null;
  const others = Object.entries(proposal.destinationCounts)
    .filter(([folder]) => folder !== proposal.destinationFolder)
    .map(([folder, count]) => `${folder} (${count})`)
    .join(', ');
  return others ? `Also moved to: ${others}` : null;
}

function resurfacedNotice(proposal: ProposedRule): string | null {
  if (proposal.status === 'active' && proposal.signalsSinceDismiss > 0) {
    return `Previously dismissed \u2014 ${proposal.signalsSinceDismiss} new moves since then.`;
  }
  return null;
}

function toCard(proposal: ProposedRule, examples: ExampleMessage[]): ProposedRuleCard {
  return {
    ...proposal,
    strengthLabel: strengthLabel(proposal),
    examples,
    conflictAnnotation: conflictAnnotation(proposal),
    resurfacedNotice: resurfacedNotice(proposal),
  };
}

export function registerProposedRuleRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // GET /api/proposed-rules - list all proposals with cards
  app.get('/api/proposed-rules', async () => {
    const store = deps.getProposalStore();
    const proposals = store.getProposals();
    return proposals.map(p => {
      const examples = store.getExampleSubjects(p.sender, p.envelopeRecipient, p.sourceFolder, 3);
      return toCard(p, examples);
    });
  });

  // POST /api/proposed-rules/:id/approve - create real rule from proposal
  app.post<{ Params: { id: string }; Querystring: { insertBefore?: string } }>('/api/proposed-rules/:id/approve', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid proposal ID' });

    const store = deps.getProposalStore();
    const proposal = store.getById(id);
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });

    // Check for conflicts with existing rules
    const existingRules = deps.configRepo.getRules();
    const conflict = checkProposalConflict(
      { sender: proposal.sender, envelopeRecipient: proposal.envelopeRecipient },
      existingRules,
    );

    const insertBefore = (request.query as { insertBefore?: string }).insertBefore;

    if (conflict) {
      // Exact matches cannot be overridden by reordering
      if (conflict.type === 'exact') {
        return reply.status(409).send({
          error: 'A rule with the same criteria already exists',
          conflict,
        });
      }

      // Shadow conflicts: block unless insertBefore is provided
      if (conflict.type === 'shadow' && !insertBefore) {
        return reply.status(409).send({
          error: 'An existing rule already catches these messages',
          conflict,
        });
      }

      // Shadow override: insertBefore provided — validate and reorder
      if (conflict.type === 'shadow' && insertBefore) {
        // T-quick-01: Validate insertBefore is an existing rule ID
        const targetRule = existingRules.find((r) => r.id === insertBefore);
        if (!targetRule) {
          return reply.status(400).send({ error: 'insertBefore rule not found' });
        }

        // Bump conflicting rule and everything at/above its order up by 1
        const reorderPairs = existingRules
          .filter((r) => r.order >= targetRule.order)
          .map((r) => ({ id: r.id, order: r.order + 1 }));
        deps.configRepo.reorderRules(reorderPairs);

        // Create the new rule at the freed-up order slot
        const match: Record<string, string> = { sender: proposal.sender };
        if (proposal.envelopeRecipient) match.deliveredTo = proposal.envelopeRecipient;

        const newRule = deps.configRepo.addRule({
          name: `Auto: ${proposal.sender}`,
          match,
          action: { type: 'move', folder: proposal.destinationFolder },
          enabled: true,
          order: targetRule.order,
        });

        store.approveProposal(id, newRule.id);
        return newRule;
      }
    }

    // No conflict — proceed normally
    const match: Record<string, string> = { sender: proposal.sender };
    if (proposal.envelopeRecipient) match.deliveredTo = proposal.envelopeRecipient;

    const newRule = deps.configRepo.addRule({
      name: `Auto: ${proposal.sender}`,
      match,
      action: { type: 'move', folder: proposal.destinationFolder },
      enabled: true,
      order: deps.configRepo.nextOrder(),
    });

    store.approveProposal(id, newRule.id);
    return newRule;
  });

  // POST /api/proposed-rules/:id/mark-approved - mark proposal approved without creating a rule
  // Used by the Modify flow: the rule editor (openRuleModal) creates the rule via api.rules.create(),
  // then the frontend calls this endpoint to update the proposal status only.
  app.post<{ Params: { id: string }; Body: { ruleId: string } }>('/api/proposed-rules/:id/mark-approved', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid proposal ID' });

    const store = deps.getProposalStore();
    const proposal = store.getById(id);
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });

    const body = request.body as { ruleId?: string } | null;
    const ruleId = body?.ruleId;
    if (!ruleId || typeof ruleId !== 'string') {
      return reply.status(400).send({ error: 'ruleId is required' });
    }

    store.approveProposal(id, ruleId);
    return reply.status(204).send();
  });

  // POST /api/proposed-rules/:id/dismiss - dismiss proposal
  app.post<{ Params: { id: string } }>('/api/proposed-rules/:id/dismiss', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid proposal ID' });

    const store = deps.getProposalStore();
    const proposal = store.getById(id);
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });

    store.dismissProposal(id);
    return reply.status(204).send();
  });

  // POST /api/proposed-rules/:id/modify - get pre-fill data for rule editor
  app.post<{ Params: { id: string } }>('/api/proposed-rules/:id/modify', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid proposal ID' });

    const store = deps.getProposalStore();
    const proposal = store.getById(id);
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' });

    return {
      proposalId: proposal.id,
      sender: proposal.sender,
      envelopeRecipient: proposal.envelopeRecipient,
      destinationFolder: proposal.destinationFolder,
      sourceFolder: proposal.sourceFolder,
    };
  });
}
