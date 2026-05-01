---
phase: quick-260501-ewi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/integration/ix-004-signal-logging-and-proposal-creation.test.ts
  - specs/integrations/ix-004-signal-logging-and-proposal-creation.md
autonomous: true
requirements:
  - IX-004.1
  - IX-004.2
  - IX-004.3
  - IX-004.4
  - IX-004.5
  - IX-004.6
  - IX-004.7
  - IX-004.8
must_haves:
  truths:
    - "Test file test/integration/ix-004-signal-logging-and-proposal-creation.test.ts exists and contains exactly 8 it() blocks named with prefix 'IX-004.N:'"
    - "All 8 it() blocks pass under vitest using real SQLite-backed SignalStore + ProposalStore + PatternDetector (no mocks of units under test)"
    - "Spec frontmatter integration-test field points to the new test path (no longer null)"
    - "/validate IX-004 reports verdict PASS (was WARN due to IX-INTEGRATION-TEST-UNSET + IX-NAMED-INTERACTIONS-WITHOUT-TEST)"
  artifacts:
    - path: "test/integration/ix-004-signal-logging-and-proposal-creation.test.ts"
      provides: "Eight it('IX-004.N: ...') blocks covering interactions IX-004.1 through IX-004.8"
      contains: "IX-004.1, IX-004.2, IX-004.3, IX-004.4, IX-004.5, IX-004.6, IX-004.7, IX-004.8"
    - path: "specs/integrations/ix-004-signal-logging-and-proposal-creation.md"
      provides: "Spec with integration-test frontmatter wired to the new test"
      contains: "integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts"
  key_links:
    - from: "specs/integrations/ix-004-signal-logging-and-proposal-creation.md"
      to: "test/integration/ix-004-signal-logging-and-proposal-creation.test.ts"
      via: "frontmatter integration-test field"
      pattern: "integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts"
    - from: "test/integration/ix-004-signal-logging-and-proposal-creation.test.ts"
      to: "src/tracking/proposals.ts + src/tracking/signals.ts + src/tracking/detector.ts"
      via: "import + direct instantiation against ActivityLog SQLite db"
      pattern: "new ProposalStore.*new SignalStore.*new PatternDetector"
---

<objective>
Wire the IX-004 integration test that the /validate sweep on 2026-04-28 surfaced as missing (IX-INTEGRATION-TEST-UNSET + IX-NAMED-INTERACTIONS-WITHOUT-TEST). IX-004 declares 8 named interactions covering the proposal upsert state machine — create-on-first-signal, same-destination increment, contradicting-destination handling, dismissed-resurface, and approved-noop — but no test asserts each branch in isolation.

Purpose: Close the validation warning for IX-004 by giving each named interaction (IX-004.1 through IX-004.8) a dedicated test case, exercised against real SQLite-backed SignalStore + ProposalStore + PatternDetector (no mocks of units under test). This is pure persistence + state-machine logic — no IMAP required, so the IX-012 harness pattern is the right template (not the IMAP-driven IX-003 harness).

Output: One new vitest file with 8 named it() blocks, an updated spec frontmatter pointing at it, and `/validate IX-004` verdict flipped from WARN to PASS.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/todos/pending/2026-04-29-wire-ix-004-integration-test.md
@specs/integrations/ix-004-signal-logging-and-proposal-creation.md
@src/tracking/index.ts
@src/tracking/proposals.ts
@src/tracking/signals.ts
@src/tracking/detector.ts
@src/shared/types.ts
@test/integration/ix-012-proposal-dismissal-and-resurfacing.test.ts
@.claude/skills/validate-integration/SKILL.md

<interfaces>
<!-- Key contracts the executor needs. Embedded so no codebase scavenger hunt. -->

From src/tracking/signals.ts:
```typescript
export interface MoveSignalInput {
  messageId: string;
  sender: string;
  envelopeRecipient?: string;
  listId?: string;
  subject: string;
  readStatus: 'read' | 'unread';
  visibility?: string;
  sourceFolder: string;
  destinationFolder: string;
}
export interface MoveSignal extends MoveSignalInput { id: number; timestamp: string; }
export class SignalStore {
  constructor(db: Database.Database);
  logSignal(input: MoveSignalInput): number;
  getSignalById(id: number): MoveSignal | null;
  getSignalByMessageId(messageId: string): MoveSignal | null;
  getSignals(limit?: number): MoveSignal[];
}
```

