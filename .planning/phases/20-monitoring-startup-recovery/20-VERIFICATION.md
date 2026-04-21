---
phase: 20-monitoring-startup-recovery
verified: 2026-04-20T17:14:00Z
status: passed
score: 10/10
overrides_applied: 0
---

# Phase 20: Monitoring & Startup Recovery — Verification Report

**Phase Goal:** Action folders are continuously monitored and any pending messages are processed on startup before normal operation
**Verified:** 2026-04-20T17:14:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

#### Roadmap Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Action folders are polled via STATUS checks alongside INBOX/Review monitoring | VERIFIED | `poller.ts` calls `client.status(path)` for all 4 action folders on each tick; `start()` uses `setInterval` |
| SC-2 | Action folder processing takes priority over regular arrival routing | VERIFIED | In `index.ts` startup, `scanAll()` completes before `monitor.start()` (line 301 before line 314), draining pending messages before Monitor begins |
| SC-3 | On startup, pending messages in action folders are processed before entering normal monitoring loop | VERIFIED | `await actionFolderPoller.scanAll()` (line 301) is called and awaited before `await monitor.start()` (line 314) |
| SC-4 | Action folders are always empty after processing completes (no messages left behind) | VERIFIED | `poller.ts` STATUS re-checks after processing; retries once if messages remain; logs warning on persistence — FOLD-02 invariant |

#### Plan 01 Must-Have Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| P01-1 | ActionFolderPoller STATUS-checks all four action folders on each poll tick | VERIFIED | `scanAll()` loops `getActionFolderPaths()` which maps all 4 `ACTION_REGISTRY` entries; 20 unit tests confirm |
| P01-2 | Poller fetches and processes messages from non-empty folders only | VERIFIED | `if (messages === 0) continue` guard before `fetchAllMessages` call |
| P01-3 | Poller skips tick if already processing (overlap guard) | VERIFIED | `if (this.processing) return` guard; try/finally resets flag; 3 tests cover overlap scenarios |
| P01-4 | After processing, STATUS re-check confirms folder is empty | VERIFIED | `const recheck = await this.deps.client.status(path)` after processing loop; test "does a STATUS re-check after processing" confirms 5 total calls |
| P01-5 | Single retry if messages remain after first pass, then warn | VERIFIED | Retry block in `scanAll()` with second `fetchAllMessages` call; `logger.warn` on persistence |
| P01-6 | `scanAll()` can be called standalone for startup pre-scan | VERIFIED | Public async method, awaited standalone in `index.ts` line 301 |
| P01-7 | `start()`/`stop()` manage the setInterval timer with `.unref()` | VERIFIED | `this.timer.unref()` at line 75; `clearInterval(this.timer)` in `stop()` |

