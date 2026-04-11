---
phase: 03-batch-filing-engine
verified: 2026-04-08T19:22:42Z
status: human_needed
score: 3/4 must-haves verified
overrides_applied: 0
gaps: []
human_verification:
  - test: "Navigate to Batch page, select a folder with messages, run Preview Dry Run, verify grouped results appear with expandable message lists (From/Subject/Rule), then click Run Batch and confirm progress bar updates at 2-second intervals, then verify results summary after completion"
    expected: "Multi-step workflow completes: idle -> dry-run loading -> grouped preview -> executing with live progress bar -> results with Moved/Skipped/Errors stats"
    why_human: "Browser-rendered SPA workflow with real IMAP data cannot be verified programmatically"
  - test: "Navigate to Activity page after running a batch; verify batch-sourced entries show an amber [batch] badge"
    expected: "Activity entries with source='batch' display a styled amber badge distinct from the [sweep] badge"
    why_human: "Visual badge rendering and styling requires browser inspection"
  - test: "Start a batch on a large folder, click Cancel Batch during execution, verify the batch stops after the current chunk and the results view shows partial counts with 'Remaining: N messages not processed'"
    expected: "Cancel halts processing at chunk boundary; results page shows cancelled state with remaining count"
    why_human: "Cooperative cancellation timing and partial-results UI require live execution to verify"
---

# Phase 3: Batch Filing Engine Verification Report

**Phase Goal:** Users can apply rules retroactively to existing messages in any folder, with dry-run preview and cancellation
**Verified:** 2026-04-08T19:22:42Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BatchEngine evaluates all messages in a source folder against the full enabled ruleset | VERIFIED | `src/batch/index.ts`: `fetchAllMessages(sourceFolder)` + `evaluateRules(this.deps.rules, msg)` in both `dryRun()` and `execute()`. `evaluateRules` internally filters to enabled rules only (confirmed in `src/rules/evaluator.ts` line 13). 25 unit tests pass. |
| 2 | Dry-run evaluates rules and groups results by destination without executing IMAP moves | VERIFIED | `dryRun()` calls `evaluateRules()` only, groups into `groupMap` by `action:destination` key, returns `DryRunGroup[]`. No `executeAction()` call in dry-run path. BATC-06 covered. |
| 3 | Batch processing moves messages in chunks with per-message error isolation | VERIFIED | `CHUNK_SIZE = 25`, `setImmediate` yield between chunks (line 205), per-message try/catch increments `errors` counter without aborting the loop (lines 192-198). 25 unit tests confirm behavior. |
| 4 | User can cancel a running batch and it stops after the current chunk completes | VERIFIED (automated) / ? (human for UI) | `cancel()` sets `cancelRequested = true`; `execute()` checks the flag at the start of each chunk (line 165). State transitions to `cancelled`. Unit tests confirm. Browser-side cancel button and "Cancelling..." feedback requires human verification. |

**Score:** 3/4 truths verified (4th requires human confirmation of browser behavior)

