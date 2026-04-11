---
phase: 04-config-cleanup
plan: 01
subsystem: config, ui
tags: [zod, schema, frontend, rule-display]

# Dependency graph
requires:
  - phase: 03-batch-filing-engine
    provides: BatchEngine with rule evaluation and DryRunMessage type
provides:
  - Optional rule name in ruleSchema (z.string().optional())
  - generateBehaviorDescription pure function for rule display
  - Behavior-first rule table with optional secondary name
affects: [04-02, any future plan touching rule display or schema]

# Tech tracking
tech-stack:
  added: []
  patterns: [behavior-description display pattern, extracted pure display utilities]

key-files:
  created:
    - src/web/frontend/rule-display.ts
  modified:
    - src/config/schema.ts
    - src/web/frontend/app.ts
    - src/web/frontend/styles.css
    - src/batch/index.ts
    - test/unit/config/config.test.ts

key-decisions:
  - "Extracted formatRuleAction and generateBehaviorDescription to rule-display.ts for testability without DOM"
  - "Used unicode arrows in rule-display.ts to match existing UI conventions"

patterns-established:
  - "Pure display utilities extracted to separate files for unit testability"
  - "Behavior description as primary rule identifier, user name as optional secondary"

requirements-completed: [CONF-05]

# Metrics
duration: 4min
completed: 2026-04-11
---

# Phase 4 Plan 1: Optional Rule Names Summary

**Optional rule names with behavior-driven descriptions replacing name-first display in rule table**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-11T00:08:25Z
- **Completed:** 2026-04-11T00:12:06Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Made rule name optional in Zod schema (z.string().optional()) with all downstream code fixed
- Created generateBehaviorDescription function showing populated match fields + action as primary text
- Updated rule table from 5-column (Name/Match/Action/Enabled/Actions) to 3-column (Rule/Enabled/Actions) layout
- Added 8 new tests (3 schema, 5 behavior description) with all 343 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Make rule name optional in schema and fix downstream code** - `a90efdf` (feat)
2. **Task 2: Add behavior description generator and update rule list display** - `411c079` (feat)

## Files Created/Modified
- `src/config/schema.ts` - Changed ruleSchema name from z.string().min(1) to z.string().optional()
- `src/web/frontend/rule-display.ts` - New file with formatRuleAction and generateBehaviorDescription pure functions
- `src/web/frontend/app.ts` - Updated rule table rendering, removed name-required validation, conditional name in payload
- `src/web/frontend/styles.css` - Added .rule-description, .rule-behavior, .rule-name-secondary styles
- `src/batch/index.ts` - Fixed matched.name to use ?? '' fallback for DryRunMessage.ruleName
- `test/unit/config/config.test.ts` - Added 8 new tests for optional name schema and behavior descriptions

## Decisions Made
- Extracted formatRuleAction and generateBehaviorDescription to src/web/frontend/rule-display.ts to avoid DOM dependencies in unit tests
- Used unicode characters in rule-display.ts to match existing UI conventions in app.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Rule schema now accepts optional names, ready for 04-02 (sweep settings UI, cursor toggle)
- generateBehaviorDescription available for reuse in any future rule display context

---
*Phase: 04-config-cleanup*
*Completed: 2026-04-11*
