# v0.2 Work Breakdown Structure — Two-Stream Intake

## A. Config Schema (`src/config/schema.ts`, `src/shared/types.ts`)

| # | Task |
|---|------|
| A1 | Add `reviewActionSchema` (`{ type: "review", folder?: z.string().min(1) }`) to the action discriminated union |
| A2 | Add `skipActionSchema` (`{ type: "skip" }`) to the action discriminated union |
| A3 | Add `deleteActionSchema` (`{ type: "delete" }`) to the action discriminated union |
| A4 | Create `sweepConfigSchema` (intervalHours, readMaxAgeDays, unreadMaxAgeDays — all positive int, all with defaults) |
| A5 | Create `reviewConfigSchema` (folder, defaultArchiveFolder, trashFolder, sweep — all optional with defaults) |
| A6 | Add `review: reviewConfigSchema.default({})` to `configSchema` |
| A7 | Export new types: `ReviewAction`, `SkipAction`, `DeleteAction`, `ReviewConfig`, `SweepConfig` |
| A8 | Add `source: string` field to `ActivityEntry` in `src/shared/types.ts` |
| A9 | Add `ReviewStatusResponse` interface to `src/shared/types.ts` |
| A10 | Write unit tests for new action schemas (review with/without folder, empty string rejection, skip, delete, backward compat) |
| A11 | Write unit tests for review config schema (defaults, partial overrides, absent section) |

## B. IMAP Client (`src/imap/client.ts`)

| # | Task |
|---|------|
| B1 | Parameterize `withMailboxLock` to accept a `folder: string` argument; update all existing callers to pass `'INBOX'` |
| B2 | Add `sourceFolder` parameter to `moveMessage` (default `'INBOX'`); pass it to `withMailboxLock` |
| B3 | Add `list` to the `ImapFlowLike` interface |
| B4 | Implement `getSpecialUseFolder(use: string)` with connection-lifetime caching |
| B5 | Create `ReviewMessage` type and `reviewMessageToEmailMessage` converter in `src/imap/messages.ts` |
| B6 | Implement `fetchMessagesRaw(range, query)` — low-level fetch that assumes mailbox already selected |
| B7 | Implement `fetchAllMessages(folder)` — acquires lock, calls `fetchMessagesRaw`, returns `ReviewMessage[]` |
| B8 | Implement `withMailboxSwitch(folder, fn)` — pause IDLE, lock target folder, execute, reopen INBOX, resume IDLE |
| B9 | Write unit tests for `reviewMessageToEmailMessage` conversion |
| B10 | Write unit tests for `getSpecialUseFolder` (found, not found, caching) |
| B11 | Write integration tests for `withMailboxSwitch` (IDLE pause/resume, mailbox reopen) |

## C. Database & Activity Log (`src/log/index.ts`)

| # | Task |
|---|------|
| C1 | Add `ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'arrival'` migration in constructor (idempotent try/catch) |
| C2 | Update `logActivity` signature to accept `rule: Rule | null` and `source: 'arrival' | 'sweep'` |
| C3 | Update INSERT statement to include `source`; handle null `rule` (null `rule_id`, `rule_name`) |
| C4 | Update existing `logActivity` callers to pass `'arrival'` as source |
| C5 | Write unit tests for source column migration (fresh DB, existing DB without column) |
| C6 | Write unit tests for `logActivity` with sweep source and null rule |

## D. Action Execution (`src/actions/index.ts`)

| # | Task |
|---|------|
| D1 | Define `ActionContext` interface (`client`, `reviewFolder`, `trashFolder`) |
| D2 | Refactor `executeAction` signature to accept `ActionContext` instead of positional params |
| D3 | Add `case 'review'` — call `executeMove` with `ctx.reviewFolder`, set `action: 'review'` on result |
| D4 | Add `case 'skip'` — return success immediately, no IMAP call, no folder |
| D5 | Add `case 'delete'` — call `executeMove` with `ctx.trashFolder`, set `action: 'delete'` on result |
| D6 | Update existing callers of `executeAction` to pass `ActionContext` |
| D7 | Write unit tests for skip (no IMAP calls), review (moves to review folder), delete (moves to trash) |

## E. ReviewSweeper (`src/sweep/index.ts` — new file)

