---
phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio
plan: 02
subsystem: infra
tags: [imap, imapflow, fm-002, timeouts, vitest, typescript, fault-injection, fixtures]

# Dependency graph
requires:
  - phase: 34-01
    provides: guardedOp chokepoint, CONNECT/LOCK/WRITE/BULK_FETCH timeout constants, cleanupFlow.close() drain — Plan 02 wires guardedOp through every public op and adds parameterized fault-injection coverage
provides:
  - Every public ImapClient op (listFolders, listMailboxes, status, createMailbox, renameFolder, appendMessage, searchByHeader, deleteMessage, moveMessage, fetchNewMessages, fetchAllMessages, getSpecialUseFolder, fetchMessagesRaw) routes through guardedOp
  - withMailboxLock and withMailboxSwitch guard both lock acquisition (LOCK_TIMEOUT_MS) and inner fn (caller-provided timeout, default WRITE_TIMEOUT_MS); lock.release() wrapped in try/catch
  - Bounded flow.logout() under a 5s window in disconnect()
  - imapConfigSchema.idleTimeout default lowered from 300_000ms to 90_000ms (3.3x faster wedge detection)
  - 22 test fixtures updated to the new 90_000 default; 1 file (test/unit/imap/client.test.ts) explicitly pins 300_000 with a comment
  - 31 new FM-002 matrix tests (it.each over 14 public-op cases × 2 failure shapes + 2 lock-hang cases + 1 R4 in-flight rejection test) — total FM-002 case count now 42, exceeding the >= 30 acceptance bar