From src/tracking/proposals.ts:
```typescript
export class ProposalStore {
  constructor(db: Database.Database);
  upsertProposal(key: ProposalKey, destination: string, _signalId: number): void;
  getProposals(): ProposedRule[];          // status='active' only, sorted strength DESC
  getById(id: number): ProposedRule | null;
  approveProposal(id: number, ruleId: string): void;
  dismissProposal(id: number): void;       // sets status='dismissed', signals_since_dismiss=0
}
```

From src/tracking/detector.ts:
```typescript
export class PatternDetector {
  constructor(proposalStore: ProposalStore);
  processSignal(signal: MoveSignal): void;
  // builds key={sender, envelopeRecipient: signal.envelopeRecipient ?? null, sourceFolder}
  // then proposalStore.upsertProposal(key, signal.destinationFolder, signal.id)
}
```

From src/shared/types.ts:
```typescript
export interface ProposalKey {
  sender: string;
  envelopeRecipient: string | null;
  sourceFolder: string;
}
```

From src/tracking/index.ts (MoveTracker — relevant for IX-004.1 only):
```typescript
// Inside MoveTracker.logSignal (private):
//   const insertedId = this.deps.signalStore.logSignal(input);
//   if (this.deps.patternDetector) {
//     const signal = this.deps.signalStore.getSignalById(insertedId);
//     if (signal) this.deps.patternDetector.processSignal(signal);
//   }
// So: signalStore.logSignal happens first, then patternDetector.processSignal
// is invoked with the MoveSignal that came back from getSignalById.
```

Schema notes (proposed_rules table):
- Inserted columns on first upsert: sender, envelope_recipient, source_folder, destination_folder, matching_count=1, contradicting_count=0, destination_counts (JSON {dest: 1}). status defaults to 'active' in schema.
- envelope_recipient is normalized: '' → null. Empty-string and null collapse via `IS ?` matching.
- destination='INBOX' (case-insensitive) is rejected before any DB work — relevant if you write a guard test, but NOT one of IX-004's 8 interactions.
- matching_count/contradicting_count are recomputed each upsert: matching_count = max destination count; contradicting_count = sum of others. Dominant tie preserves incumbent.
- Dismissed-resurface: signals_since_dismiss++; once >= 5, status flips to 'active' and dismissed_at is cleared, but signals_since_dismiss is preserved (NOT reset).
- Approved proposals: upsertProposal early-returns — counts and destination_counts MUST be unchanged.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create test/integration/ix-004-signal-logging-and-proposal-creation.test.ts with 8 named it() blocks driven by real SQLite stores</name>
  <files>test/integration/ix-004-signal-logging-and-proposal-creation.test.ts</files>
  <behavior>
Eight named interactions, one it() block each. All run against a fresh per-test ActivityLog (real SQLite at a temp file path), with real SignalStore, ProposalStore, and PatternDetector wired together — exact pattern from test/integration/ix-012-proposal-dismissal-and-resurfacing.test.ts (buildHarness + makeSignal helper). NO mocks of SignalStore/ProposalStore/PatternDetector. NO IMAP / no GreenMail / no Fastify.

Per-test harness (top-level helper):
- beforeEach: mkdtempSync, new ActivityLog(path), new SignalStore(activityLog.getDb()), new ProposalStore(activityLog.getDb()), new PatternDetector(proposalStore).
- afterEach: activityLog.close(), rmSync.
- Direct DB row reads via activityLog.getDb().prepare('SELECT * FROM proposed_rules WHERE id = ?').get(id).
- Direct DB row reads from move_signals via activityLog.getDb().prepare('SELECT * FROM move_signals WHERE id = ?').get(id).
- makeSignal(overrides) helper that returns a MoveSignal with sensible defaults (sender, envelopeRecipient, sourceFolder='INBOX', destinationFolder='Archive/Lists', readStatus='read', subject, messageId, id, timestamp).

