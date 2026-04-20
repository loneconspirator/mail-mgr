---
phase: 11-pattern-detection
plan: 03
subsystem: ui
tags: [vanilla-dom, proposed-rules, pattern-detection, frontend, css]

requires:
  - phase: 11-02
    provides: REST API endpoints for proposed rules (list, approve, dismiss, modify, mark-approved)
provides:
  - Proposed nav tab with badge count
  - Proposal card UI with strength badges, sender->destination routes, examples, conflict annotations, resurfaced notices
  - Approve/modify/dismiss interactions with proper mark-approved flow (no duplicate rules)
  - Phase 11 CSS for proposal cards and strength badges
affects: []

tech-stack:
  added: []
  patterns: [proposal-card-rendering, pending-proposal-approval-flow, strength-class-mapping]

key-files:
  created: []
  modified:
    - src/web/frontend/api.ts
    - src/web/frontend/app.ts
    - src/web/frontend/index.html
    - src/web/frontend/styles.css
    - test/unit/web/frontend.test.ts

key-decisions:
  - "Modify flow uses markApproved endpoint after openRuleModal saves, preventing duplicate rule creation"
  - "pendingProposalApproval state variable tracks proposal ID through modal lifecycle, reset on cancel/overlay click"

patterns-established:
  - "Proposal card rendering via h() DOM builder for XSS-safe output (no innerHTML for user data)"
  - "Strength class mapping: >=5 strong, >=2 moderate, >=1 weak, else ambiguous"

requirements-completed: [UI-02, LEARN-04]

duration: 4min
completed: 2026-04-13
---

# Phase 11 Plan 03: Proposed Rules Frontend Summary

**Proposed rules UI with nav tab badge, strength-badged cards, approve/modify/dismiss interactions, and mark-approved flow preventing duplicate rules**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T06:29:03Z
- **Completed:** 2026-04-13T06:33:22Z
- **Tasks:** 2 (1 auto + 1 checkpoint auto-approved)
- **Files modified:** 5

## Accomplishments
- Proposed nav tab with live badge count showing active proposal count
- Proposal cards with strength badges (strong/moderate/weak/ambiguous), sender->destination routes, envelope recipients, example subjects, conflict annotations, and resurfaced notices
- Approve creates a real rule and fades out the card; Modify opens pre-filled rule editor and marks proposal approved via mark-approved endpoint (no duplicate rules); Dismiss removes card with toast
- 9 new frontend tests covering nav button, CSS classes, compiled JS strings, and proposed API integration (list, approve, dismiss, conflict annotation, resurfaced notice)

## Task Commits

Each task was committed atomically:

1. **Task 1: API client extension and frontend nav + proposed page with full card UI** - `89f76b8` (feat)
2. **Task 2: Visual and functional verification** - auto-approved checkpoint (no commit)

## Files Created/Modified
- `src/web/frontend/api.ts` - Added proposed API methods (list, approve, dismiss, getModifyData, markApproved) and ProposedRuleCard type import/export
- `src/web/frontend/index.html` - Added Proposed nav button with badge span
- `src/web/frontend/app.ts` - Added renderProposed(), renderProposalCard(), updateProposedBadge(), getStrengthClass(), formatShortDate(), pendingProposalApproval state, and Modify flow integration in openRuleModal save handler
- `src/web/frontend/styles.css` - Added Phase 11 proposal card styles (proposal-card, strength badges, proposal-actions, btn-dismiss, nav-badge)
- `test/unit/web/frontend.test.ts` - Added 9 tests: nav button in HTML, CSS classes, compiled JS content, proposed API list/approve/dismiss/conflict/resurfaced

## Decisions Made
- Modify flow uses `markApproved` (not `approve`) after `openRuleModal` saves to prevent duplicate rule creation -- `api.rules.create()` already creates the rule, so calling `approve` (which also calls `configRepo.addRule()`) would duplicate it
- `pendingProposalApproval` module-level state tracks proposal ID through modal lifecycle, reset to null on cancel or overlay click

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertions for minified app.js**
- **Found during:** Task 1 (test verification)
- **Issue:** Tests checked for function names like `renderProposed` in compiled app.js, but esbuild minifies function names
- **Fix:** Changed assertions to check for string literals that survive minification (e.g., 'Proposed Rules', 'proposal-card', 'mark-approved')
- **Files modified:** test/unit/web/frontend.test.ts
- **Verification:** All 15 tests pass
- **Committed in:** 89f76b8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial test fix, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11 is now complete: pattern detection engine (11-01), API layer (11-02), and frontend UI (11-03) are all wired
- Full proposed rules workflow operational: move tracking -> pattern detection -> proposed rule cards -> approve/modify/dismiss

---
*Phase: 11-pattern-detection*
*Completed: 2026-04-13*