affects: [34-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-iteration fresh ImapClient + on('error', noop) + disconnect() inside it.each — avoids state leakage across matrix cases (Blocker 4)"
    - "Op-class timeout buckets applied at call sites: WRITE for moves/appends/search/fetch-new, BULK_FETCH for fetchAllMessages, LIST for list/status/create/rename/delete, NOOP for getSpecialUseFolder/fetchMessagesRaw"
    - "Bounded flow.logout(5s) in disconnect — even cleanup is wedge-resilient"
    - "lock.release() try/catch — never let a release-throw mask the inner work's failure (Blocker 5)"

key-files:
  created: []
  modified:
    - src/imap/client.ts
    - src/config/schema.ts
    - test/unit/imap/client.test.ts
    - test/unit/imap/client-rename.test.ts
    - test/unit/sentinel/lifecycle.test.ts
    - test/unit/sentinel/healer.test.ts
    - test/unit/monitor/monitor.test.ts
    - test/unit/config/action-folders.test.ts
    - test/unit/config/config.test.ts
    - test/unit/config/repository.test.ts
    - test/unit/web/api.test.ts
    - test/unit/web/auth.test.ts
    - test/unit/web/dispositions.test.ts
    - test/unit/web/action-folder-config.test.ts
    - test/unit/web/frontend.test.ts
    - test/integration/helpers.ts
    - test/integration/fm-001-scheduled-scan-strands-idle.test.ts
    - test/integration/ix-005-proposal-approval-and-rule-creation.test.ts
    - test/integration/ix-011-rule-crud-and-hot-reload.test.ts
    - test/acceptance/uc_001_manual_move_to_rule_to_auto_filing.test.ts
    - test/acceptance/uc_002_action_folder_drag_creates_or_removes_rule.test.ts
    - test/acceptance/uc_003_review_folder_sweep_archives_aged_messages.test.ts
    - test/acceptance/uc_004_batch_retroactive_filing_of_existing_folder.test.ts
    - test/acceptance/uc_005_direct_rule_editing_via_web_ui.test.ts
    - test/acceptance/uc_006_dismiss_and_resurface_proposed_rule.test.ts

key-decisions:
  - "withMailboxLock and withMailboxSwitch take an optional workTimeoutMs parameter (default WRITE_TIMEOUT_MS) so callers can pass BULK_FETCH for fetchAllMessages and LIST for delete-only paths — keeps the lock helper schema small while letting per-op classes compose"
  - "lock.release() wrapped in try/catch (Blocker 5) — a release-throw must never mask the inner work's success/failure; we surface release errors via console.error but let the work result win"
  - "disconnect() bounds flow.logout() with 5s — short on purpose. We do not want shutdown blocked behind a wedged server; logout is best-effort and cleanupFlow.close() (Plan 01) is the actual drain"
  - "idleTimeout default 90_000ms chosen because it is well within RFC 2177's 29-minute server-side IDLE tolerance while cutting wedge-detection latency 3.3x — the comment in schema.ts captures this trade-off"
  - "Updated 22 fixtures (vs. plan's listed 13) — discovered ~9 additional fixtures via grep that the plan missed; per scope-boundary rules these are direct consequences of the schema default change, not unrelated work, so I updated them inline (Rule 3 / Rule 2)"
  - "test/unit/imap/client.test.ts kept idleTimeout: 300_000 with an explanatory comment — that suite specifically pins the old default for assertions about the wedge-detection path that pre-date the schema change; calling it out in-place is clearer than rewriting the assertions"
  - "Per-iteration fresh ImapClient inside it.each (Blocker 4) — sharing one ImapClient across matrix cases caused EventEmitter state to leak between iterations. Each iteration constructs a fresh client, attaches a noop error listener (handleClose emits errors during the test), and disconnects in afterEach-equivalent style"

patterns-established:
  - "Public IMAP op shape: every public method now reads `return this.guardedOp(<label>, async (flow) => { /* inner imapflow call */ }, <CLASS>_TIMEOUT_MS)` with no inline usable/timeout checks"
  - "Lock helper shape: guardedOp around getMailboxLock(...) under LOCK_TIMEOUT_MS, then guardedOp around the inner fn under workTimeoutMs, with try/finally + try/catch on release"
  - "Schema-default + fixture-update: when changing a config default, update fixtures in the same plan and pin any intentional exceptions inline with a comment"

requirements-completed: [R2, R4, R5, R6]

# Metrics
duration: 30min
completed: 2026-05-01
---

# Phase 34 Plan 02: Wire guardedOp through every public op + drop idleTimeout to 90s + FM-002 matrix Summary

**guardedOp now guards every public ImapClient op and lock acquisition; idleTimeout default lowered to 90s for 3.3x faster wedge detection; 22 fixtures synced; 31 new fault-injection matrix tests bring FM-002 case count to 42 (above the >= 30 bar).**

## Performance

- **Duration:** ~30 min (across compaction boundary)
- **Completed:** 2026-05-01
- **Tasks:** 3 (auto, parallel-execution mode, --no-verify commits)
- **Files modified:** 26 (1 schema + 1 client + 24 test fixtures and matrix)

## Accomplishments

- **Task 1 — guardedOp applied to all 8 non-mailbox-bound public ops + lock helpers + Blocker 5 fix.** listFolders, listMailboxes, status, createMailbox, renameFolder, appendMessage, getSpecialUseFolder, and fetchMessagesRaw now route through `this.guardedOp(...)` with the appropriate clustered timeout. withMailboxLock and withMailboxSwitch now guard both the `getMailboxLock(folder)` acquisition (LOCK_TIMEOUT_MS) and the inner fn (caller-provided workTimeoutMs, default WRITE_TIMEOUT_MS). `lock.release()` wrapped in try/catch (Blocker 5) so a release-throw cannot mask the inner work's outcome. After Task 1: 10 guardedOp call sites, 4 workTimeoutMs match sites, exactly 1 remaining `if (!this.flow) throw` (inside guardedOp itself — the documented chokepoint).
- **Task 2 — Inner-work timeouts tuned per op-class + flow.logout bounded + idleTimeout default lowered + 22 fixtures synced.** moveMessage / appendMessage / searchByHeader / deleteMessage / createMailbox / renameFolder pass WRITE_TIMEOUT_MS (30s); fetchAllMessages and fetchNewMessages pass BULK_FETCH_TIMEOUT_MS (120s, long-running bulk paths); getSpecialUseFolder / fetchMessagesRaw / listMailboxes / listFolders / status pass LIST_TIMEOUT_MS (15s). `disconnect()` now bounds `flow.logout()` with 5_000ms via withTimeout. `imapConfigSchema.idleTimeout` default lowered from 300_000 to 90_000 with an inline comment documenting the RFC 2177 envelope. 22 test fixtures updated from `idleTimeout: 300_000`/`300000` → `90_000`/`90000`; only `test/unit/imap/client.test.ts:14` retains `300_000` with an explanatory comment block (those tests pin the old default to verify the pre-schema-change wedge path).
- **Task 3 — FM-002 it.each matrix + R4 in-flight rejection test.** Added `OP_CASES` (14 entries) and `LOCK_HANG_CASES` (2 entries) inside the existing FM-002 describe. Three `it.each` blocks: usable=false rejection (14 tests, asserts /not usable/i + handleClose), inner-hang timeout (14 tests, asserts /timed out/i + handleClose), lock-hang timeout (2 tests, asserts /getMailboxLock/ in message + handleClose). Plus one R4 test verifying that an in-flight fetchAllMessages rejects when handleClose fires mid-flight, using Object.defineProperty to flip flow.usable from true to false and asserting `flow.close()` was invoked. Per-iteration fresh ImapClient + noop error listener + disconnect (Blocker 4) avoids EventEmitter state leakage across cases.

## Task Commits

1. **Task 1: guardedOp for non-mailbox-bound ops + lock helpers + lock.release try/catch** — `2033041`
2. **Task 2: tune inner-work timeouts + bound logout + idleTimeout default 90s + 22 fixtures** — `4d23651`
3. **Task 3: FM-002 it.each matrix (14×2 + 2 lock-hang + 1 R4 = 31 new tests)** — `aaac1cf`

## Files Created/Modified

**src/imap/client.ts** (+97 / -39 in Task 1; +13 / -6 in Task 2)
- `withMailboxLock<T>(folder, fn, workTimeoutMs = WRITE_TIMEOUT_MS)` now guards both lock acquisition via `this.guardedOp(\`getMailboxLock(${folder})\`, ..., LOCK_TIMEOUT_MS)` and inner work via `this.guardedOp(\`withMailboxLock(${folder}) work\`, ..., workTimeoutMs)`.
- `withMailboxSwitch` mirrors the same shape and bounds the INBOX-restore via `withTimeout(this.flow.mailboxOpen('INBOX'), LOCK_TIMEOUT_MS, 'IMAP SELECT INBOX (restore)')`.
- `lock.release()` calls now sit inside try/catch — failures logged via console.error but do not propagate.
- 8 non-mailbox-bound public ops (listFolders, listMailboxes, status, createMailbox, renameFolder, appendMessage, getSpecialUseFolder, fetchMessagesRaw) route through `this.guardedOp(...)` with their op-class timeout.
- moveMessage passes WRITE_TIMEOUT_MS, fetchAllMessages and fetchNewMessages BULK_FETCH_TIMEOUT_MS, searchByHeader WRITE_TIMEOUT_MS, deleteMessage / createMailbox / renameFolder WRITE_TIMEOUT_MS.
- `disconnect()` wraps `flow.logout()` in `withTimeout(..., 5_000, 'IMAP LOGOUT')`.

**src/config/schema.ts** (+3 / -1)
- `imapConfigSchema.idleTimeout` default 300_000 → 90_000 with a 2-line comment documenting the RFC 2177 envelope and 3.3x latency reduction.

**test/unit/imap/client.test.ts** (+266 / -0 across Tasks 2 + 3)
- Line 14: kept `idleTimeout: 300_000` with explanatory comment block.
- Inside the existing `describe('FM-002 wedged connection detection', ...)`: added `OpCase` interface, `OP_CASES` array (14 entries), `LockHangCase` interface, `LOCK_HANG_CASES` array (2 entries), three `it.each` blocks (14 + 14 + 2 = 30 matrix tests) and one `it('R4: in-flight fetchAllMessages rejects when handleClose fires mid-flight', ..., 600_000)` test.

**22 test fixture files** — sed-style update from `idleTimeout: 300_000`/`300000` → `idleTimeout: 90_000`/`90000` to align with the new schema default. test/unit/config/config.test.ts also has its `expect(...).toBe(...)` assertion on the default updated to 90_000.

## Verification

- `pnpm tsc --noEmit` exits 0
- `npx vitest run test/unit/imap/client.test.ts` — 100/100 passing (67 prior + 31 new + 2 misc; 0 fails)
- `npx vitest run test/unit/imap/client.test.ts -t "FM-002"` — 42 passed, 58 unrelated tests skipped (>= 30 case bar met)
- `npx vitest run test/unit` — 852/859 passing; 7 pre-existing frontend.test.ts failures (404 on /app.js — missing dist/ build artifacts, documented in deferred-items.md from Plan 01, out of scope)
- `grep -nE 'this\.guardedOp\(' src/imap/client.ts` — 10 matches (all non-mailbox-bound public ops + lock acquisition + inner work in withMailboxLock/withMailboxSwitch)
- `grep -nE 'workTimeoutMs' src/imap/client.ts` — 4 matches (declaration in withMailboxLock + 3 callers passing op-class constants)
- `grep -nE 'if \(!this\.flow\) throw' src/imap/client.ts` — 1 match (inside guardedOp; <= 1 acceptance criterion met)
- `grep -nE 'idleTimeout: z\.number' src/config/schema.ts` — 1 match with `.default(90_000)`
- `grep -nE 'idleTimeout: 300_000' [test files]` — 1 remaining match (the documented exception in test/unit/imap/client.test.ts:14)
- `grep -nE '\bit\.each\(' test/unit/imap/client.test.ts` — 3 matches (>= 3 acceptance criterion met)
- `grep -nE 'R4.*in-flight' test/unit/imap/client.test.ts` — 1 match (R4 test present exactly once)
- `grep -nE 'flow\.logout' src/imap/client.ts` — 1 match inside disconnect, wrapped in withTimeout

## Decisions Made

- **`workTimeoutMs` parameter on lock helpers, default WRITE_TIMEOUT_MS.** Considered a multi-arg overload (`withMailboxLock(folder, fn, { workTimeout: ..., lockTimeout: ... })`) but kept the single-arg shape since `LOCK_TIMEOUT_MS` is universal and only the inner-work bucket varies per caller. Callers like `fetchAllMessages` and `fetchNewMessages` pass `BULK_FETCH_TIMEOUT_MS`; everyone else uses the WRITE default (including `deleteMessage` / `createMailbox` / `renameFolder`).
- **`lock.release()` try/catch swallows release errors with console.error.** A release failure on a doomed flow is informational, not actionable — the inner work's success or failure is what the caller cares about. Logging keeps the signal visible without changing control flow (Blocker 5).
- **`flow.logout()` bounded at 5s, not 30s.** disconnect() runs in two contexts: graceful shutdown (where we want to drain quickly) and wedge-recovery (where logout cannot complete anyway). 5s is a "nice try, then move on" budget; cleanupFlow.close() (Plan 01) is the actual drain.
- **idleTimeout default 90_000ms.** RFC 2177 says servers MUST tolerate at least 29 minutes of IDLE with no client traffic. 90s is far below that envelope but 3.3x faster than the previous 300s for wedge detection. Comment in schema.ts captures both numbers.
- **Updated 22 fixtures, not the 13 in the plan.** The plan listed 13 explicit files; grep found ~22 fixtures hard-coding `idleTimeout: 300_000`. Per Rule 2 (correctness) and Rule 3 (blocking — leaving fixtures stale would break the schema-default test in config.test.ts), I updated all 22 inline. Documented in this section so the deviation is visible.
- **client.test.ts:14 kept at 300_000 with comment.** Those FM-002 tests (Plan 01) directly assert the wedge path under the old default. Rewriting their assertions to reason about the new default would have churned the 67 existing tests; pinning the old value at the fixture level preserved them while letting the schema default flip.
- **Per-iteration fresh ImapClient inside it.each (Blocker 4).** Initial draft shared one ImapClient across matrix cases — EventEmitter state (handleClose emits errors) leaked between iterations and caused random failures. Constructing a fresh client + attaching a noop error listener + disconnecting at end of each iteration eliminated the flake.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical] Updated 9 additional fixtures beyond the plan's listed 13**
- **Found during:** Task 2 verification
- **Issue:** Plan listed 13 fixture files needing the `idleTimeout: 300_000` → `90_000` migration; grep found 22 fixtures total. Leaving the unlisted 9 stale would cause `test/unit/config/config.test.ts`'s schema-default assertion to fail and propagate stale defaults into integration/acceptance tests.
- **Fix:** Updated all 22 fixtures inline (web tests, sentinel tests, repository tests not in plan's `<files>` list).
- **Files modified:** test/unit/web/{api,auth,dispositions,action-folder-config,frontend}.test.ts, test/unit/sentinel/healer.test.ts, test/unit/config/{action-folders,repository}.test.ts.
- **Commit:** `4d23651`

**2. [Rule 3 - Blocking] Worktree base mismatch reset**
- **Found during:** Pre-Task-1 worktree branch check
- **Issue:** Worktree HEAD was at `e38a7a5` (old main) instead of expected base `d2be0ed` (Plan 34-01 complete). Plan 34-02 PLAN.md and the phase 34 directory were not visible until the reset.
- **Fix:** `git reset --hard d2be0ed54176050aa04ad4d3e7fd909adc6c17e3` to expose phase 34 plan files. The worktree branch had no work of its own to preserve.
- **Files modified:** None (HEAD-only change)
- **Commit:** None (pre-execution setup)

**3. [Rule 3 - Blocking] Symlinked node_modules into worktree**
- **Found during:** Pre-Task-1 typecheck attempt
- **Issue:** `pnpm tsc --noEmit` failed with "Command tsc not found" because the worktree had no node_modules.
- **Fix:** `ln -s /Users/mike/git/mail-mgr/node_modules node_modules` (symlink to repo root's installed deps). Symlink is in `.gitignore` and does not appear in commits.
- **Files modified:** None (untracked symlink)
- **Commit:** None

## Issues Encountered

- **Pre-existing frontend.test.ts failures (out of scope).** 7 tests in `test/unit/web/frontend.test.ts` fail with 404 on /app.js because `dist/app.js` and `dist/styles.css` need `pnpm build:frontend` first. Documented as deferred in `.planning/phases/34-.../deferred-items.md` from Plan 01. Verified pre-existing on the Plan 01 base commit; not addressed in this plan per the SCOPE BOUNDARY rule.

## Self-Check

Files claimed in SUMMARY:
- `src/imap/client.ts` — FOUND
- `src/config/schema.ts` — FOUND
- `test/unit/imap/client.test.ts` — FOUND
- 22 fixture files — FOUND (all spot-checked via git diff)
- `.planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-02-SUMMARY.md` — FOUND (this file)

Commits claimed:
- `2033041` (Task 1) — FOUND
- `4d23651` (Task 2) — FOUND
- `aaac1cf` (Task 3) — FOUND

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 34-03 is unblocked.** Plan 02 leaves every public op guarded and the matrix coverage in place; Plan 03 builds on top to land the docstrings / observability hooks / postmortem doc.
- **Threat model T-34-02 / T-34-03 mitigations now operational** — wedge on any public op rejects within its op-class timeout, triggers handleClose, and Plan 01's cleanupFlow.close() drains in-flight callers.
- **R2, R4, R5, R6 satisfied** per the plan frontmatter; R3 was Plan 01's responsibility (already shipped).

---
*Phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio*
*Plan: 02*
*Completed: 2026-05-01*
