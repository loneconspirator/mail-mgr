---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/index.ts
autonomous: true
must_haves:
  truths:
    - "When review config changes, BatchEngine uses the updated reviewConfig, reviewFolder, and trashFolder"
    - "Existing behavior for ReviewSweeper rebuild on review config change is preserved"
  artifacts:
    - path: "src/index.ts"
      provides: "BatchEngine rebuild in onReviewConfigChange handler"
      contains: "batchEngine = new BatchEngine"
  key_links:
    - from: "configRepo.onReviewConfigChange"
      to: "new BatchEngine"
      via: "rebuild in callback"
      pattern: "onReviewConfigChange.*batchEngine.*=.*new BatchEngine"
---

<objective>
Rebuild BatchEngine when review config changes, so batch processing uses the updated
reviewConfig, reviewFolder, and trashFolder values.

Purpose: Currently `onReviewConfigChange` (line 68-83 in src/index.ts) rebuilds the
ReviewSweeper but leaves BatchEngine untouched. This means if the user changes the
review folder name, trash folder, sweep intervals, or default archive folder, the
BatchEngine continues operating with stale values. The fix mirrors the existing
ReviewSweeper rebuild pattern.

Output: Updated src/index.ts with BatchEngine rebuild inside onReviewConfigChange.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/index.ts
@src/batch/index.ts

<interfaces>
From src/batch/index.ts:
```typescript
export interface BatchDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  rules: Rule[];
  trashFolder: string;
  logger?: pino.Logger;
  reviewFolder?: string;
  reviewConfig?: ReviewConfig;
}

export class BatchEngine {
  constructor(deps: BatchDeps)
  updateRules(rules: Rule[]): void
  // ...
}
```

From src/index.ts (the handler to modify, lines 68-83):
```typescript
configRepo.onReviewConfigChange(async () => {
  const updatedConfig = configRepo.getConfig();
  if (sweeper) sweeper.stop();
  sweeper = undefined;
  const reviewTrash = await imapClient.getSpecialUseFolder('\\Trash')
    ?? updatedConfig.review.trashFolder;
  sweeper = new ReviewSweeper({
    client: imapClient,
    activityLog,
    rules: updatedConfig.rules,
    reviewConfig: updatedConfig.review,
    trashFolder: reviewTrash,
    logger,
  });
  sweeper.start();
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rebuild BatchEngine in onReviewConfigChange handler</name>
  <files>src/index.ts</files>
  <action>
In the `onReviewConfigChange` callback (currently lines 68-83), after the ReviewSweeper
is rebuilt and started, add a BatchEngine rebuild. The new BatchEngine should use:

- `client: imapClient` (same IMAP client, unchanged)
- `activityLog` (same log instance, unchanged)
- `rules: updatedConfig.rules` (fresh from config)
- `trashFolder: reviewTrash` (the resolved trash folder, same as sweeper gets)
- `reviewFolder: updatedConfig.review.folder` (updated review folder)
- `reviewConfig: updatedConfig.review` (updated review config)
- `logger` (same logger instance)

Place the rebuild AFTER `sweeper.start()` so the pattern reads naturally:
1. Stop old sweeper
2. Resolve trash folder
3. Rebuild sweeper, start it
4. Rebuild batchEngine

The BatchEngine has no start/stop lifecycle (it runs on-demand), so no need to stop
the old one — just reassign. If a batch job happens to be running during the rebuild,
it holds its own reference to deps and will finish with the old config, which is
acceptable (same as how the sweeper rebuild works).

Also update the `onImapConfigChange` handler's BatchEngine rebuild (around line 105)
to use `newTrash` instead of `newConfig.review.trashFolder` for consistency with the
sweeper rebuild pattern — both should use the resolved trash folder.
  </action>
  <verify>
    <automated>npx vitest run test/unit/batch/engine.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>
- onReviewConfigChange rebuilds batchEngine with updated reviewConfig, reviewFolder, and resolved trashFolder
- onImapConfigChange BatchEngine rebuild uses resolved newTrash for trashFolder
- All existing batch tests pass
- TypeScript compiles without errors: `npx tsc --noEmit`
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — TypeScript compilation succeeds
2. `npx vitest run` — all tests pass
3. Manual code review: the onReviewConfigChange handler now rebuilds both sweeper AND batchEngine
</verification>

<success_criteria>
- BatchEngine is rebuilt with fresh config values whenever review config changes
- The onImapConfigChange handler's BatchEngine rebuild uses resolved trash folder
- No regressions in existing tests
</success_criteria>

<output>
After completion, create `.planning/quick/260411-fmv-rebuild-batchengine-on-review-config-cha/260411-fmv-SUMMARY.md`
</output>
</task>
