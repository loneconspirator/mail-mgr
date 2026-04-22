# Phase 30: Scanning & Rename Detection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 30-scanning-rename-detection
**Areas discussed:** Scan Result Types, Deep Scan Strategy, Timer Architecture, Concurrency with Other Timers
**Mode:** --auto (all decisions auto-selected)

---

## Scan Result Types

| Option | Description | Selected |
|--------|-------------|----------|
| Three states (found/renamed/missing) | Distinguish found-in-place, found-in-different-folder, not-found-anywhere | ✓ |
| Binary (found/not-found) | Only check if sentinel is in expected folder, no deep scan location | |

**User's choice:** [auto] Three states — provides the data Phase 31 needs for both rename healing and failure handling
**Notes:** Scanner produces results only, does not act on them

---

## Deep Scan Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Iterate all folders on miss | Search every IMAP folder when sentinel not in expected location, short-circuit on find | ✓ |
| Batch deep scan on timer | Collect all misses, run one deep scan pass for all missing sentinels together | |
| No deep scan | Only check expected folder, leave rename detection to Phase 31 | |

**User's choice:** [auto] Iterate all folders on miss with short-circuit — most straightforward approach, leverages existing findSentinel()
**Notes:** IMAP has no global cross-folder search, must iterate individually

---

## Timer Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| SentinelScanner class (MoveTracker pattern) | start/stop/getState, setInterval, running guard, fire-and-forget initial scan | ✓ |
| Standalone function on setInterval | Simpler but no state tracking or status API integration | |
| Piggyback on existing timer | Run scan inside MoveTracker or sweeper interval | |

**User's choice:** [auto] SentinelScanner class — matches established codebase pattern, supports status API
**Notes:** 5-minute default interval per SCAN-03, configurable via config schema

---

## Concurrency with Other Timers

| Option | Description | Selected |
|--------|-------------|----------|
| Independent timer, no coordination | Rely on ImapClient.withMailboxLock() for connection serialization | ✓ |
| Explicit coordination with monitor | Pause monitor during scan, resume after | |
| Run during IDLE gaps | Schedule scans when INBOX monitor is in IDLE state | |

**User's choice:** [auto] Independent timer — withMailboxLock handles serialization, scanner operations are brief per-folder
**Notes:** SCAN-04 satisfied by design — scanner never holds connection long enough to meaningfully delay INBOX processing

---

## Claude's Discretion

- Internal type names for scan results
- Whether to expose runScanForTest() method
- Folder listing approach for deep scan
- Per-folder error handling granularity in deep scan
- Test file organization

## Deferred Ideas

None — discussion stayed within phase scope
