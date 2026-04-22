---
phase: 18-safety-predicates-activity-log
plan: 02
title: "Action Type Registry and Sender Utilities"
one_liner: "Declarative ACTION_REGISTRY with 4 action types and shared findSenderRule/isSenderOnly utilities"
subsystem: action-folders, rules
tags: [registry, sender-utils, tdd, extraction]
dependency_graph:
  requires: [config-schema]
  provides: [action-registry, sender-utils]
  affects: [dispositions-route]
tech_stack:
  added: []
  patterns: [static-registry-record, function-extraction-reexport]
key_files:
  created:
    - src/action-folders/registry.ts
    - src/rules/sender-utils.ts
    - test/unit/action-folders/registry.test.ts
    - test/unit/rules/sender-utils.test.ts
  modified:
    - src/action-folders/index.ts
    - src/web/routes/dispositions.ts
decisions:
  - "Used re-export pattern for isSenderOnly backward compatibility rather than alias import"
  - "Registry uses Record<ActionType, ActionDefinition> as static module-level constant per D-07"
metrics:
  duration_seconds: 132
  completed: "2026-04-20T22:28:16Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 17
  test_pass: 17
---

# Phase 18 Plan 02: Action Type Registry and Sender Utilities Summary

Declarative ACTION_REGISTRY with 4 action types and shared findSenderRule/isSenderOnly utilities.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create action type registry | dda51c8, d1fc353 | src/action-folders/registry.ts, src/action-folders/index.ts, test/unit/action-folders/registry.test.ts |
| 2 | Create sender-utils with findSenderRule and extract isSenderOnly | 44560e0, f1ab4a1 | src/rules/sender-utils.ts, src/web/routes/dispositions.ts, test/unit/rules/sender-utils.test.ts |

## Implementation Details

### Task 1: Action Type Registry

Created `src/action-folders/registry.ts` with:
- `ActionType` union: `'vip' | 'block' | 'undoVip' | 'unblock'`
- `FolderConfigKey` type derived from `ActionFolderConfig['folders']`
- `ActionDefinition` interface: operation, ruleAction, destination, folderConfigKey
- `ACTION_REGISTRY` constant with all 4 action types

Registry keys verified to match config schema `actionFolderDefaults.folders` keys exactly. Updated barrel export in `src/action-folders/index.ts`. 8 tests covering shape, alignment, and correctness.

### Task 2: Sender Utilities

Created `src/rules/sender-utils.ts` with:
- `isSenderOnly(rule)` - extracted from dispositions.ts for shared use
- `findSenderRule(sender, actionType, rules)` - finds enabled sender-only rules with case-insensitive matching

Updated `src/web/routes/dispositions.ts` to re-export `isSenderOnly` from sender-utils for backward compatibility. All 25 existing dispositions tests continue to pass with zero regressions. 9 new sender-utils tests covering match, miss, wrong action type, disabled rules, narrowed rules, and case-insensitivity.

## Decisions Made

1. **Re-export pattern for isSenderOnly**: Used `export { isSenderOnly } from '../../rules/sender-utils.js'` in dispositions.ts so existing consumers importing from dispositions continue to work.
2. **Static Record pattern**: Registry is a module-level `Record<ActionType, ActionDefinition>` constant with no class wrapper per D-07 research decision.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Test Results

- Registry tests: 8 passed
- Sender-utils tests: 9 passed
- Dispositions regression: 25 passed
- Total new tests: 17, all green
- Full suite: 509 passed, 7 failed (pre-existing frontend.test.ts failures unrelated to this plan)

## Self-Check: PASSED

All 6 files confirmed present. All 4 commits (dda51c8, d1fc353, 44560e0, f1ab4a1) verified in git log.
