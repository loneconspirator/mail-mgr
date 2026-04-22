---
phase: 18-safety-predicates-activity-log
verified: 2026-04-20T19:41:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 18: Safety Predicates & Activity Log Verification Report

**Phase Goal:** MoveTracker correctly ignores action folder moves and the system has reusable building blocks for action processing
**Verified:** 2026-04-20T19:41:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1 | Action folder paths are excluded from MoveTracker's user-move detection (isSystemMove recognizes action-folder source) | VERIFIED | `src/log/index.ts` line 173: `AND source IN ('arrival', 'sweep', 'batch', 'action-folder')` — test confirms `isSystemMove` returns true for action-folder-sourced entries |
| 2 | Activity log entries with source `action-folder` include rule_id and rule_name fields | VERIFIED | `logActivity` passes `rule?.id` and `rule?.name` to SQL; test at line 266-273 of activity.test.ts asserts rule_id='test-rule', rule_name='Test Rule' |
| 3 | Action types are defined in a registry pattern where each entry specifies folder name, processing function, and message destination | VERIFIED | `src/action-folders/registry.ts` exports `ACTION_REGISTRY` as `Record<ActionType, ActionDefinition>` with `folderConfigKey` (folder), `operation`+`ruleAction` (processing intent), `destination` for all 4 types; registry keys verified to match config schema exactly |
| 4 | Shared `findSenderRule(sender, actionType)` predicate exists for reuse by processor | VERIFIED | `src/rules/sender-utils.ts` exports `findSenderRule(sender, actionType, rules)` returning `Rule \| undefined`; 6 test cases cover match, miss, wrong action type, disabled rules, narrowed rules, case-insensitivity |
| 5 | isSystemMove recognizes action-folder source and returns true | VERIFIED | SQL IN clause contains `'action-folder'`; `test/unit/log/activity.test.ts` line 284-286 explicitly tests and confirms |
| 6 | logActivity accepts 'action-folder' as a source parameter | VERIFIED | Signature at line 87: `source: 'arrival' \| 'sweep' \| 'batch' \| 'action-folder' = 'arrival'` |
| 7 | isSenderOnly is importable from sender-utils and still works from dispositions | VERIFIED | `dispositions.ts` uses `export { isSenderOnly } from '../../rules/sender-utils.js'` plus a direct import; local function definition removed; 25 dispositions tests passed per summary |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/log/index.ts` | Extended isSystemMove and logActivity | VERIFIED | Source union extended at line 87; IN clause extended at line 173 |
| `test/unit/log/activity.test.ts` | Tests for action-folder source | VERIFIED | `describe('action-folder source')` block at line 265 with 5 tests, all passing |
| `src/action-folders/registry.ts` | ACTION_REGISTRY constant and ActionDefinition type | VERIFIED | Exports ACTION_REGISTRY, ActionDefinition, ActionType, FolderConfigKey |
| `src/rules/sender-utils.ts` | findSenderRule and isSenderOnly utilities | VERIFIED | Both functions exported; 9 tests all pass |
| `test/unit/action-folders/registry.test.ts` | Registry shape and config alignment tests | VERIFIED | 8 tests covering keys, shape, config alignment, destinations |
| `test/unit/rules/sender-utils.test.ts` | findSenderRule and isSenderOnly tests | VERIFIED | 9 tests covering all specified behaviors |
| `src/action-folders/index.ts` | Barrel re-export of registry | VERIFIED | Exports ACTION_REGISTRY, ActionDefinition, ActionType, FolderConfigKey |
| `src/web/routes/dispositions.ts` | Re-export of isSenderOnly, local def removed | VERIFIED | `export { isSenderOnly } from '../../rules/sender-utils.js'`; no local `function isSenderOnly` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/log/index.ts` | activity table | SQL IN clause includes 'action-folder' | WIRED | Line 173: `AND source IN ('arrival', 'sweep', 'batch', 'action-folder')` |
| `src/action-folders/registry.ts` | `src/config/schema.ts` | folderConfigKey matches ActionFolderConfig.folders keys | WIRED | `FolderConfigKey = keyof ActionFolderConfig['folders']`; registry test verifies keys match schema defaults exactly |
| `src/rules/sender-utils.ts` | `src/web/routes/dispositions.ts` | re-export of isSenderOnly | WIRED | Line 5: `export { isSenderOnly } from '../../rules/sender-utils.js'`; also imported at line 6 for local use |

### Data-Flow Trace (Level 4)

Not applicable — these are utility modules and database operations, not components rendering dynamic data from external sources. The activity log writes to and reads from SQLite directly; the registry and sender-utils are pure functions/constants.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All phase 18 tests pass | `npx vitest run test/unit/log/activity.test.ts test/unit/action-folders/registry.test.ts test/unit/rules/sender-utils.test.ts` | 37 passed, 0 failed | PASS |
| isSystemMove SQL includes action-folder | grep in src/log/index.ts | `AND source IN ('arrival', 'sweep', 'batch', 'action-folder')` found at line 173 | PASS |
| Registry keys match config schema | registry.test.ts key alignment test | Schema parsed with `{}`, folders keys match ACTION_REGISTRY keys — test green | PASS |
| isSenderOnly local def removed from dispositions | grep for `function isSenderOnly` in dispositions.ts | No match — local definition removed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LOG-01 | 18-01-PLAN.md | Action folder operations logged with `source = 'action-folder'` and standard message fields | SATISFIED | logActivity source union extended; isSystemMove IN clause extended; tests confirm storage and retrieval |
| LOG-02 | 18-01-PLAN.md | Activity log entries include rule_id/rule_name for created or removed rules | SATISFIED | rule?.id and rule?.name passed through; test confirms rule_id='test-rule', rule_name='Test Rule' stored and null when rule is null |
| EXT-01 | 18-02-PLAN.md | Action types defined in a registry pattern with folder name, processing function, and message destination | SATISFIED | ACTION_REGISTRY with folderConfigKey (folder name), operation+ruleAction (processing intent per D-09 declarative design decision), destination — 8 tests cover shape and alignment |

Note on EXT-01: The requirement text says "processing function" but locked decision D-09 specified declarative config (`operation: 'create' | 'remove'`, `ruleAction: 'skip' | 'delete'`) instead of function callbacks. The research doc explicitly maps EXT-01 to D-07 through D-10. This is an intentional architectural refinement, not a gap.

### Anti-Patterns Found

None. Scanned all modified files for TODO/FIXME/placeholder comments, empty implementations, and hardcoded stubs. No issues found.

### Human Verification Required

None. All behaviors are verifiable through code inspection and automated tests.

### Gaps Summary

No gaps. All 7 observable truths verified. All required artifacts exist, are substantive, and are wired. All 3 phase requirements (LOG-01, LOG-02, EXT-01) satisfied. 37 phase-specific tests pass.

---

_Verified: 2026-04-20T19:41:00Z_
_Verifier: Claude (gsd-verifier)_
