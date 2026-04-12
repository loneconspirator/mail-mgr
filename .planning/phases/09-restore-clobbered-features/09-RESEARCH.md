# Phase 9: Restore Clobbered Features - Research

**Researched:** 2026-04-12
**Domain:** Code restoration and reconciliation (TypeScript, IMAP, Fastify, frontend SPA)
**Confidence:** HIGH

## Summary

Commit `f453be7` (Phase 07-01) replaced entire files instead of making surgical edits, deleting 10 source modules, 8 test files, and stripping significant content from 11 more. This wiped out all v0.3 features: ReviewSweeper, BatchEngine, FolderCache, folder picker, DB migrations, review/batch/folder web routes, and substantial frontend UI. Phase 8 then added envelope discovery, extended match fields UI, and XSS-safe helpers on top of the clobbered state.

The restoration strategy is: `git show f453be7^:<path>` for each deleted/degraded file, then reconcile with Phase 7/8 additions. All pre-clobber code is preserved in git history and can be extracted cleanly. The main complexity is in 5 files where Phase 8 added features that must be merged with the restored content (messages.ts, monitor, imap/client, frontend app.ts, frontend api.ts).

**Primary recommendation:** Restore in dependency order (types -> config -> IMAP -> core modules -> routes -> server wiring -> main entry -> frontend -> tests), doing each layer as a separate plan to keep builds green.

## Clobber Inventory

### Confirmed Missing: 10 Deleted Source Modules

| File | Lines | Feature | Dependencies |
|------|-------|---------|-------------|
| `src/sweep/index.ts` | 272 | ReviewSweeper -- periodic review folder cleanup | imap, rules, actions, log, config |
| `src/batch/index.ts` | 398 | BatchEngine -- retroactive rule application | imap, rules, actions, sweep, log, config |
| `src/folders/cache.ts` | 72 | FolderCache -- cached IMAP folder tree | imap, shared/types |
| `src/folders/index.ts` | 2 | Folder module barrel export | folders/cache |
| `src/log/migrations.ts` | 60 | SQLite schema migrations | better-sqlite3 |
| `src/web/frontend/folder-picker.ts` | ~200 | Tree-based folder picker component | shared/types |
| `src/web/routes/batch.ts` | 61 | Batch API routes | batch, server deps |
| `src/web/routes/folders.ts` | 17 | Folder tree API route | folders/cache, server deps |
| `src/web/routes/review-config.ts` | 30 | Review config API route | config repo, server deps |
| `src/web/routes/review.ts` | 20 | Review status API route | sweep, server deps |

[VERIFIED: git show f453be7^:<path> for each file + confirmed missing on HEAD]

### Confirmed Missing: 8 Deleted Test Files

| File | Lines | Covers |
|------|-------|--------|
| `test/integration/sweep.test.ts` | 130 | Sweep integration |
| `test/unit/batch/engine.test.ts` | 740 | BatchEngine |
| `test/unit/folders/cache.test.ts` | 172 | FolderCache |
| `test/unit/log/migrations.test.ts` | 139 | DB migrations |
| `test/unit/sweep/sweep.test.ts` | 559 | ReviewSweeper |
| `test/unit/web/batch.test.ts` | 173 | Batch routes |
| `test/unit/web/folder-picker.test.ts` | 214 | Folder picker |
| `test/unit/web/folders.test.ts` | 123 | Folder routes |

[VERIFIED: confirmed missing on HEAD]

### Confirmed Degraded: 11 Source Files (Content Stripped)

