---
phase: 06-extended-message-data
plan: 03
subsystem: imap
tags: [discovery, envelope-header, auto-detection, imap-config]
dependency_graph:
  requires: [06-02]
  provides: [probeEnvelopeHeaders, CANDIDATE_HEADERS, discovery-lifecycle-integration]
  affects: [src/imap/discovery.ts, src/imap/index.ts, src/index.ts]
tech_stack:
  added: []
  patterns: [header-probing, consensus-threshold, lifecycle-gating]
key_files:
  created:
    - src/imap/discovery.ts
    - test/unit/imap/discovery.test.ts
  modified:
    - src/imap/index.ts
    - src/index.ts
decisions:
  - id: D-01
    summary: "Discovery triggers on IMAP config submit and initial startup, not on reconnects"
  - id: D-03
    summary: "Monitor does not start processing until discovery completes"
  - id: D-04
    summary: "Discovered header persisted to config.yml via saveConfig"
metrics:
  duration: 2m 49s
  completed: "2026-04-12T03:48:47Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 388
  test_pass: 381
---

# Phase 6 Plan 03: Envelope Header Auto-Discovery Summary

Auto-discovery module that probes 10 most recent INBOX messages for envelope recipient headers using consensus threshold of 3, integrated into both initial startup and IMAP config change lifecycle

## Task Results

| Task | Name | Commit(s) | Files |
|------|------|-----------|-------|
| 1 | Create header discovery module with probing and consensus logic | 75d574f (RED), a747a64 (GREEN) | src/imap/discovery.ts, src/imap/index.ts, test/unit/imap/discovery.test.ts |
| 2 | Integrate discovery into IMAP config change lifecycle | 567d31f | src/index.ts |

## What Was Built

### Discovery Module (src/imap/discovery.ts)
- `CANDIDATE_HEADERS`: Ordered list of 5 envelope headers to probe (Delivered-To, X-Delivered-To, X-Original-To, X-Resolved-To, Envelope-To) per D-02
- `probeEnvelopeHeaders()`: Fetches up to 10 most recent INBOX messages, counts which candidate headers appear with valid email values (must contain '@'), returns the header with highest count above MIN_CONSENSUS (3) or null
- Only accepts header names from the hardcoded CANDIDATE_HEADERS list (T-06-04 mitigation)
- Header values validated to contain '@' before counting (filters non-email values)

### Lifecycle Integration (src/index.ts)
- **Initial startup (H4a):** Discovery runs after imapClient.connect() but before monitor.start(). If discovered header differs from config, config is updated via saveConfig and Monitor is rebuilt with updated config
- **IMAP config change (H3a-H3c):** Discovery runs on new client after connect, result persisted to config.yml, Monitor rebuilt with updated config before start
- Both paths have try/catch with logger.error -- discovery failure does not block system startup (MATCH-06 graceful degradation)

### Barrel Export (src/imap/index.ts)
- Added `probeEnvelopeHeaders` and `CANDIDATE_HEADERS` exports

## Decisions Made

1. **D-01 implemented** -- Discovery triggers on explicit IMAP config submit and initial startup only, never on automatic reconnects
2. **D-03 implemented** -- Monitor.start() is called only after discovery completes in both code paths
3. **D-04 implemented** -- Discovered header persisted via saveConfig() to config.yml; config repo's getConfig() reflects updated value for Monitor construction

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx vitest run test/unit/imap/discovery.test.ts`: 7 tests pass
- `npx vitest run`: 381 pass, 4 pre-existing failures in frontend.test.ts (unrelated static file serving tests)
- `probeEnvelopeHeaders` called in src/index.ts at lines 107 (config change) and 161 (initial startup)
- Both discovery calls appear before `monitor.start()` calls at lines 121 and 175

## Self-Check: PASSED

- [x] src/imap/discovery.ts exists
- [x] test/unit/imap/discovery.test.ts exists
- [x] src/imap/index.ts exports probeEnvelopeHeaders and CANDIDATE_HEADERS
- [x] src/index.ts contains discovery integration
- [x] Commit 75d574f exists
- [x] Commit a747a64 exists
- [x] Commit 567d31f exists
