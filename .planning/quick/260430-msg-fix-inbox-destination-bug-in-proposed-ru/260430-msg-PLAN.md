---
phase: 260430-msg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tracking/destinations.ts
  - src/tracking/proposals.ts
  - test/unit/tracking/destinations.test.ts
  - test/unit/tracking/proposals.test.ts
  - .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql
autonomous: true
requirements:
  - QUICK-260430-msg
must_haves:
  truths:
    - "DestinationResolver.resolveFast NEVER returns 'INBOX' even when 'INBOX' is in the recent-folders pool"
    - "DestinationResolver.runDeepScan NEVER returns 'INBOX' even when 'INBOX' is in the listFolders result"
    - "ProposalStore.upsertProposal is a no-op (writes nothing) when destination='INBOX'"
    - "Existing destinations.test.ts and proposals.test.ts cases still pass (no regression)"
    - "A SQL cleanup snippet exists at the prescribed path with comments explaining usage"
  artifacts:
    - path: "src/tracking/destinations.ts"
      provides: "INBOX exclusion in resolveFast and runDeepScan candidate sets"
      contains: "toUpperCase() !== 'INBOX'"
    - path: "src/tracking/proposals.ts"
      provides: "INBOX short-circuit at top of upsertProposal"
      contains: "toUpperCase() === 'INBOX'"
    - path: "test/unit/tracking/destinations.test.ts"
      provides: "Test that INBOX is excluded even when in recent-folders pool"
    - path: "test/unit/tracking/proposals.test.ts"
      provides: "Test that upsertProposal with destination='INBOX' is a no-op"
    - path: ".planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql"
      provides: "Soma cleanup SQL (manual execution, not run by executor)"
      contains: "DELETE FROM move_signals"
  key_links:
    - from: "DestinationResolver.resolveFast"
      to: "candidate Set<string>"
      via: "isInbox helper filter alongside sourceFolder filter"
      pattern: "toUpperCase\\(\\) !== 'INBOX'"
    - from: "DestinationResolver.runDeepScan"
      to: "allFolders iteration"
      via: "early-continue when folder.path is INBOX (case-insensitive)"
      pattern: "toUpperCase\\(\\) === 'INBOX'"
    - from: "ProposalStore.upsertProposal"
      to: "transaction (txn)"
      via: "early return BEFORE this.db.transaction is built/run"
      pattern: "destination\\.toUpperCase\\(\\) === 'INBOX'"
---

<objective>
Fix the INBOX-destination bug in proposed rules. Two-layer guard:

1. **Primary (resolver):** Exclude INBOX from `DestinationResolver` candidate sets in both `resolveFast` and `runDeepScan` so user-move detection can never attribute a destination of "INBOX".
2. **Secondary (proposal):** Short-circuit `ProposalStore.upsertProposal` when destination=INBOX as belt-and-suspenders against any other call path.

Plus a one-time SQL cleanup artifact for the user to run manually on Soma's prod DB (192.168.1.90, out of executor reach).

Purpose: Eliminate semantically-meaningless "move to INBOX" proposed rules (e.g., the "108 moves to INBOX from info@e.boynerewards.com" pattern observed on Soma) and prevent future signal pollution.

Output:
- 2 production code edits (destinations.ts, proposals.ts)
- 2 test edits adding regression coverage
- 1 SQL artifact for user-side cleanup
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/debug/108-moves-to-inbox-proposed-rule.md
@src/tracking/destinations.ts
@src/tracking/proposals.ts
@test/unit/tracking/destinations.test.ts
@test/unit/tracking/proposals.test.ts

<interfaces>
<!-- Key shapes the executor needs without exploring -->

From src/tracking/destinations.ts (current state):
```typescript
export class DestinationResolver {
  async resolveFast(messageId: string, sourceFolder: string): Promise<string | null>;
  enqueueDeepScan(messageId: string, sourceFolder: string): void;
  async runDeepScan(): Promise<Map<string, string>>;
}
// COMMON_FOLDERS: hardcoded list, does NOT contain 'INBOX'
// candidates built from: activityLog.getRecentFolders(10) ∪ COMMON_FOLDERS, filtered by `folder !== sourceFolder`
```