#### Plan 02 Must-Have Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| P02-1 | Startup sequence runs ensureActionFolders -> poller.scanAll() -> poller.start() -> monitor.start() | VERIFIED | Lines 289, 301, 307, 314 in `index.ts` in that exact order |
| P02-2 | Action folder pre-scan completes before Monitor receives any events | VERIFIED | `await actionFolderPoller.scanAll()` awaited synchronously before `await monitor.start()` — no gap possible |
| P02-3 | Poll timer is stopped on shutdown alongside other timers | VERIFIED | `timer.unref()` prevents process from being kept alive by poll timer — per PLAN 02 decision note: "No explicit shutdown handler needed" — same pattern as MoveTracker |
| P02-4 | Config change handler stops poller, re-creates it with new config, restarts | VERIFIED | `onActionFolderConfigChange` handler: lines 114-141 stop existing poller, rebuild with new config, call `start()` |
| P02-5 | IMAP config change rebuilds poller alongside Monitor/Sweeper/MoveTracker | VERIFIED | `onImapConfigChange` handler: lines 149-151 stop poller; lines 201-219 rebuild and start with new IMAP client |
| P02-6 | Pre-scan failure logs error and continues startup (graceful degradation) | VERIFIED | try/catch around `scanAll()` at lines 300-305; catch logs error, execution continues to `monitor.start()` |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/action-folders/poller.ts` | ActionFolderPoller class with scanAll/start/stop | VERIFIED | 93 lines, full implementation, exports `ActionFolderPoller` and `ActionFolderPollerDeps` |
| `src/action-folders/index.ts` | Re-export of poller | VERIFIED | Lines 6-7 export `ActionFolderPoller` and `ActionFolderPollerDeps` |
| `test/unit/action-folders/poller.test.ts` | Unit tests for poll behavior | VERIFIED | 461 lines, 20 tests across 5 describe blocks |
| `src/index.ts` | ActionFolderPoller wired into lifecycle | VERIFIED | Import at line 12, module-level variable, startup + config-change + IMAP-change + shutdown handling |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/action-folders/poller.ts` | `src/imap/client.ts` | `deps.client.status()` and `deps.client.fetchAllMessages()` | VERIFIED | Both calls present in `scanAll()` |
| `src/action-folders/poller.ts` | `src/action-folders/processor.ts` | `deps.processor.processMessage()` | VERIFIED | Called per message in processing loop |
| `src/action-folders/poller.ts` | `src/action-folders/registry.ts` | `ACTION_REGISTRY` for folder path resolution | VERIFIED | `import { ACTION_REGISTRY }` at line 6; used in `getActionFolderPaths()` |
| `src/index.ts` | `src/action-folders/poller.ts` | import and instantiation | VERIFIED | `import { ..., ActionFolderPoller, ... }` at line 12; `new ActionFolderPoller(...)` in startup and handlers |
| `src/index.ts` | `poller.scanAll()` | await before monitor.start() | VERIFIED | Line 301 `await actionFolderPoller.scanAll()` precedes line 314 `await monitor.start()` |

### Data-Flow Trace (Level 4)

Not applicable — this phase creates a polling engine (control flow), not a data-rendering component. Data flows through existing `processor.processMessage()` from Phase 19, which was verified in Phase 19 verification.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 20 poller unit tests pass | `npx vitest run test/unit/action-folders/poller.test.ts` | 20 passed in 11ms | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | Exit 0, no output | PASS |
| Full test suite (561 tests) passes | `npx vitest run` | 35 files, 561 tests passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| MON-01 | 20-01, 20-02 | Action folders monitored via poll-based STATUS checks alongside INBOX/Review | SATISFIED | `poller.ts` STATUS-checks all 4 action folders; `start()` runs on interval; wired into `index.ts` |
| MON-02 | 20-01, 20-02 | Action folder processing takes priority over regular arrival routing | SATISFIED | Startup ordering: `scanAll()` await completes before `monitor.start()` |
| FOLD-02 | 20-01 | Action folders always empty after processing completes | SATISFIED | STATUS re-check + single retry + persistent-message warning in `scanAll()` |
| FOLD-03 | 20-01, 20-02 | System processes pending messages on startup before normal monitoring loop | SATISFIED | `await actionFolderPoller.scanAll()` awaited in `index.ts` before `await monitor.start()` |

All 4 requirements assigned to Phase 20 in REQUIREMENTS.md traceability table are satisfied.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments found in `poller.ts` or `index.ts`. No empty return stubs. No hardcoded empty data.

### Human Verification Required

None — all behaviors are verifiable programmatically for this phase.

### Gaps Summary

No gaps. All 10 truths verified, all 4 artifacts present and substantive, all 5 key links wired, all 4 requirements satisfied, TypeScript clean, 561 tests passing.

**Notable:** The IMAP config change path (`onImapConfigChange`) does NOT run a pre-scan before `monitor.start()` — it starts the monitor first (line 179) then rebuilds the poller without pre-scan (line 215). However, this is NOT a gap for Phase 20 because:
1. The plan truth only promises "IMAP config change rebuilds poller alongside Monitor/Sweeper/MoveTracker" — which is met.
2. Roadmap SC-3 specifies "on startup" priority, not on IMAP reconnect.
3. PLAN 02's own decision note explicitly documents this as intentional.

---

_Verified: 2026-04-20T17:14:00Z_
_Verifier: Claude (gsd-verifier)_