**Note on BATC-01 / Roadmap SC #1:** The roadmap success criterion states "User can select a source folder and **one or more rules**." The implementation applies the full enabled ruleset with no per-rule selection UI. This was an explicit design decision: Context decision D-01 states "Apply entire ruleset to the source folder — no per-rule selection. Matches how Monitor already works." Since D-01 is documented and the phase plans all reference "full enabled ruleset," this deviation is intentional. The requirement BATC-01 text says "one, multiple, or all rules" — applying all rules satisfies "all rules." No gap is raised.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/batch/index.ts` | BatchEngine class with dryRun, execute, cancel, getState, updateRules | VERIFIED | 285 lines, all 7 required exports present, CHUNK_SIZE=25, setImmediate yield, 'batch' source tag |
| `test/unit/batch/engine.test.ts` | Unit tests (min 100 lines, 15+ test cases) | VERIFIED | 571 lines, 25 test cases, all pass |
| `src/web/routes/batch.ts` | Batch API route handlers (registerBatchRoutes) | VERIFIED | 61 lines, 4 endpoints, Zod validation, 409 conflict handling |
| `test/unit/web/batch.test.ts` | API route tests (min 50 lines, 6+ test cases) | VERIFIED | 173 lines, 9 test cases, all pass |
| `src/web/frontend/app.ts` | renderBatch() with full workflow state machine | VERIFIED | renderBatch, renderBatchIdle, renderBatchPreview, renderBatchExecuting, renderBatchResults all implemented (lines 454-759), batchPollTimer with clearApp cleanup |
| `src/web/frontend/api.ts` | Batch API client methods | VERIFIED | batch namespace with dryRun, execute, cancel, status methods; BatchStatusResponse/DryRunResponse types imported and re-exported |
| `src/web/frontend/index.html` | Batch nav button | VERIFIED | `<button class="nav-btn" data-page="batch">Batch</button>` present at line 17 |
| `src/web/frontend/styles.css` | Batch-specific CSS classes | VERIFIED | .progress-bar, .progress-bar-fill, .dry-run-group*, .badge-batch, .batch-counts, .loading-pulse, @keyframes pulse all present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/batch/index.ts` | `src/rules/evaluator.ts` | `evaluateRules(` call | WIRED | Line 3: import from `'../rules/index.js'`; lines 93, 175: called in both dryRun and execute |
| `src/batch/index.ts` | `src/actions/index.ts` | `executeAction(` call | WIRED | Line 4: import; line 184: called inside per-message try block in execute() |
| `src/batch/index.ts` | `src/imap/messages.ts` | `reviewMessageToEmailMessage(` call | WIRED | Line 2: import; lines 92, 174: called for each raw message |
| `src/web/routes/batch.ts` | `src/batch/index.ts` | `deps.getBatchEngine()` accessor | WIRED | Lines 16, 34, 53, 58: getBatchEngine() called in each handler |
| `src/web/server.ts` | `src/web/routes/batch.ts` | `registerBatchRoutes` | WIRED | Line 18: import; line 60: `registerBatchRoutes(app, deps)` called |
| `src/index.ts` | `src/batch/index.ts` | `new BatchEngine` | WIRED | Line 10: import; line 51: `new BatchEngine(...)` on startup; line 102: recreated on IMAP config change |
| `src/web/frontend/app.ts` | `src/web/frontend/api.ts` | `api.batch.*` calls | WIRED | Lines 458, 507, 527, 629, 675, 685: all four api.batch methods called |
| `src/web/frontend/app.ts` | `src/web/frontend/folder-picker.ts` | `renderFolderPicker` | WIRED | Line 3: import; line 493: called in renderBatchIdle |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/batch/index.ts` dryRun() | `messages` array | `client.fetchAllMessages(sourceFolder)` — live IMAP call | Yes (IMAP data, mock in tests) | FLOWING |
| `src/batch/index.ts` execute() | `messages` array | `client.fetchAllMessages(sourceFolder)` — live IMAP call | Yes | FLOWING |
| `src/web/frontend/app.ts` renderBatchPreview | `groups: DryRunGroup[]` | `api.batch.dryRun(folder)` -> POST /api/batch/dry-run -> BatchEngine.dryRun() | Yes, real API response | FLOWING |
| `src/web/frontend/app.ts` renderBatchExecuting | `state: BatchStatusResponse` | `api.batch.status()` + setInterval polling | Yes, live engine state | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BatchEngine exports all required types | `node -e "const m = require('./src/batch/index.ts'); console.log(typeof m.BatchEngine)"` | N/A — TypeScript source, not directly runnable | SKIP (TS compile-check covered by tests) |
| Batch API test suite passes | `npx vitest run test/unit/batch/engine.test.ts` | 25 passed, 0 failed | PASS |
| Batch route test suite passes | `npx vitest run test/unit/web/batch.test.ts` | 9 passed, 0 failed | PASS |
| Activity log batch source tests pass | `npx vitest run test/unit/log/activity.test.ts` | 25 passed, 0 failed | PASS |
| Full test suite green | `npx vitest run` | 322 passed, 18 test files, 0 failed | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BATC-01 | 03-01, 03-02, 03-03 | User can batch-file messages in a selected source folder against rules | SATISFIED (all enabled rules; per-rule selection explicitly deferred by D-01) | BatchEngine.execute() processes all enabled rules; frontend folder picker wired to execution flow |
| BATC-02 | 03-01 | First-match-wins rule matching without age constraints | SATISFIED | evaluateRules() used directly; no isEligibleForSweep or age checks in BatchEngine; dedicated unit test verifies first-match-wins with no age filtering |
| BATC-03 | 03-01, 03-02 | Chunked IMAP moves with per-message error isolation | SATISFIED | CHUNK_SIZE=25, setImmediate yield, per-message try/catch, errors counter; tests confirm 60-message chunking and error isolation |
| BATC-05 | 03-01, 03-02, 03-03 | User can cancel a running batch | SATISFIED (automated) / ? (UI) | cancel() sets cancelRequested flag; execute() checks between chunks; UI cancel button in renderBatchExecuting; human verification needed for browser behavior |
| BATC-06 | 03-01, 03-02, 03-03 | Dry-run mode previews what batch would do | SATISFIED (automated) / ? (UI) | dryRun() groups results without executing moves; renderBatchPreview shows grouped expandable results; human verification needed for browser rendering |
| BATC-04 | NOT in Phase 3 | Real-time SSE progress | DEFERRED — assigned to Phase 4 | REQUIREMENTS.md traceability table confirms Phase 4 |
| BATC-07 | NOT in Phase 3 | Batch summary report | DEFERRED — assigned to Phase 4 | REQUIREMENTS.md traceability table confirms Phase 4. Note: basic counts summary IS shown in renderBatchResults, but the Phase 4 requirement specifies "by destination" granularity |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/web/frontend/app.ts` | 519, 538, 643, 706 | `app.innerHTML = ''` | Info | Used to clear container before re-rendering — standard SPA pattern, not a stub |
| `src/batch/index.ts` | 276 | `this.state.completedAt!` non-null assertion | Info | Acceptable: completedAt is always set in the finally block before buildResult() returns |

No blocker or warning anti-patterns found. The batch section of app.ts uses `textContent` and `createTextNode` for all user-supplied content (message from, subject, folder names) — XSS prevention is correctly implemented.

### Human Verification Required

#### 1. Batch Workflow End-to-End

**Test:** Start the app (`npm start`), open http://localhost:3000, click "Batch" in the nav. Select a folder with existing messages, click "Preview Dry Run."
**Expected:** Loading pulse animation appears briefly, then grouped results render with destination folder names and message counts. Clicking a group header expands to show a table of From/Subject/Rule for each message.
**Why human:** DOM-rendered SPA with real IMAP data; visual layout and interaction cannot be verified programmatically.

#### 2. Batch Execution Progress Polling

**Test:** From the dry-run preview, click "Run Batch." Observe the executing view.
**Expected:** Progress bar animates, "X of Y messages processed" text updates every 2 seconds, Moved/Skipped/Errors counts increment. After completion, results summary shows final counts with status badge (green for completed).
**Why human:** Live polling with real IMAP execution; progress bar rendering and timing require browser observation.

#### 3. Activity Log Batch Badge

**Test:** After running a batch, navigate to the Activity page.
**Expected:** Entries originating from the batch display an amber `[batch]` badge (`.badge-batch` class) in the rule column, visually distinct from the `[sweep]` badge.
**Why human:** Visual badge rendering and amber color styling require browser inspection.

#### 4. Batch Cancellation UI

**Test:** Start a batch on a folder with many messages, click "Cancel Batch" during execution.
**Expected:** Button changes to "Cancelling..." and becomes disabled. After the current chunk finishes, the results page renders with "Batch Cancelled" heading and "Remaining: N messages not processed" line.
**Why human:** Cooperative cancellation timing and partial-results state require live execution with real IMAP data.

### Gaps Summary

No automated gaps found. All artifacts exist, are substantive, and are properly wired. All 322 tests pass including 25 BatchEngine unit tests, 9 batch route tests, and 25 activity log tests. The phase is pending human browser verification of the frontend workflow.

---

_Verified: 2026-04-08T19:22:42Z_
_Verifier: Claude (gsd-verifier)_
