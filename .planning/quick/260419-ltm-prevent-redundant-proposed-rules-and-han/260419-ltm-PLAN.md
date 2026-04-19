---
phase: quick
plan: 260419-ltm
type: execute
wave: 1
depends_on: []
files_modified:
  - src/rules/conflict-checker.ts
  - src/web/routes/proposed-rules.ts
  - src/web/frontend/app.ts
  - src/shared/types.ts
  - test/unit/rules/conflict-checker.test.ts
  - test/unit/web/proposed-rules.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Approving a proposal whose sender+deliveredTo match an existing rule returns an error with the conflicting rule details"
    - "Approving a proposal that would be shadowed by a higher-priority existing rule returns an error with the shadowing rule details"
    - "The proposal card displays the conflicting/shadowing rule info when approve fails"
    - "User can still Modify or Dismiss proposals that have conflicts"
    - "Shadowed proposals offer to insert ahead of the conflicting rule in priority order"
  artifacts:
    - path: "src/rules/conflict-checker.ts"
      provides: "Conflict detection logic: exact match + shadow detection"
    - path: "src/web/routes/proposed-rules.ts"
      provides: "Approve endpoint checks for conflicts before creating rule"
    - path: "src/web/frontend/app.ts"
      provides: "UI shows conflict info and offers reorder option"
    - path: "test/unit/rules/conflict-checker.test.ts"
      provides: "Unit tests for conflict detection"
  key_links:
    - from: "src/web/routes/proposed-rules.ts"
      to: "src/rules/conflict-checker.ts"
      via: "import checkProposalConflict"
      pattern: "checkProposalConflict"
    - from: "src/web/frontend/app.ts"
      to: "/api/proposed-rules/:id/approve"
      via: "fetch response handling"
      pattern: "conflictType.*exact|shadow"
---

<objective>
Prevent redundant proposed rules and handle rule ordering conflicts.

Purpose: When approving a proposed rule, detect two conflict scenarios: (1) an existing rule already matches the same criteria (exact match — would create a duplicate), and (2) an existing higher-priority rule already catches those messages (shadow — new rule would never fire). In both cases, block straight approval and show the user which existing rule causes the conflict, with an option to reorder (for shadows) or modify (for exact matches).

Output: Conflict detection module, updated approve endpoint, updated frontend card UI with conflict handling.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/rules/matcher.ts
@src/rules/evaluator.ts
@src/config/repository.ts
@src/config/schema.ts
@src/web/routes/proposed-rules.ts
@src/web/frontend/app.ts
@src/web/frontend/api.ts
@src/shared/types.ts
@test/unit/web/proposed-rules.test.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/config/schema.ts:
```typescript
export const emailMatchSchema = z.object({
  sender: z.string().optional(),
  recipient: z.string().optional(),
  subject: z.string().optional(),
  deliveredTo: z.string().optional(),
  visibility: visibilityMatchEnum.optional(),
  readStatus: readStatusMatchEnum.optional(),
});

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  match: emailMatchSchema,
  action: actionSchema,
  enabled: z.boolean().default(true),
  order: z.number().int().min(0),
});

export type Rule = z.infer<typeof ruleSchema>;
export type EmailMatch = z.infer<typeof emailMatchSchema>;
```

From src/config/repository.ts:
```typescript
export class ConfigRepository {
  getRules(): Rule[]  // sorted by order ascending
  nextOrder(): number
  addRule(input: Omit<Rule, 'id'>): Rule
  reorderRules(pairs: Array<{ id: string; order: number }>): Rule[]
}
```

From src/shared/types.ts:
```typescript
export interface ProposedRule {
  id: number;
  sender: string;
  envelopeRecipient: string | null;
  sourceFolder: string;
  destinationFolder: string;
  // ... other fields
}
```