From src/tracking/proposals.ts (current state):
```typescript
export class ProposalStore {
  upsertProposal(key: ProposalKey, destination: string, _signalId: number): void;
  getProposals(): ProposedRule[];
  getById(id: number): ProposedRule | null;
  approveProposal(id: number, ruleId: string): void;
  dismissProposal(id: number): void;
  getExampleSubjects(...): ExampleMessage[];
}
// upsertProposal currently has zero validation that destination !== source or destination !== 'INBOX'
```

From test/unit/tracking/destinations.test.ts (test patterns):
- Uses `vitest` (not bun)
- Helper: `createMockDeps(folderMessages: Record<string, string[]>)` returns `DestinationResolverDeps` with mocked `client.withMailboxSwitch`, `activityLog.getRecentFolders`, `listFolders`
- Pattern: `(deps.activityLog as { getRecentFolders: ReturnType<typeof vi.fn> }).getRecentFolders.mockReturnValue([...])`

From test/unit/tracking/proposals.test.ts (test patterns):
- Uses `vitest` + in-memory `better-sqlite3` Database
- Helpers: `createSchema(db)`, `makeKey(overrides)`, `insertSignal(db, overrides)`
- Test command: `npm test` or `npx vitest run test/unit/tracking/proposals.test.ts`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add INBOX exclusion to DestinationResolver + regression test</name>
  <files>
    src/tracking/destinations.ts,
    test/unit/tracking/destinations.test.ts
  </files>
  <behavior>
    - Test (RED first): `resolveFast(messageId, '<reviewFolder>')` returns the non-INBOX folder when both `'INBOX'` and another folder are in the recent-folders pool — even when the message is also present in INBOX. Stub `activityLog.getRecentFolders` to return `['INBOX', 'Projects']`. Stub folder messages so the target message-id appears in BOTH 'INBOX' and 'Projects'. Expect `result === 'Projects'` (NOT 'INBOX').
    - Test (RED first): `runDeepScan` does NOT return 'INBOX' even when `listFolders` returns an INBOX entry. Use `enqueueDeepScan(msgId, '<reviewFolder>')`, mock `listFolders` to include `{ path: 'INBOX', flags: [] }` and `{ path: 'Projects', flags: [] }`, mock the message present in INBOX only. Expect the result Map to have NO entry for that messageId (because INBOX is filtered and Projects has no match) — i.e., dropped per D-06.
    - (Optional bonus) Lowercase 'inbox' is also excluded — same pattern as above with 'inbox' in the recent-folders list.
  </behavior>
  <action>
1. Open `src/tracking/destinations.ts`.
2. At module scope (or the top of the class — module scope is cleanest), add a tiny helper:
   ```ts
   const isInbox = (folder: string): boolean => folder.toUpperCase() === 'INBOX';
   ```
3. In `resolveFast` (lines 60-84), update BOTH candidate-population loops to also exclude INBOX. Final shape:
   ```ts
   for (const folder of recentFolders) {
     if (folder !== sourceFolder && !isInbox(folder)) {
       candidates.add(folder);
     }
   }
   for (const folder of COMMON_FOLDERS) {
     if (folder !== sourceFolder && !isInbox(folder)) {
       candidates.add(folder);
     }
   }
   ```
   (COMMON_FOLDERS does not currently contain INBOX, but the symmetric guard is cheap insurance against future edits.)
4. In `runDeepScan` (lines 99-143), inside the `for (const folder of allFolders)` loop, ADD a new skip BEFORE the existing `\Noselect` / sourceFolder / commonSet skips:
   ```ts
   if (isInbox(folder.path)) {
     continue;
   }
   ```
5. Open `test/unit/tracking/destinations.test.ts`. Add a new `describe('INBOX exclusion', () => { ... })` block (or append `it(...)` cases inside the existing `describe('fast pass', ...)` and `describe('deep scan', ...)` blocks if those exist further down — read the file fully first to see the structure). Use the existing `createMockDeps` helper. Tests:
   - `it('excludes INBOX from fast-pass candidates even when getRecentFolders returns it', ...)`
   - `it('excludes INBOX from deep-scan candidates even when listFolders returns it', ...)`
   - `it('excludes lowercase "inbox" case-insensitively', ...)` (or any non-canonical-case variant)
