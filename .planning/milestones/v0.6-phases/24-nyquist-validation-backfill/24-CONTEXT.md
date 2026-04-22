# Phase 24: Nyquist Validation Backfill - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring phases 18, 19, 20, and 21 to Nyquist compliance. Each phase already has a VALIDATION.md with task-level verification maps, but they are in `draft` status with `nyquist_compliant: false`. The code and tests for these phases already exist — this phase verifies actual test coverage, fills any gaps with new tests, updates task statuses to reflect reality, and marks each VALIDATION.md as compliant.

This phase does NOT change application code, add features, or modify any behavior. It is purely a validation/test compliance pass over 4 existing phase VALIDATION.md files.

</domain>

<decisions>
## Implementation Decisions

### Verification Approach
- **D-01:** For each task in each VALIDATION.md, run the specified automated command to confirm the test exists and passes. Also grep for test descriptions matching the requirement to verify coverage is real, not just a passing but empty file.
- **D-02:** Use the existing `gsd-nyquist-auditor` agent to handle the per-phase audit. It reads the VALIDATION.md, runs tests, identifies gaps, generates missing tests, and updates the file.

### Status Update Scope
- **D-03:** Update each task row's "File Exists" and "Status" columns to reflect actual state (✅ green if test exists and passes, ❌ red if failing, ⬜ pending if missing).
- **D-04:** If a task's test file is marked ❌ W0 (Wave 0 needed) but the test file actually exists now (created during phase execution), update the marker to ✅.
- **D-05:** After all tasks verified, update frontmatter: `status: verified`, `nyquist_compliant: true`, `wave_0_complete: true`. Complete the sign-off checklist.

### Gap Handling
- **D-06:** If any VALIDATION.md task has no corresponding test (test file exists but lacks the specific test case), generate the missing test to achieve compliance. The phase goal explicitly requires `nyquist_compliant: true` for all 4 phases — leaving gaps defeats the purpose.
- **D-07:** New tests must follow existing test patterns in the same test file. No new test infrastructure or fixtures beyond what already exists.

### Execution Strategy
- **D-08:** Process phases sequentially: 18 → 19 → 20 → 21. Each phase is independent but sequential processing prevents test suite conflicts.
- **D-09:** Run the full test suite after all 4 phases are updated to confirm nothing regressed.

### Claude's Discretion
- Order of tasks within each phase validation
- Whether to batch test runs or run per-task
- Test assertion specificity (exact values vs pattern matching) for any new tests
- Whether to update the audit file (.planning/v0.6-MILESTONE-AUDIT.md) nyquist section after completion

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit & Requirements
- `.planning/v0.6-MILESTONE-AUDIT.md` — Nyquist section identifies phases 18-21 as partial compliance; tech_debt items list specific gaps
- `.planning/REQUIREMENTS.md` — All PROC-*, RULE-*, MON-*, LOG-*, CONF-*, FOLD-*, EXT-* requirements mapped to phases

### Compliant Reference (Gold Standard)
- `.planning/phases/17-configuration-folder-lifecycle/17-VALIDATION.md` — Phase 17 is `nyquist_compliant: true`; use as the template for what "done" looks like

### Target VALIDATION.md Files
- `.planning/phases/18-safety-predicates-activity-log/18-VALIDATION.md` — 6 tasks, Wave 0 needs registry + sender-utils tests
- `.planning/phases/19-action-processing-core/19-VALIDATION.md` — 12 tasks, all processor tests, Wave 0 needs processor test stubs
- `.planning/phases/20-monitoring-startup-recovery/20-VALIDATION.md` — 4 tasks, poller tests, Wave 0 needs poller test stubs
- `.planning/phases/21-idempotency-edge-cases/21-VALIDATION.md` — 3 tasks, processor tests (files exist already)

### Existing Test Files (verify coverage)
- `test/unit/action-folders/processor.test.ts` — Covers phases 19, 21, 23
- `test/unit/action-folders/poller.test.ts` — Covers phase 20
- `test/unit/action-folders/registry.test.ts` — May or may not exist (phase 18 Wave 0)
- `test/unit/rules/sender-utils.test.ts` — May or may not exist (phase 18 Wave 0)
- `test/unit/log/activity.test.ts` — Covers LOG-01/LOG-02 (phase 18)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gsd-nyquist-auditor` agent: Purpose-built for exactly this task — reads VALIDATION.md, runs tests, fills gaps, updates compliance status
- Phase 17 VALIDATION.md: Gold standard template showing compliant format with all sign-off items checked

### Established Patterns
- VALIDATION.md frontmatter uses `nyquist_compliant: true/false`, `wave_0_complete: true/false`, `status: draft/verified`
- Per-Task Verification Map table format: Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status
- Sign-off checklist is 6 items, all must be checked for compliance

### Integration Points
- After all 4 VALIDATION.md files updated, the milestone audit `.planning/v0.6-MILESTONE-AUDIT.md` nyquist section should reflect `compliant_phases: [17, 18, 19, 20, 21, 22]` and `overall: "compliant"`

</code_context>

<specifics>
## Specific Ideas

- Each VALIDATION.md already has the correct structure — this is an update pass, not a creation task
- Phase 18 is the most likely to need new test files (registry.test.ts, sender-utils.test.ts) since they're marked ❌ W0
- Phases 19-21 likely just need status column updates since processor.test.ts and poller.test.ts already exist with comprehensive test suites
- The "Validation Audit" section (see Phase 17 example) should be added to phases 18-21 with gap counts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-nyquist-validation-backfill*
*Context gathered: 2026-04-21*