Test 1 — IX-004.1: MoveTracker invokes patternDetector.processSignal(moveSignal)
  - This is wiring, not state. Use vitest's `vi.spyOn(patternDetector, 'processSignal')` (or wrap detector and assert via spy).
  - Insert a row directly via signalStore.logSignal(input), retrieve via getSignalById, then call patternDetector.processSignal(signal) the way MoveTracker.logSignal does internally.
  - Assert spy called once with a MoveSignal whose fields match the inserted row (id, sender, sourceFolder, destinationFolder).
  - Document with comment: "MoveTracker.logSignal (src/tracking/index.ts:283-311) invokes signalStore.logSignal first, then getSignalById, then patternDetector.processSignal — this test exercises the post-insert handoff that the IX-004 spec calls out as IX-004.1."
  - Rationale for not booting MoveTracker: MoveTracker requires ImapClient + ActivityLog scan loop, which is the IX-003 harness's territory. IX-004 starts at "PatternDetector receives a confirmed move signal" — the spec's preconditions section says "A confirmed move signal has been emitted by IX-003 with a resolved destination." So the test exercises the handoff at the seam, not the upstream IMAP work.

Test 2 — IX-004.2: SignalStore.logSignal persists raw metadata
  - Build a MoveSignalInput with ALL fields populated (messageId, sender, envelopeRecipient, listId, subject, readStatus='unread', visibility='private', sourceFolder, destinationFolder).
  - signalStore.logSignal(input) → returns inserted id.
  - SELECT * FROM move_signals WHERE id = ? → assert every column matches what was passed in (snake_case in DB, camelCase in input). Specifically check timestamp is non-null and message_id, sender, envelope_recipient, list_id, subject, read_status, visibility, source_folder, destination_folder all match.
  - Also assert signalStore.getSignalById returns the same data round-tripped to camelCase.