6. Run the tests; confirm RED (initially fail without the fix), then GREEN with the fix in place. If you write the source change first, just confirm GREEN — RED is implicit.
  </action>
  <verify>
    <automated>npx vitest run test/unit/tracking/destinations.test.ts</automated>
  </verify>
  <done>
    - `isInbox` helper exists in destinations.ts
    - `resolveFast` excludes INBOX from both recentFolders and COMMON_FOLDERS loops
    - `runDeepScan` continues past INBOX in allFolders iteration
    - 2-3 new tests pass; all pre-existing tests still pass
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add INBOX short-circuit to ProposalStore.upsertProposal + regression test</name>
  <files>
    src/tracking/proposals.ts,
    test/unit/tracking/proposals.test.ts
  </files>
  <behavior>
    - Test (RED first): `upsertProposal(key, 'INBOX', signalId)` is a no-op. Setup: insert one signal, call upsertProposal with destination='INBOX'. After: `proposed_rules` table has zero rows for that key. `move_signals` rows are untouched (that's a different table — this method doesn't write to it anyway, but the assertion documents the contract).
    - Test (RED first): Lowercase `'inbox'` is also a no-op — same expectation.
    - Test (negative control / non-regression): `upsertProposal(key, 'Archive', signalId)` still inserts a row as before.
  </behavior>
  <action>
1. Open `src/tracking/proposals.ts`.
2. At the very top of `upsertProposal` (line 23, BEFORE the `normalizedRecipient` line and BEFORE building the transaction), add:
   ```ts
   // Guard: never form proposals destined for INBOX. INBOX is the entrance,
   // not a routing target. See .planning/debug/108-moves-to-inbox-proposed-rule.md
   // for context. The destination resolver also filters INBOX; this is belt-and-suspenders.
   if (destination.toUpperCase() === 'INBOX') {
     return;
   }
   ```
   Method signature stays `void` — no return value change needed.
3. Open `test/unit/tracking/proposals.test.ts`. Inside the existing `describe('ProposalStore', ...)` block (read the file first to find the right spot, ideally near other `describe('upsertProposal', ...)` cases), add a new sub-describe:
   ```ts
   describe('INBOX guard', () => {
     it('is a no-op when destination is INBOX', () => {
       const key = makeKey({ sourceFolder: 'Review' });
       const signalId = insertSignal(db, { source_folder: 'Review', destination_folder: 'INBOX' });
       store.upsertProposal(key, 'INBOX', signalId);
       const rows = db.prepare('SELECT * FROM proposed_rules').all();
       expect(rows).toHaveLength(0);
     });

     it('is a no-op when destination is lowercase "inbox"', () => {
       const key = makeKey({ sourceFolder: 'Review' });
       const signalId = insertSignal(db, { source_folder: 'Review', destination_folder: 'inbox' });
       store.upsertProposal(key, 'inbox', signalId);
       const rows = db.prepare('SELECT * FROM proposed_rules').all();
       expect(rows).toHaveLength(0);
     });

     it('still inserts proposals for non-INBOX destinations', () => {
       const key = makeKey({ sourceFolder: 'Review' });
       const signalId = insertSignal(db, { source_folder: 'Review', destination_folder: 'Archive' });
       store.upsertProposal(key, 'Archive', signalId);
       const rows = db.prepare('SELECT destination_folder FROM proposed_rules').all() as Array<{ destination_folder: string }>;
       expect(rows).toHaveLength(1);
       expect(rows[0].destination_folder).toBe('Archive');
     });
   });
   ```
   Adapt to the file's existing `beforeEach`/`afterEach` setup — `db` and `store` should already be initialized per the suite's existing scaffolding.
4. Run the tests; confirm pass.
  </action>
  <verify>
    <automated>npx vitest run test/unit/tracking/proposals.test.ts</automated>
  </verify>
  <done>
    - `upsertProposal` returns early when `destination.toUpperCase() === 'INBOX'`
    - 3 new tests pass; all pre-existing tests still pass
  </done>
</task>

<task type="auto">
  <name>Task 3: Write Soma cleanup SQL artifact + run full test suite</name>
  <files>
    .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql
  </files>
  <action>