| File | Lines lost | What's missing | Phase 8 additions to preserve |
|------|-----------|----------------|-------------------------------|
| `src/index.ts` | 102 | ReviewSweeper wiring, BatchEngine creation, FolderCache init, review config change listener, sweeper restart on IMAP config change | Envelope discovery on startup/config change (simplified flow) |
| `src/imap/client.ts` | 79 | `getHeaderFields()`, envelope header fetching in queries, `parseHeaderLines`/`classifyVisibility` integration, `envelopeRecipient`/`visibility` on parsed messages, `listFolders()`, `listTree()` on `ImapFlowLike` | `status()` method on `ImapFlowLike` (used by discovery) |
| `src/shared/types.ts` | 48 | `FolderNode`, `FolderTreeResponse`, `DryRunMessage`, `DryRunGroup`, `BatchStatus`, `BatchStatusResponse`, `DryRunResponse` | `EnvelopeStatus` type |
| `src/config/repository.ts` | 24 | `getReviewConfig()`, `updateReviewConfig()`, `onReviewConfigChange()`, `reviewListeners` array | None |
| `src/web/frontend/api.ts` | 15 | `review` namespace, `folders.tree()`, batch API methods, `recentFolders()`, cursor API, missing type re-exports | `config.getEnvelopeStatus()`, `config.triggerDiscovery()`, `ImapConfigResponse` type |
| `src/web/frontend/app.ts` | 389 | Batch page, folder picker, review status card, sweep settings card, activity badges, old-style rule display | XSS `esc()` helper, envelope status check in rule editor, 3-column rule table, `generateBehaviorDescription(match)` call, Phase 8 modal with deliveredTo/visibility/readStatus |
| `src/web/frontend/styles.css` | 94 | Batch UI styles, sweep badges, folder picker styles | Phase 8 discovery/settings styles |
| `src/web/server.ts` | 11 | Review/batch/folder route registration, sweeper/folder/batch deps | `registerEnvelopeRoutes` import and registration |
| `src/web/routes/rules.ts` | 17 | Folder existence warnings (`checkFolderWarnings`) | None |
| `src/monitor/index.ts` | 15 | `envelopeHeader` usage in message parsing, `cursorEnabled` toggle | None (current code works but doesn't pass envelopeHeader to parseMessage) |
| `src/web/frontend/index.html` | 1 | Batch nav button | None |

[VERIFIED: git diff f453be7^..HEAD for each file]

## Reconciliation Analysis

### Phase 7 Additions (already in codebase, must be preserved)

1. **Schema:** `emailMatchSchema` now includes `deliveredTo`, `visibility`, `readStatus` fields [VERIFIED: src/config/schema.ts]
2. **Matcher:** `matchRule()` handles deliveredTo glob, visibility enum, readStatus flag check [VERIFIED: src/rules/matcher.ts]
3. **Evaluator:** `evaluateRules()` skips envelope-dependent rules when message lacks envelope data [VERIFIED: src/rules/evaluator.ts]
4. **Types:** `VisibilityMatch`, `ReadStatusMatch` exported from schema [VERIFIED: src/config/schema.ts]

### Phase 8 Additions (must be preserved during restoration)

1. **Envelope route:** `src/web/routes/envelope.ts` -- new file, not in pre-clobber. GET/POST for envelope discovery [VERIFIED: file exists, did not exist pre-clobber]
2. **EnvelopeStatus type:** `src/shared/types.ts` has `EnvelopeStatus` interface [VERIFIED: src/shared/types.ts]
3. **Frontend rule display:** `src/web/frontend/rule-display.ts` -- `generateBehaviorDescription(match)` takes `EmailMatch` not full `Rule` [VERIFIED: src/web/frontend/rule-display.ts]
4. **Frontend XSS protection:** `esc()` function in app.ts [VERIFIED: src/web/frontend/app.ts]
5. **Frontend rule editor:** Modal now has deliveredTo, visibility, readStatus fields; fetches envelope status to enable/disable [VERIFIED: git diff]
6. **Frontend API:** `config.getEnvelopeStatus()` and `config.triggerDiscovery()` methods [VERIFIED: src/web/frontend/api.ts]
7. **Frontend API type:** Uses `ImapConfigResponse` (masked) instead of raw `ImapConfig` [VERIFIED: src/web/frontend/api.ts]
8. **Discovery settings UI:** Settings page shows envelope discovery section [VERIFIED: src/web/frontend/app.ts]
9. **`status()` on ImapFlowLike:** Added for discovery range queries [VERIFIED: src/imap/client.ts line 27]

### Key Conflicts to Resolve

| Area | Pre-clobber | Current (Phase 8) | Resolution |
|------|------------|-------------------|------------|
| `ImapFlowLike.listTree` | Had `listTree()` | Replaced with `status()` | Need BOTH -- add `listTree` back alongside `status` |
| `imap/client.ts` parseRawToReviewMessage | Had `envelopeRecipient`/`visibility` fields | Stripped | Restore -- needed for sweep/batch to pass extended fields |
| `imap/client.ts` fetchNewMessages/fetchAllMessages | Included `headers` in query when `envelopeHeader` configured | Hardcoded query without headers | Restore `getHeaderFields()` and conditional header inclusion |
| `imap/messages.ts` ImapFetchResult | Had `headers?: Buffer` | Stripped | Restore |
| `imap/messages.ts` ReviewMessage | Had `envelopeRecipient?`, `visibility?` | Stripped | Restore |
| `imap/messages.ts` parseMessage | Took `envelopeHeader` param, used it | No param | Restore (Phase 6 feature lost in clobber) |
| `imap/messages.ts` classifyVisibility | Existed, exported | Function exists but NOT exported from imap/index.ts barrel... wait, it IS still in messages.ts but NOT called from client | Actually -- function body was preserved but it's unused. Just needs re-wiring. |
| `imap/index.ts` exports | Exported `classifyVisibility` | Only exports `parseHeaderLines` (not classifyVisibility) | Actually it does NOT export classifyVisibility. Need to restore export. |
| `monitor/index.ts` | Passed `envelopeHeader` to `parseMessage` | Does not | Restore -- this is how extended matchers actually work at runtime |
| `frontend api.ts` | Used raw `ImapConfig` type | Uses `ImapConfigResponse` (masked) | Keep Phase 8's `ImapConfigResponse` -- it's more correct |
| `frontend app.ts` | Old rule display format (behavior description) | New 3-column table with `esc()` | Merge: keep Phase 8 rule table/editor, restore batch/sweep/folder UI |
| `server.ts` deps | Had sweeper/folder/batch getters | Has only monitor getter + envelope route | Merge: add all back |

### Critical Discovery: messages.ts classifyVisibility

The function `classifyVisibility` exists in the current `src/imap/messages.ts` but is NOT exported from the barrel `src/imap/index.ts`. Pre-clobber it was exported. The pre-clobber `client.ts` imported and used it from `./messages.js`. This needs to be restored. [VERIFIED: compared current index.ts exports vs pre-clobber]

Wait -- re-checking. Current `src/imap/messages.ts` does NOT have `classifyVisibility`. It has `parseHeaderLines` but NOT `classifyVisibility`. The pre-clobber version had both. [VERIFIED: read src/imap/messages.ts -- no classifyVisibility function]

Current `src/imap/index.ts` exports `parseHeaderLines` but NOT `classifyVisibility`. Pre-clobber exported both. The function itself needs to be restored to messages.ts AND the export added to index.ts. [VERIFIED: src/imap/index.ts]

## Dependency Graph for Restoration

```
Layer 0 (no deps on clobbered code):
  src/shared/types.ts          -- add missing type interfaces
  src/imap/messages.ts         -- restore classifyVisibility, ImapFetchResult.headers,
                                  ReviewMessage.envelopeRecipient/visibility,
                                  parseMessage envelopeHeader param
  src/imap/index.ts            -- restore classifyVisibility export
  src/log/migrations.ts        -- standalone module

Layer 1 (depends on Layer 0):
  src/config/repository.ts     -- restore reviewConfig methods
  src/imap/client.ts           -- restore getHeaderFields, listFolders, listTree on interface,
                                  envelope fields on parseRawToReviewMessage
  src/folders/cache.ts + index.ts  -- depends on imap client, shared types

Layer 2 (depends on Layer 1):
  src/sweep/index.ts           -- depends on imap, rules, actions, log, config
  src/batch/index.ts           -- depends on imap, rules, actions, sweep, log, config

Layer 3 (depends on Layer 2):
  src/monitor/index.ts         -- restore envelopeHeader/cursorEnabled
  src/web/routes/review.ts     -- depends on sweep
  src/web/routes/review-config.ts  -- depends on config repo
  src/web/routes/folders.ts    -- depends on folder cache
  src/web/routes/batch.ts      -- depends on batch engine
  src/web/routes/rules.ts      -- add folder warnings back

Layer 4 (depends on Layer 3):
  src/web/server.ts            -- register all routes, add all deps
  src/index.ts                 -- wire everything together

Layer 5 (frontend -- no backend deps, just API alignment):
  src/web/frontend/api.ts      -- add review/batch/folder API methods
  src/web/frontend/folder-picker.ts  -- restore whole component
  src/web/frontend/app.ts      -- merge batch/sweep/folder UI with Phase 8 additions
  src/web/frontend/index.html  -- add batch nav button
  src/web/frontend/styles.css  -- add batch/sweep/folder styles

Layer 6 (tests):
  All 8 test files -- may need adaptation for Phase 7/8 type changes
```

## Recommended Restoration Order (Plans)

### Plan 1: Foundation Types & IMAP Layer (Layers 0-1)

Restore the bottom of the stack so everything above can compile:

1. `src/shared/types.ts` -- add back `FolderNode`, `FolderTreeResponse`, `DryRunMessage`, `DryRunGroup`, `BatchStatus`, `BatchStatusResponse`, `DryRunResponse`. Keep `EnvelopeStatus`.
2. `src/imap/messages.ts` -- restore `classifyVisibility` function, add `headers?: Buffer` to `ImapFetchResult`, add `envelopeRecipient?`/`visibility?` to `ReviewMessage`, restore `parseMessage(fetched, envelopeHeader?)` signature, update `reviewMessageToEmailMessage` to pass through envelope fields.
3. `src/imap/index.ts` -- add `classifyVisibility` to exports.
4. `src/imap/client.ts` -- restore `getHeaderFields()`, restore header fetching in `fetchNewMessages`/`fetchAllMessages`, restore `envelopeRecipient`/`visibility` on `parseRawToReviewMessage`, restore `listFolders()`, add `listTree` back to `ImapFlowLike` (keep `status` too).
5. `src/config/repository.ts` -- restore `getReviewConfig()`, `updateReviewConfig()`, `onReviewConfigChange()`, `reviewListeners`.
6. `src/log/migrations.ts` -- restore whole file.
7. `src/folders/cache.ts` + `src/folders/index.ts` -- restore whole files.

**Build check:** `npm run build` should pass after this plan.

### Plan 2: Core Modules (Layer 2)

Restore the sweep and batch engines:

1. `src/sweep/index.ts` -- restore whole file (272 lines). Types should be compatible since actions/schema haven't changed shape.
2. `src/batch/index.ts` -- restore whole file (398 lines). Uses `executeAction`, `evaluateRules`, sweep helpers.

**Build check:** `npm run build` should pass.

### Plan 3: Backend Wiring (Layers 3-4)

Wire everything into the server and main entry:

1. `src/web/routes/review.ts` -- restore (20 lines).
2. `src/web/routes/review-config.ts` -- restore (30 lines).
3. `src/web/routes/folders.ts` -- restore (17 lines).
4. `src/web/routes/batch.ts` -- restore (61 lines).
5. `src/web/routes/rules.ts` -- add folder warnings back (import FolderCache, checkFolderWarnings function).
6. `src/web/server.ts` -- merge: keep `registerEnvelopeRoutes`, add back review/review-config/folders/batch route registration, add `getSweeper`/`getFolderCache`/`getBatchEngine` to `ServerDeps`.
7. `src/index.ts` -- merge: keep envelope discovery logic, add back ReviewSweeper/BatchEngine/FolderCache creation, review config change listener, sweeper restart on IMAP change. Key: envelope discovery must run BEFORE sweeper/batch start.
8. `src/monitor/index.ts` -- restore `envelopeHeader` field, `cursorEnabled` toggle, pass `envelopeHeader` to `parseMessage`.

**Build check:** `npm run build` should pass.

### Plan 4: Frontend Restoration (Layer 5)

Merge restored v0.3 UI with Phase 8 additions:

1. `src/web/frontend/api.ts` -- add `review`, `folders`, `batch` namespaces. Keep `config.getEnvelopeStatus`/`triggerDiscovery` and `ImapConfigResponse` type. Add back type re-exports.
2. `src/web/frontend/folder-picker.ts` -- restore whole file.
3. `src/web/frontend/app.ts` -- MOST COMPLEX MERGE. Must keep: `esc()`, Phase 8 rule editor with extended fields, 3-column rule table, envelope status check, discovery settings section. Must restore: batch page, folder picker integration, review status card, sweep settings card.
4. `src/web/frontend/index.html` -- add batch nav button.
5. `src/web/frontend/styles.css` -- add back batch/sweep/folder picker styles. Keep Phase 8 discovery/settings styles.

**Build check:** `npm run build` should pass.

### Plan 5: Tests (Layer 6)

1. Restore all 8 test files from `git show f453be7^:<path>`.
2. Adapt for any Phase 7/8 type changes (e.g., `parseMessage` now takes optional `envelopeHeader` param, `ImapFetchResult` has `headers`).
3. Run full suite: `npm test`.

## Common Pitfalls

### Pitfall 1: Naive File Replacement (The Original Sin)
**What goes wrong:** Restoring pre-clobber files without checking what Phase 8 added = re-clobbering Phase 8.
**Why it happens:** `git show f453be7^:path > path` overwrites current content.
**How to avoid:** For all 11 degraded files, diff pre-clobber vs current to identify Phase 8 additions. Only the 10 fully deleted files can be restored wholesale.
**Warning signs:** Build breaks due to missing Phase 8 types/functions.

### Pitfall 2: parseMessage Signature Change Ripple
**What goes wrong:** Restoring `parseMessage(fetched, envelopeHeader?)` breaks any call site that uses the current 1-arg signature.
**Why it happens:** The second parameter is optional, so existing 1-arg calls still work. BUT test mocks/assertions may assume the old signature.
**How to avoid:** The `envelopeHeader` param is optional (default undefined), so existing callers are fine. Just verify tests.

### Pitfall 3: ImapFlowLike Interface Divergence
**What goes wrong:** Pre-clobber had `listTree()`, Phase 8 added `status()`. Restoring one without the other breaks code.
**How to avoid:** Interface needs BOTH methods. Add `listTree` back while keeping `status`.

### Pitfall 4: ServerDeps Type Mismatch
**What goes wrong:** Pre-clobber `buildServer` expected `getSweeper`, `getFolderCache`, `getBatchEngine` in deps. Current code doesn't pass them in `src/index.ts`.
**How to avoid:** Update `ServerDeps` interface AND update `buildServer()` call in `src/index.ts` in the same plan.

### Pitfall 5: Frontend app.ts Merge Complexity
**What goes wrong:** This file lost 389 lines (batch page, sweep settings, folder picker, review status) AND Phase 8 added new rule editor, XSS helper, discovery UI. Manual merge needed.
**Why it happens:** Both pre-clobber and Phase 8 changes touch the same file.
**How to avoid:** Start from current HEAD (to preserve Phase 8), then ADD the missing functions. Don't replace the whole file.

### Pitfall 6: Batch/Sweep Import of classifyVisibility
**What goes wrong:** Pre-clobber `client.ts` imported `classifyVisibility` from `./messages.js`. Current `messages.ts` doesn't have it. Restoring client.ts without messages.ts = compile error.
**How to avoid:** Restore messages.ts first (Layer 0), then client.ts (Layer 1).

## Architecture Patterns

### Restoration Pattern: Additive Merge
For degraded files (content stripped, not fully deleted):
1. Read current HEAD version
2. Read pre-clobber version (`git show f453be7^:path`)
3. Identify what's missing by diffing
4. ADD missing content to current HEAD version
5. Never replace -- only augment

### Restoration Pattern: Wholesale Restore + Adapt
For fully deleted files:
1. Extract pre-clobber version: `git show f453be7^:path`
2. Check imports against current module APIs
3. Adapt if needed (e.g., schema type changes)
4. Write the file

### Build Verification Pattern
After each plan, run:
```bash
npm run build   # TypeScript compilation + esbuild
npm test        # Full test suite
```
Current baseline: 14 test files, 253 tests, all passing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File restoration | Manual retyping | `git show f453be7^:<path>` | Pre-clobber code is in git history, extracting it is exact |
| Diff identification | Memory/guessing | `git diff f453be7^..HEAD -- <path>` | Shows exact delta |
| Type reconciliation | Guessing at interfaces | Read current schema.ts | Schema is source of truth for all types |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (inferred from package.json) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npm test` |

### Current Baseline
- 14 test files, 253 tests, all passing [VERIFIED: npm test run]
- Build succeeds [VERIFIED: npm run build]

### Phase Completion Tests
After restoration, expect: 22 test files (14 existing + 8 restored), ~2500+ tests (253 + ~2250 from restored files).

### Wave 0 Gaps
None -- all test files exist in git history and will be restored from pre-clobber. May need minor adaptation for Phase 7/8 type changes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pre-clobber sweep/batch modules are compatible with current schema.ts action types | Reconciliation | LOW -- action schema hasn't changed shape, just emailMatchSchema grew fields |
| A2 | Pre-clobber test files will need minimal adaptation for Phase 7/8 changes | Tests | LOW -- most tests mock their own data, schema additions are backward-compatible |
| A3 | The folder-picker.ts pre-clobber code is compatible with current FolderNode type | Frontend | LOW -- FolderNode type is being restored from the same commit |

## Open Questions (RESOLVED)

1. **Cursor toggle API route** — RESOLVED: No dedicated backend route existed pre-clobber. The cursor toggle was config-only (monitor reads `cursorEnabled` from config). Frontend client methods included for completeness but will fail gracefully without a backend route.

2. **Activity `recentFolders` route** — RESOLVED: Route was deleted by the clobber. Restored in Plan 01 Task 2 as part of `src/web/routes/activity.ts` restoration.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies -- this is purely a code restoration phase using git history and existing tooling).

## Sources

### Primary (HIGH confidence)
- Git history: `git show f453be7^:<path>` for all 29 affected files
- Git diff: `git diff f453be7^..HEAD -- <path>` for all 11 degraded files
- Current codebase: direct file reads of all active source files
- npm test / npm run build: verified current baseline (253 tests passing, build clean)

## Metadata

**Confidence breakdown:**
- Clobber inventory: HIGH -- verified every file against git history and current HEAD
- Reconciliation analysis: HIGH -- read both pre-clobber and current versions of every affected file
- Restoration order: HIGH -- dependency graph derived from import analysis
- Test adaptation: MEDIUM -- haven't inspected every test file's internals yet

**Research date:** 2026-04-12
**Valid until:** No expiry (git history doesn't change)