Test 3 — IX-004.3: PatternDetector builds {sender, envelopeRecipient, sourceFolder} key for ProposalStore lookup
  - Drive two signals from the same {sender, envelopeRecipient, sourceFolder} but different other fields (different messageId, subject, readStatus). Both → Archive/Lists.
  - Assert getProposals() returns exactly ONE proposal (proving the key collapsed both signals to the same row).
  - Drive a third signal with a different envelopeRecipient — assert getProposals() returns TWO proposals (proving envelopeRecipient is part of the key).
  - Drive a fourth with a different sourceFolder — assert getProposals() returns THREE proposals (proving sourceFolder is part of the key).
  - Test the null-vs-empty collapse: drive a signal with envelopeRecipient: undefined and another with envelopeRecipient: '' — assert they collapse to the same proposal (per ProposalStore's `key.envelopeRecipient === '' ? null : (key.envelopeRecipient ?? null)` normalization).

Test 4 — IX-004.4: No existing proposal → create with status=active, matching_count=1
  - Single signal via patternDetector.processSignal.
  - getProposals() → 1 row.
  - SELECT row → status='active', matching_count=1, contradicting_count=0, destination_counts={"Archive/Lists":1}, destination_folder='Archive/Lists', signals_since_dismiss=0, dismissed_at IS NULL.
  - sender / envelope_recipient / source_folder match input.

Test 5 — IX-004.5: Same-destination match → matching_count increments, strength label progresses
  - Drive 1 signal → row.matching_count=1, ProposedRule.strength=1 (matching - contradicting).
  - Drive 2 more signals same key + same destination → matching_count=3, strength=3.
  - Drive 7 more (total 10) → matching_count=10, strength=10.
  - At each milestone, assert getProposals()[0].matchingCount and verify the strength field on the returned ProposedRule increases monotonically.
  - Note: the spec mentions Weak/Moderate/Strong labels — those are computed UI-side from matching_count thresholds. The IX-004 spec body talks about "strength label progresses" — we assert via the `strength` numeric field on ProposedRule (defined in ProposalStore.getProposals as `matching_count - contradicting_count`), which is the source the UI label derives from. Add a comment: "Strength label is a UI projection of strength field (matching_count - contradicting_count); asserting the underlying numeric is the testable contract."

Test 6 — IX-004.6: Different-destination match → contradicting_count++, dominant may shift
  - 1 signal to 'Archive/Lists' → dominant='Archive/Lists', matching=1, contradicting=0.
  - 1 signal same key to 'Archive/Other' → still dominant='Archive/Lists' (tie preserves incumbent: maxCount starts at 0, Lists hits 1 first), matching=1, contradicting=1, destination_counts={"Archive/Lists":1, "Archive/Other":1}.
  - 1 more signal to 'Archive/Other' (total 2 there, 1 in Lists) → dominant flips to 'Archive/Other', matching=2, contradicting=1, destination_counts={"Archive/Lists":1, "Archive/Other":2}.

Test 7 — IX-004.7: Dismissed proposal → signals_since_dismiss++; reaches 5 → status flips to active
  - 1 signal → proposal created.
  - proposalStore.dismissProposal(id) → status='dismissed', signals_since_dismiss=0, dismissed_at non-null.
  - Drive 4 more signals → after each, assert signals_since_dismiss = i (1,2,3,4) and status still 'dismissed'.
  - Drive a 5th post-dismiss signal → status='active', dismissed_at IS NULL, signals_since_dismiss=5 (preserved, not reset — spec D-? and IX-012.6 confirm).
  - Assert getProposals() now returns the row (it was hidden while dismissed).

Test 8 — IX-004.8: Approved proposal → no update
  - 1 signal → proposal created.
  - proposalStore.approveProposal(id, 'fake-rule-id') → status='approved'.
  - Capture the row's matching_count, contradicting_count, destination_counts, dominant, updated_at.
  - Drive 3 more signals (same key, same dest, then different dest, then different dest again) via patternDetector.processSignal.
  - Assert the row is BYTE-IDENTICAL on the counter columns: matching_count, contradicting_count, destination_counts, destination_folder all unchanged. status still 'approved'.
  - (updated_at can be unchanged because upsertProposal early-returns before any UPDATE — assert it too if convenient.)
  </behavior>
  <action>
1. Create test/integration/ix-004-signal-logging-and-proposal-creation.test.ts.
2. Use IX-012's harness as the structural template — same imports (vitest, fs/os/path, ActivityLog, SignalStore, ProposalStore, PatternDetector, MoveSignal type), same per-test mkdtempSync + close + rmSync teardown.
3. The file MUST contain a top-level docblock that lists all 8 named interactions in the same style as IX-003 and IX-012 ("Named-interaction coverage:" block) so the validate-integration script's name-presence check is satisfied even before the it() blocks.
4. Each it() block name MUST start with the literal string `IX-004.N:` where N is 1–8 — the validator looks for the IX-###.N token outside stub declarations (it.todo/it.skip/xit). Do NOT use it.todo or it.skip anywhere.
5. For IX-004.1, use vi.spyOn(patternDetector, 'processSignal') and call the same sequence MoveTracker.logSignal calls (signalStore.logSignal → getSignalById → patternDetector.processSignal). Document in a comment that this exercises the handoff seam, not the upstream IMAP scan (which IX-003 owns).
6. For IX-004.2, populate ALL MoveSignalInput fields (including the optional ones: envelopeRecipient, listId, visibility) and SELECT * to assert every column round-trips.
7. For IX-004.5, assert matching_count and the `strength` field on the returned ProposedRule. Add a comment explaining strength is the source of the UI's Weak/Moderate/Strong label, so it's the testable contract.
8. For IX-004.6, take advantage of the documented incumbent-tie behavior: first signal to A, second to B → A still dominant (because maxCount starts at 0 and Object.entries iterates insertion order, so A's count of 1 > 0 captures dominance first). The third signal to B flips dominant.
9. For IX-004.7, the resurface threshold is `>= 5` per ProposalStore source. Drive exactly 5 post-dismiss signals to trigger the flip; assert signals_since_dismiss is preserved (not reset).
10. For IX-004.8, after approveProposal, capture a baseline row snapshot and after each signal assert the counter fields are byte-identical (use deep-equal on the row's counter subset).
11. Run `npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` and confirm all 8 it() blocks pass. Iterate on any failures until green.
12. AVOID: do NOT mock SignalStore, ProposalStore, or PatternDetector — the source todo explicitly requires real SQLite-backed stores. Do NOT add IMAP / GreenMail / Fastify wiring (this IX is pure persistence + state-machine, per the todo). Do NOT use it.todo / it.skip / xit anywhere.
  </action>
  <verify>
    <automated>npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts</automated>
  </verify>
  <done>
- File test/integration/ix-004-signal-logging-and-proposal-creation.test.ts exists.
- File contains exactly 8 it() blocks; each name starts with 'IX-004.1:' through 'IX-004.8:' (one per interaction).
- All 8 it() blocks pass under vitest.
- No it.todo / it.skip / xit anywhere in the file.
- No mocks of SignalStore / ProposalStore / PatternDetector — all three are constructed with the real classes against a real ActivityLog SQLite db at a per-test temp path.
- Top-level docblock lists named-interaction coverage in the same style as test/integration/ix-003-... and ix-012-... .
  </done>
</task>

<task type="auto">
  <name>Task 2: Update IX-004 spec frontmatter and confirm /validate IX-004 flips WARN→PASS</name>
  <files>specs/integrations/ix-004-signal-logging-and-proposal-creation.md</files>
  <action>
1. Edit specs/integrations/ix-004-signal-logging-and-proposal-creation.md frontmatter: change `integration-test: null` to `integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` (no quotes, matches IX-003's frontmatter style).
2. Leave all other frontmatter fields and body content unchanged.
3. Run the deterministic validator directly: `npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-004` — confirm the JSON output reports zero errors and the previously-warning IX-INTEGRATION-TEST-UNSET + IX-NAMED-INTERACTIONS-WITHOUT-TEST findings are gone.
4. Run the integration test once more via `npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` to confirm it still passes (re-run gate after spec edit, in case a path typo would slip through).
5. AVOID: do NOT modify the IX-004 spec body (Participants / Named Interactions / Sequence Diagram / Pre/Postconditions / Failure Handling) — this task is frontmatter-only. The validator will catch any unintended structural change in step 3.
  </action>
  <verify>
    <automated>npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-004 && npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts</automated>
  </verify>
  <done>
- specs/integrations/ix-004-signal-logging-and-proposal-creation.md frontmatter has `integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts`.
- validate-integration.ts script reports zero errors for IX-004 and exits 0.
- IX-INTEGRATION-TEST-UNSET and IX-NAMED-INTERACTIONS-WITHOUT-TEST findings are no longer present in the script output.
- The integration test still passes after the spec edit.
- Verdict for /validate IX-004 is PASS (or at worst WARN with only unrelated warnings — the two known warnings closed by this work are gone).
  </done>
</task>

</tasks>

<verification>
After both tasks:
1. `npx vitest run test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` → 8/8 it() blocks pass.
2. `npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts IX-004` → zero errors; IX-INTEGRATION-TEST-UNSET and IX-NAMED-INTERACTIONS-WITHOUT-TEST are gone from the JSON findings.
3. Spec frontmatter `integration-test:` is wired to the new test path.
4. Source todo (.planning/todos/pending/2026-04-29-wire-ix-004-integration-test.md) is moved to completed (handled by execute-plan / quick-task workflow, not by this plan).
</verification>

<success_criteria>
- File test/integration/ix-004-signal-logging-and-proposal-creation.test.ts exists with 8 it() blocks named with the IX-004.1: through IX-004.8: prefix.
- All 8 it() blocks pass under real SQLite-backed SignalStore + ProposalStore + PatternDetector — no mocks of units under test, no IMAP, no Fastify.
- specs/integrations/ix-004-signal-logging-and-proposal-creation.md frontmatter integration-test field points at the new test file.
- The deterministic validator reports zero errors for IX-004; the two warnings that triggered this todo (IX-INTEGRATION-TEST-UNSET, IX-NAMED-INTERACTIONS-WITHOUT-TEST) are closed.
- /validate IX-004 verdict transitions from WARN to PASS.
</success_criteria>

<output>
After completion, create `.planning/quick/260501-ewi-wire-ix-004-integration-test/260501-ewi-SUMMARY.md` summarizing:
- The 8 it() blocks created and what each asserts.
- The harness pattern used (real SQLite, no IMAP — IX-012 template, not IX-003).
- The frontmatter wiring change.
- The /validate IX-004 verdict transition (WARN → PASS) with before/after script output excerpts.
- Any deviations from the source todo's expected breakdown (e.g., how IX-004.1 was tested without booting MoveTracker).
</output>