1. Create `.planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql` with the following content:
   ```sql
   -- One-time cleanup for INBOX-destinated rows polluted before the
   -- DestinationResolver + ProposalStore guards landed.
   --
   -- Context: .planning/debug/108-moves-to-inbox-proposed-rule.md
   --
   -- WHERE TO RUN:
   --   Soma (TrueNAS, 192.168.1.90) — production SQLite DB used by the
   --   mail-mgr container. NOT runnable from the local executor; the user
   --   must SSH into Soma and apply this manually against the DB volume.
   --
   -- WHEN TO RUN:
   --   AFTER the new build (with the resolver + proposal guards) has been
   --   deployed to Soma. Running this against the old build will only
   --   provide temporary relief — new INBOX rows will accumulate again.
   --
   -- WHAT IT DOES:
   --   1) Removes historical INBOX-destinated move signals (signal noise).
   --   2) Removes any active/dismissed proposed rules with destination=INBOX
   --      (UI cleanup). Approved rules are also removed — they shouldn't
   --      exist (the UI prevents approving an INBOX-destinated rule), but
   --      if any slipped through, this clears them too.
   --
   -- SAFETY:
   --   Take a snapshot of the SQLite DB file before running. Both DELETEs
   --   are scoped strictly to destination_folder='INBOX' — they will not
   --   touch any other rows. If you want extra safety, run the SELECT
   --   versions first to count what would be affected:
   --
   --     SELECT COUNT(*) FROM move_signals    WHERE destination_folder = 'INBOX';
   --     SELECT COUNT(*) FROM proposed_rules  WHERE destination_folder = 'INBOX';
   --
   --   Then run the DELETEs:

   DELETE FROM move_signals    WHERE destination_folder = 'INBOX';
   DELETE FROM proposed_rules  WHERE destination_folder = 'INBOX';

   -- Optional case-insensitive variants (uncomment if any non-canonical
   -- 'inbox' / 'Inbox' rows exist — unlikely on Fastmail but cheap insurance):
   --
   -- DELETE FROM move_signals    WHERE UPPER(destination_folder) = 'INBOX';
   -- DELETE FROM proposed_rules  WHERE UPPER(destination_folder) = 'INBOX';
   ```
2. Run the full unit test suite to confirm no regression elsewhere:
   ```bash
   npm run test:unit
   ```
3. Visual sanity check — read both edited source files end-to-end one last time to confirm the guards are in the right place and don't break neighboring code.
  </action>
  <verify>
    <automated>npm run test:unit</automated>
  </verify>
  <done>
    - cleanup.sql exists at the specified path with header comments + the two DELETE statements
    - Full unit test suite passes (no regression in any module)
    - Both source files (destinations.ts, proposals.ts) read cleanly with the new guards in place
  </done>
</task>

</tasks>

<verification>
- `npx vitest run test/unit/tracking/destinations.test.ts` — all tests pass including new INBOX-exclusion cases
- `npx vitest run test/unit/tracking/proposals.test.ts` — all tests pass including new INBOX-guard cases
- `npm run test:unit` — full unit suite green (no collateral damage)
- `cat .planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/cleanup.sql` — file exists with both DELETE statements and header comments
- Manual code review: `isInbox` helper present in destinations.ts; both `resolveFast` candidate loops AND the `runDeepScan` allFolders loop filter on it; `upsertProposal` short-circuits at the top.
</verification>

<success_criteria>
- DestinationResolver cannot return 'INBOX' (any case) as a destination from `resolveFast` or `runDeepScan` — proven by tests.
- ProposalStore.upsertProposal writes nothing when destination is INBOX (any case) — proven by tests.
- Existing test coverage unaffected (no regressions).
- User has a ready-to-run SQL artifact for Soma cleanup with clear comments about where, when, and why to run it.
</success_criteria>

<output>
After completion, create `.planning/quick/260430-msg-fix-inbox-destination-bug-in-proposed-ru/260430-msg-SUMMARY.md` summarizing:
- Files changed (with line ranges)
- Test results (counts of new tests added, pass/fail)
- Pointer to cleanup.sql for the user to action on Soma
- Any unexpected findings during implementation
</output>