| # | Task |
|---|------|
| E1 | Create `SweepDeps` and `SweepState` interfaces |
| E2 | Implement `isEligibleForSweep(message, config, now)` pure function |
| E3 | Implement `resolveSweepDestination(message, rules, defaultArchiveFolder)` pure function (3-step resolution: move/delete rule match → review rule folder → global default; skip rules filtered out) |
| E4 | Implement `ReviewSweeper` class constructor and `getState()` |
| E5 | Implement `start()` — 30s initial delay, then repeating timer at `intervalHours` |
| E6 | Implement `stop()` and `restart()` |
| E7 | Implement `runSweep()` — fetch Review contents via `withMailboxSwitch`, evaluate eligibility, resolve destinations, execute moves, log with `source: 'sweep'`, update cached state |
| E8 | Add serialization guard to `runSweep` (skip cycle if already running) |
| E9 | Add error handling — connection-down skip, per-message-failure continue |
| E10 | Write unit tests for `isEligibleForSweep` (read/unread thresholds, boundary cases) |
| E11 | Write unit tests for `resolveSweepDestination` (move match, delete match, review-with-folder, review-without-folder, skip filtered, no match, priority ordering) |
| E12 | Write integration tests for sweep lifecycle (timer fire → fetch → move → log) |
| E13 | Write integration test for sweep serialization (concurrent skip) |
| E14 | Write integration test for sweep with empty Review folder |

## F. Monitor Changes (`src/monitor/index.ts`)

| # | Task |
|---|------|
| F1 | Add `reviewFolder` and `trashFolder` fields to Monitor |
| F2 | Add trash folder resolution in `start()` — `getSpecialUseFolder('\\Trash')` with fallback |
| F3 | Update `processMessage` to build `ActionContext` and pass to `executeAction` |
| F4 | Update `logActivity` call to pass `'arrival'` as source |
| F5 | Write integration tests for new action types through Monitor (review→Review folder, skip→stays in INBOX, delete→Trash) |

## G. Config Repository (`src/config/repository.ts`)

| # | Task |
|---|------|
| G1 | Add `getReviewConfig()` accessor |
| G2 | Add `updateReviewConfig(input)` — merge, validate, persist |
| G3 | Add `onReviewConfigChange` listener pattern (same shape as existing IMAP change listener) |
| G4 | Write unit tests for `updateReviewConfig` (merge, validation, listener notification) |

## H. App Wiring (`src/index.ts`)

| # | Task |
|---|------|
| H1 | Create `ReviewSweeper` instance after Monitor, with resolved trash folder |
| H2 | Register `onReviewConfigChange` listener to call `sweeper.restart()` |
| H3 | Update `onImapConfigChange` handler to stop/rebuild sweeper alongside monitor |
| H4 | Start sweeper after monitor; stop on shutdown |
| H5 | Pass sweeper to `buildServer` |

## I. API Routes

| # | Task |
|---|------|
| I1 | Create `src/web/routes/review.ts` — `GET /api/review/status` from `sweeper.getState()` |
| I2 | Create `src/web/routes/review-config.ts` — `GET /api/config/review` passthrough |
| I3 | Add `PUT /api/config/review` — validate, call `updateReviewConfig`, return updated config |
| I4 | Update `ServerDeps` in `src/web/server.ts` to include `sweeper: ReviewSweeper` |
| I5 | Register new routes in `buildServer` |
| I6 | Write tests for `GET /api/review/status` (correct shape, nulls before first sweep) |
| I7 | Write tests for `GET/PUT /api/config/review` (defaults, update triggers restart) |
| I8 | Write test that rule CRUD accepts all four action types |
| I9 | Write test that activity endpoint returns `source` field |

## J. Frontend API Client (`src/web/frontend/api.ts`)

| # | Task |
|---|------|
| J1 | Add `review.status()` — `GET /api/review/status` |
| J2 | Add `config.getReview()` — `GET /api/config/review` |
| J3 | Add `config.updateReview(cfg)` — `PUT /api/config/review` |

## K. Frontend UI (`src/web/frontend/app.ts`)

| # | Task |
|---|------|
| K1 | Rule modal: replace hardcoded move action with action type dropdown (Archive to folder / Route to Review / Leave in Inbox / Delete) |
| K2 | Rule modal: implement folder field visibility logic (show/hide + required/optional based on action type) |
| K3 | Rule modal: update save handler to build correct action object per type |
| K4 | Rule modal: update edit mode to populate action type dropdown and folder from existing rule |
| K5 | Rules table: update action display column (→ folder, → Review, → Review → archive, — Inbox, ✕ Delete) |
| K6 | Activity table: add `[sweep]` badge for sweep-sourced entries |
| K7 | Activity table: update action column display for new action types (— Inbox for skip, ✕ Trash for delete) |
| K8 | Settings page: add Review status panel — folder stats, next sweep countdown, last sweep results |
| K9 | Settings page: display current sweep settings (read-only minimum, editable stretch goal) |

---

**Total: 68 tasks** across 11 work areas.

**Dependency order:** A → B/C/D (parallel) → E → F/G → H → I/J → K (many tasks within each group can be parallelized).
