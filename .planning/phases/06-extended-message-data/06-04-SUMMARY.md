---
phase: 06-extended-message-data
plan: 04
subsystem: monitor
tags: [gap-closure, envelope-header, imap, tdd]
dependency_graph:
  requires: []
  provides: [monitor-envelope-header-wiring]
  affects: [message-processing-pipeline]
tech_stack:
  added: []
  patterns: [tdd-red-green]
key_files:
  created: []
  modified:
    - src/monitor/index.ts
    - test/unit/monitor/monitor.test.ts
decisions:
  - No updateEnvelopeHeader method needed -- Monitor is rebuilt on config change
metrics:
  duration: 115s
  completed: "2026-04-12T04:11:17Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 2
---

# Phase 6 Plan 4: Wire envelopeHeader into Monitor parseMessage Call Summary

Monitor now passes config.imap.envelopeHeader to parseMessage, closing the last verification gap where Monitor-processed messages had undefined envelopeRecipient and visibility fields.

## What Changed

The Monitor class in `src/monitor/index.ts` had a single-line gap: `parseMessage(raw as ImapFetchResult)` was called without the `envelopeHeader` argument that `parseMessage` already supported. Sweep and Batch paths were already wired correctly -- only the Monitor's direct call was missing.

### Implementation (3 lines changed)

1. Added `private envelopeHeader: string | undefined` field to Monitor class
2. Added `this.envelopeHeader = config.imap.envelopeHeader` in constructor
3. Changed `parseMessage(raw as ImapFetchResult)` to `parseMessage(raw as ImapFetchResult, this.envelopeHeader)`

### Tests Added (3 new tests)

1. **passes envelopeHeader to parseMessage when configured** -- Verifies parseMessage called with `(raw, 'Delivered-To')` when config has envelopeHeader set
2. **passes undefined envelopeHeader when not configured** -- Verifies parseMessage called with `(raw, undefined)` when no envelopeHeader in config
3. **constructor stores envelopeHeader from config** -- Verifies Monitor construction with envelopeHeader succeeds

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 69ca377 | test | Add failing tests for envelopeHeader passthrough in Monitor |
| 4903573 | feat | Wire envelopeHeader from config into Monitor parseMessage call |

## Verification Results

- `npx vitest run test/unit/monitor/monitor.test.ts` -- 18/18 tests pass (15 existing + 3 new)
- `npx vitest run` -- 384/388 pass; 4 failures are pre-existing in `frontend.test.ts` (static file serving 404s, unrelated to this change)
- `grep "parseMessage.*envelopeHeader" src/monitor/index.ts` -- confirms wiring exists
- No bare `parseMessage(raw as ImapFetchResult)` calls remain in Monitor

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None.

## Decisions Made

1. **No updateEnvelopeHeader method**: The existing pattern rebuilds the entire Monitor on config change (new Monitor(newConfig, deps)), so a dedicated update method is unnecessary.