From src/web/frontend/api.ts:
```typescript
export const api = {
  rules: {
    reorder: (items: { id: string; order: number }[]) => request<Rule[]>('/api/rules/reorder', ...),
  },
  proposed: {
    approve: (id: number) => request<Rule>(`/api/proposed-rules/${id}/approve`, { method: 'POST' }),
  },
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create conflict detection module and update approve endpoint</name>
  <files>src/rules/conflict-checker.ts, src/web/routes/proposed-rules.ts, src/shared/types.ts, test/unit/rules/conflict-checker.test.ts, test/unit/web/proposed-rules.test.ts</files>
  <behavior>
    - Test: exact match — proposal with sender "foo@bar.com" and no deliveredTo, existing rule has match.sender "foo@bar.com" and no other match fields → returns { type: 'exact', rule: existingRule }
    - Test: exact match with deliveredTo — proposal has sender + envelopeRecipient, existing rule has same sender + deliveredTo → returns exact
    - Test: no conflict — proposal sender "foo@bar.com", no existing rules with that sender → returns null
    - Test: shadow — existing rule has match.sender "foo@bar.com" at order 0, proposed rule would get order 5 with same sender → returns { type: 'shadow', rule: existingRule } (higher-priority rule catches all same messages)
    - Test: shadow with broader existing rule — existing rule has match.sender "*@bar.com" at lower order, proposal has sender "foo@bar.com" → returns shadow (glob catches proposal's sender)
    - Test: not shadowed when existing rule has MORE restrictive match (extra fields like subject) — returns null because existing rule is narrower
    - Test: disabled rules are ignored in conflict checking
    - Test: approve endpoint returns 409 with conflict details when exact match found
    - Test: approve endpoint returns 409 with conflict details when shadow found
    - Test: approve endpoint with query param ?insertBefore=ruleId reorders and approves (shadow override)
  </behavior>
  <action>
    1. Create `src/rules/conflict-checker.ts` with a `checkProposalConflict` function:
       - Input: `proposal: { sender: string; envelopeRecipient: string | null }`, `rules: Rule[]`
       - Returns: `ProposalConflict | null` where `ProposalConflict = { type: 'exact' | 'shadow'; rule: Rule }`
       - **Exact match detection:** Find any enabled rule where `rule.match.sender` equals `proposal.sender` (case-insensitive) AND `rule.match.deliveredTo` equals `proposal.envelopeRecipient` (or both absent), AND the rule has NO other match fields set (recipient, subject, visibility, readStatus). If the existing rule has additional match fields beyond sender/deliveredTo, it's narrower than the proposal and NOT an exact match.
       - **Shadow detection:** If no exact match, check if any enabled rule would catch all messages matching the proposal. A rule shadows the proposal when: the rule's sender glob (via picomatch.isMatch) matches the proposal's sender, AND the rule has no additional narrowing match fields (or only deliveredTo that also matches). Use picomatch with `{ nocase: true }` for glob matching. Only consider rules that would be evaluated before the proposed rule (i.e., rules with order less than what nextOrder() would assign — but since we check ALL existing rules, any existing enabled rule is by definition already in the evaluation chain).
       - Import picomatch (already a project dependency).

    2. Add `ProposalConflict` type to `src/shared/types.ts`:
       ```typescript
       export interface ProposalConflict {
         type: 'exact' | 'shadow';
         rule: { id: string; name?: string; match: Record<string, string | undefined>; order: number; action: { type: string; folder?: string } };
       }
       ```

    3. Update the `POST /api/proposed-rules/:id/approve` route in `src/web/routes/proposed-rules.ts`:
       - Before creating the rule, call `checkProposalConflict(proposal, deps.configRepo.getRules())`
       - If conflict found AND no `?insertBefore` query param: return 409 with `{ error: '...', conflict: { type, rule } }`
       - If conflict type is 'shadow' AND `?insertBefore=<ruleId>` query param present: reorder so the new rule gets `conflictingRule.order - 1` (bump the conflicting rule and all rules at/above that order up by 1 using `deps.configRepo.reorderRules`), then proceed with approval at the freed-up order slot.
       - If conflict type is 'exact' AND `?insertBefore` present: still return 409 — exact matches cannot be overridden by reordering, user must Modify.

    4. Write tests in `test/unit/rules/conflict-checker.test.ts` for the conflict detection function.

    5. Add tests to `test/unit/web/proposed-rules.test.ts` for the 409 responses and insertBefore behavior. The test's mock `deps` already has `configRepo` — add a `getRules` mock that returns test rules, and a `reorderRules` mock.
  </action>
  <verify>
    <automated>cd /Users/mike/git/mail-mgr && npx vitest run test/unit/rules/conflict-checker.test.ts test/unit/web/proposed-rules.test.ts</automated>
  </verify>
  <done>
    - checkProposalConflict correctly identifies exact matches and shadows
    - Approve endpoint returns 409 with conflict details for both conflict types
    - insertBefore query param allows shadow override with reordering
    - All existing proposed-rules tests still pass
  </done>
</task>

<task type="auto">
  <name>Task 2: Update frontend to handle conflicts and offer reorder option</name>
  <files>src/web/frontend/app.ts, src/web/frontend/api.ts</files>
  <action>
    1. Update `api.proposed.approve` in `src/web/frontend/api.ts` to support the insertBefore param:
       - Add new method: `approveInsertBefore: (id: number, beforeRuleId: string) => request<Rule>(\`/api/proposed-rules/${id}/approve?insertBefore=${beforeRuleId}\`, { method: 'POST' })`
       - Keep existing `approve` method unchanged.

    2. Update the approve button click handler in `renderProposalCard` in `src/web/frontend/app.ts`:
       - In the catch block, check if the error response is a 409 conflict. To do this, update the `request` function in api.ts to attach the parsed response body to the Error object: When `res.status === 409`, throw an error that includes a `conflict` property with the parsed body. Use a custom error class or attach it as `(err as any).conflict`.
       - When a conflict is caught:
         - **Exact match:** Show a notice on the card (not a toast — it needs to persist) explaining: "A rule already exists with the same criteria: [rule name or 'Rule: sender → folder']. Use Modify to change the criteria, or Dismiss this proposal." Disable the Approve button but keep Modify and Dismiss active.
         - **Shadow:** Show a notice on the card: "An existing rule '[rule name]' (priority #order) already catches these messages. This rule would never fire." Add a new button "Save Ahead" that calls `api.proposed.approveInsertBefore(p.id, conflict.rule.id)` to insert the new rule before the shadowing rule in priority order. Keep Modify and Dismiss active.
       - Style the conflict notice with class `proposal-conflict-notice` — add a yellow/amber background, padding, and the conflicting rule's details (name, match criteria, action).

    3. Add CSS for `.proposal-conflict-notice` to the existing styles in the frontend (find the style block in app.ts or the HTML template file).
  </action>
  <verify>
    <automated>cd /Users/mike/git/mail-mgr && npx vitest run && npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>
    - Approve button on a proposal with an exact-match conflict shows persistent notice with conflicting rule details, Approve disabled, Modify/Dismiss still work
    - Approve button on a shadowed proposal shows notice with shadowing rule details and a "Save Ahead" button
    - "Save Ahead" successfully creates the rule ahead of the shadowing rule
    - All tests pass, build succeeds with no TypeScript errors
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> API | Query param `insertBefore` is untrusted user input |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-01 | T (Tampering) | insertBefore param | mitigate | Validate insertBefore is an existing rule ID via getRules() lookup before reordering |
| T-quick-02 | D (DoS) | reorder on approve | accept | Reorder is a lightweight in-memory operation on a small rule set; no risk |
</threat_model>

<verification>
1. `npx vitest run` — all tests pass including new conflict-checker tests
2. `npm run build` — no TypeScript errors
3. Manual: Start dev env, create a rule for sender "test@example.com", then try to approve a proposal with same sender — should see conflict notice
</verification>

<success_criteria>
- Approving a proposal that duplicates an existing rule's criteria shows an inline conflict notice and disables Approve
- Approving a proposal shadowed by a higher-priority rule shows a notice with "Save Ahead" option
- "Save Ahead" inserts the new rule ahead of the shadowing rule and succeeds
- Modify and Dismiss remain functional for conflicted proposals
- All existing tests pass, no regressions
</success_criteria>

<output>
After completion, create `.planning/quick/260419-ltm-prevent-redundant-proposed-rules-and-han/260419-ltm-SUMMARY.md`
</output>
