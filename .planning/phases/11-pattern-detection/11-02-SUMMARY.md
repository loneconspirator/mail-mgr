---
phase: 11-pattern-detection
plan: 02
subsystem: api
tags: [fastify, rest-api, proposed-rules, pattern-detection, behavioral-learning]

requires:
  - phase: 11-01
    provides: ProposalStore, PatternDetector, ProposedRule/ProposedRuleCard types, proposed_rules table
provides:
  - REST API endpoints for listing, approving, dismissing, modifying proposed rules
  - mark-approved endpoint for Modify flow (no duplicate rule creation)
  - Application lifecycle wiring of ProposalStore and PatternDetector
affects: [11-03-frontend]

tech-stack:
  added: []
  patterns: [proposed-rule-card-enrichment, strength-label-mapping, conflict-annotation]

key-files:
  created:
    - src/web/routes/proposed-rules.ts
    - test/unit/web/proposed-rules.test.ts
  modified:
    - src/web/server.ts
    - src/index.ts

key-decisions:
  - "mark-approved endpoint separated from approve to prevent duplicate rule creation in Modify flow"
  - "Strength labels use matchingCount for display but strength (matching - contradicting) for threshold"

patterns-established:
  - "ProposedRuleCard enrichment: strengthLabel, conflictAnnotation, resurfacedNotice computed at API layer"
  - "Approve flow: configRepo.addRule() then proposalStore.approveProposal() for atomic rule+status update"

requirements-completed: [LEARN-04, LEARN-05]

duration: 3min
completed: 2026-04-13
---

# Phase 11 Plan 02: Proposed Rules API Summary

**REST API for proposed rules with approve/dismiss/modify/mark-approved endpoints, strength labels, conflict annotations, and full app lifecycle wiring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-13T06:23:38Z
- **Completed:** 2026-04-13T06:26:32Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Five API endpoints for proposed rules: list, approve, dismiss, modify, mark-approved
- Approve creates real rule via ConfigRepository.addRule() with hot-reload, mark-approved only updates status
- ProposalStore and PatternDetector wired into application lifecycle (both initial startup and IMAP reconnect)
- 15 unit tests covering all endpoints, edge cases, strength labels, conflict annotations, and resurface notices

## Task Commits

Each task was committed atomically:

1. **Task 1: Proposed rules API routes with tests** - `354b063` (feat, TDD)
2. **Task 2: ServerDeps extension, route registration, and main.ts lifecycle wiring** - `31ba292` (feat)

## Files Created/Modified
- `src/web/routes/proposed-rules.ts` - Fastify route handlers for all five proposed rule endpoints
- `test/unit/web/proposed-rules.test.ts` - 15 unit tests for proposed rules API
- `src/web/server.ts` - Added getProposalStore to ServerDeps, registered proposed rule routes
- `src/index.ts` - Instantiated ProposalStore/PatternDetector, wired into MoveTracker and ServerDeps

## Decisions Made
- mark-approved endpoint is separate from approve to support the Modify flow where the rule editor creates the rule and only the proposal status needs updating
- Strength labels display matchingCount for user-facing text but use computed strength (matching - contradicting) for threshold classification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Plan references `src/main.ts` but the actual file is `src/index.ts` -- used correct filename

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All API endpoints ready for frontend consumption in Plan 03
- ProposalStore accessible via ServerDeps for route handlers
- PatternDetector wired into MoveTracker for real-time pattern detection

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 11-pattern-detection*
*Completed: 2026-04-13*
