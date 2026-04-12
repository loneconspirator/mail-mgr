---
created: "2026-04-12T18:30:15.692Z"
title: Restore all features wiped by Phase 7 clobber (f453be7)
area: general
files:
  - src/sweep/index.ts
  - src/batch/index.ts
  - src/folders/cache.ts
  - src/folders/index.ts
  - src/log/migrations.ts
  - src/web/frontend/folder-picker.ts
  - src/web/frontend/app.ts
  - src/web/frontend/api.ts
  - src/web/frontend/index.html
  - src/web/frontend/styles.css
  - src/web/routes/batch.ts
  - src/web/routes/folders.ts
  - src/web/routes/review-config.ts
  - src/web/routes/review.ts
  - src/web/server.ts
  - src/web/routes/rules.ts
  - src/index.ts
  - src/imap/client.ts
  - src/shared/types.ts
  - src/config/repository.ts
  - src/monitor/index.ts
---

## Problem

Commit `f453be7` (Phase 07-01, `feat(07-01): extend emailMatchSchema with deliveredTo, visibility, readStatus`) did a wholesale file replacement across the codebase instead of surgical edits. It deleted 10 source files, 8 test files, and stripped significant content from 11 more. This wiped out essentially all of v0.3's features. The partial "restore" commit `c7ea8c7` only fixed trivial issues.

**Last known good state:** `f453be7^` (parent of the clobber commit).

### Entire modules deleted (still missing)

| File | Feature |
|------|---------|
| `src/sweep/index.ts` | ReviewSweeper — periodic review folder cleanup |
| `src/batch/index.ts` | BatchEngine — retroactive rule application |
| `src/folders/cache.ts` | Folder cache for IMAP folder tree |
| `src/folders/index.ts` | Folder module barrel export |
| `src/log/migrations.ts` | SQLite schema migrations |
| `src/web/frontend/folder-picker.ts` | Tree-based folder picker component |
| `src/web/routes/batch.ts` | Batch API routes |
| `src/web/routes/folders.ts` | Folder tree API route |
| `src/web/routes/review-config.ts` | Review config API route |
| `src/web/routes/review.ts` | Review status API route |

### Test files deleted (still missing)

| File | Covers |
|------|--------|
| `test/integration/sweep.test.ts` | Sweep integration |
| `test/unit/batch/engine.test.ts` | BatchEngine |
| `test/unit/folders/cache.test.ts` | FolderCache |
| `test/unit/log/migrations.test.ts` | DB migrations |
| `test/unit/sweep/sweep.test.ts` | ReviewSweeper |
| `test/unit/web/batch.test.ts` | Batch routes |
| `test/unit/web/folder-picker.test.ts` | Folder picker |
| `test/unit/web/folders.test.ts` | Folder routes |

### Source files still degraded (content stripped, never restored)

| File | Lines lost | What's missing |
|------|-----------|----------------|
| `src/index.ts` | 102 | ReviewSweeper wiring, BatchEngine creation, FolderCache init, review config change listener, sweeper restart on IMAP config change |
| `src/imap/client.ts` | 80 | `getHeaderFields()`, envelope header fetching in queries, `parseHeaderLines`/`classifyVisibility` integration, `envelopeRecipient`/`visibility` on parsed messages |
| `src/shared/types.ts` | 48 | `FolderNode`, `FolderTreeResponse`, `DryRunMessage`, `DryRunGroup`, `BatchStatusResponse`, `ReviewStatusResponse` |
| `src/config/repository.ts` | 24 | `getReviewConfig()`, `updateReviewConfig()`, `onReviewConfigChange()` |
| `src/web/frontend/api.ts` | 15 | `review` namespace, `folders.tree()`, batch API methods, missing type exports |
| `src/web/frontend/app.ts` | 398 | Batch page, folder picker, review status card, sweep settings card, activity badges |
| `src/web/frontend/styles.css` | 94 | Batch UI styles, sweep badges, folder picker styles |
| `src/web/server.ts` | 12 | Review/batch/folder route registration, sweeper/folder/batch deps |
| `src/web/routes/rules.ts` | 17 | Folder existence warnings on rule create/update |
| `src/monitor/index.ts` | 15 | `envelopeHeader` usage in message parsing, cursor persistence toggle |
| `src/web/frontend/index.html` | 1 | Batch nav button |

## Solution

Restore from `git show f453be7^:<path>` for each file, adapting for Phase 08 additions (deliveredTo, visibility, readStatus matchers; envelope discovery; all action types in rule editor).

Suggested order (dependencies flow downward):

1. **Types & schema:** `src/shared/types.ts` — restore missing interfaces
2. **Config layer:** `src/config/repository.ts` — restore review config methods
3. **IMAP layer:** `src/imap/client.ts` — restore envelope header fetching + visibility
4. **Monitor:** `src/monitor/index.ts` — restore envelope + cursor logic
5. **Core modules:** `src/sweep/index.ts`, `src/batch/index.ts`, `src/folders/cache.ts`, `src/log/migrations.ts`
6. **Web routes:** `src/web/routes/review.ts`, `review-config.ts`, `folders.ts`, `batch.ts`, `rules.ts` warnings
7. **Server wiring:** `src/web/server.ts` — register all routes, add deps
8. **Main entry:** `src/index.ts` — wire sweeper, batch engine, folder cache
9. **Frontend API:** `src/web/frontend/api.ts` — restore review/batch/folder methods
10. **Frontend UI:** `src/web/frontend/app.ts` — batch page, folder picker, settings cards, badges
11. **Frontend assets:** `index.html` nav button, `styles.css` missing styles, `folder-picker.ts`
12. **Tests:** Restore all 8 deleted test files
13. **Build & verify**
