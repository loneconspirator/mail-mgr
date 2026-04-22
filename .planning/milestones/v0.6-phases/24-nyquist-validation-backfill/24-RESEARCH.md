# Phase 24: Nyquist Validation Backfill - Research

**Researched:** 2026-04-21
**Domain:** Process compliance — VALIDATION.md audit and update for phases 18-21
**Confidence:** HIGH

## Summary

This phase is a documentation and test-verification pass, not a code-change phase. Phases 18-21 each have a VALIDATION.md file in `draft` status with `nyquist_compliant: false`. The actual code and tests for all four phases already exist and all 585 tests pass green. The work is: (1) run each VALIDATION.md task's automated command to confirm real coverage, (2) update file-exists and status columns, (3) fill any test gaps, and (4) flip each file to `nyquist_compliant: true` with a completed sign-off checklist.

The good news is that ALL test files referenced in the VALIDATION.md files already exist. Phase 18's Wave 0 items (`registry.test.ts`, `sender-utils.test.ts`) were created during execution. The primary work is updating status markers from "pending" to "green" and adding the Validation Audit section to each file (modeled on Phase 17's gold standard).

**Primary recommendation:** Process each VALIDATION.md sequentially (18, 19, 20, 21), running the specified automated commands, updating status columns, adding audit sections, and flipping frontmatter. No new application code needed. Likely a small number of new test cases for gap coverage.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** For each task in each VALIDATION.md, run the specified automated command to confirm the test exists and passes. Also grep for test descriptions matching the requirement to verify coverage is real, not just a passing but empty file.
- **D-02:** Use the existing `gsd-nyquist-auditor` agent to handle the per-phase audit. It reads the VALIDATION.md, runs tests, identifies gaps, generates missing tests, and updates the file.
- **D-03:** Update each task row's "File Exists" and "Status" columns to reflect actual state.
- **D-04:** If a task's test file is marked "W0" but the test file actually exists now, update the marker.
- **D-05:** After all tasks verified, update frontmatter: status: verified, nyquist_compliant: true, wave_0_complete: true. Complete the sign-off checklist.
- **D-06:** If any VALIDATION.md task has no corresponding test, generate the missing test to achieve compliance.
- **D-07:** New tests must follow existing test patterns in the same test file. No new test infrastructure or fixtures beyond what already exists.
- **D-08:** Process phases sequentially: 18 -> 19 -> 20 -> 21.
- **D-09:** Run the full test suite after all 4 phases are updated to confirm nothing regressed.

### Claude's Discretion
- Order of tasks within each phase validation
- Whether to batch test runs or run per-task
- Test assertion specificity (exact values vs pattern matching) for any new tests
- Whether to update the audit file (.planning/v0.6-MILESTONE-AUDIT.md) nyquist section after completion

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

## Current State of Each VALIDATION.md

### Phase 18: Safety Predicates & Activity Log (6 tasks)

| Task ID | Requirement | Test File | File Exists NOW | Coverage Status |
|---------|-------------|-----------|-----------------|-----------------|
| 18-01-01 | LOG-01 | activity.test.ts | YES (20 tests) | 5 tests in "action-folder source" describe block cover LOG-01 [VERIFIED: vitest run] |
| 18-01-02 | LOG-02 | activity.test.ts | YES | "stores action-folder source with rule_id and rule_name" covers LOG-02 [VERIFIED: vitest run -t "rule_id"] |
| 18-02-01 | EXT-01 | registry.test.ts | YES (8 tests) | Full coverage: shape, count, config key alignment, destinations [VERIFIED: vitest run] |
| 18-02-02 | EXT-01 | registry.test.ts | YES | "keys match config schema folder keys" directly covers config alignment [VERIFIED: vitest run] |
| 18-03-01 | sender-utils | sender-utils.test.ts | YES (9 tests) | isSenderOnly (3 tests) + findSenderRule (6 tests) [VERIFIED: vitest run] |
| 18-03-02 | sender-utils | sender-utils.test.ts | YES | "findSenderRule" describe block has 6 tests including case-insensitive match [VERIFIED: vitest run] |

**Assessment:** All 6 tasks have passing tests. Wave 0 files that were marked as missing (registry.test.ts, sender-utils.test.ts) now exist. Status update only -- no new tests needed. [VERIFIED: ran all commands]

### Phase 19: Action Processing Core (12 tasks)

| Task ID | Requirement | Test File | File Exists NOW | Coverage Status |
|---------|-------------|-----------|-----------------|-----------------|
| 19-01-01 | PROC-05 | processor.test.ts | YES (30 tests) | "extractSender" describe block (4 tests) covers lowercase normalization [VERIFIED] |
| 19-01-02 | PROC-06 | processor.test.ts | YES | "unparseable sender" describe block (2 tests) [VERIFIED] |
| 19-01-03 | PROC-01 | processor.test.ts | YES | "processMessage - VIP" block (4 tests) covers skip rule + INBOX move [VERIFIED] |
| 19-01-04 | PROC-02 | processor.test.ts | YES | "processMessage - Block" block (2 tests) covers delete rule + Trash [VERIFIED] |
| 19-01-05 | PROC-03 | processor.test.ts | YES | "Undo VIP" block (2 tests) [VERIFIED] |
| 19-01-06 | PROC-04 | processor.test.ts | YES | "Unblock" block (1 test) [VERIFIED] |
| 19-01-07 | PROC-09 | processor.test.ts | YES | "conflict resolution" block (3 tests) [VERIFIED] |
| 19-01-08 | PROC-10 | processor.test.ts | YES | "multi-field rule preservation" block (1 test) [VERIFIED] |
| 19-01-09 | RULE-01 | processor.test.ts | YES | Implicitly via addRule path which uses Zod validation -- may need explicit test [ASSUMED] |
| 19-01-10 | RULE-02 | processor.test.ts | YES | VIP test checks "correct name" -- covers UUID + descriptive name [VERIFIED] |
| 19-01-11 | RULE-03 | processor.test.ts | YES | VIP test checks "order" field via nextOrder() mock [VERIFIED] |
| 19-01-12 | RULE-04 | processor.test.ts | YES | Implicitly via same addRule code path as web UI -- may need explicit test [ASSUMED] |

**Assessment:** All files exist, all 30 tests pass. RULE-01 and RULE-04 coverage may be implicit rather than explicit -- the auditor should verify whether dedicated assertions exist for Zod validation pass-through and rule indistinguishability. Potential gap: 0-2 small tests.

### Phase 20: Monitoring & Startup Recovery (4 tasks)

| Task ID | Requirement | Test File | File Exists NOW | Coverage Status |
|---------|-------------|-----------|-----------------|-----------------|
| 20-01-01 | MON-01 | poller.test.ts | YES (20 tests) | "status checks" block: "calls status() for all 4 action folder paths" [VERIFIED] |
| 20-01-02 | MON-02 | poller.test.ts | YES | Priority is tested via scanAll blocking behavior (overlap guard) [VERIFIED] |
| 20-01-03 | FOLD-03 | poller.test.ts | YES | scanAll processes pending before returning -- startup calls scanAll before monitor.start [VERIFIED] |
| 20-01-04 | FOLD-02 | poller.test.ts | YES | "always-empty invariant" block (4 tests): STATUS re-check + retry + warning [VERIFIED] |

**Assessment:** All 4 tasks fully covered. The poller test suite is comprehensive with 20 tests across 5 describe blocks. Status update only.

### Phase 21: Idempotency & Edge Cases (3 tasks)

| Task ID | Requirement | Test File | File Exists NOW | Coverage Status |
|---------|-------------|-----------|-----------------|-----------------|
| 21-01-01 | PROC-07 | processor.test.ts | YES | "idempotency (PROC-07)" block (6 tests) including duplicate detection + activity logging [VERIFIED] |
| 21-01-02 | PROC-08 | processor.test.ts | YES | "undo with no match (PROC-08)" block (3 tests) [VERIFIED] |
| 21-01-03 | PROC-07 | processor.test.ts | YES | "crash recovery (D-07)" test covers reprocessing scenario [VERIFIED] |

**Assessment:** All 3 tasks fully covered. File was already marked as existing in the VALIDATION.md. Status update only.

## Architecture Patterns

### Gold Standard Template (Phase 17)

The compliant VALIDATION.md format requires these sections [VERIFIED: read Phase 17]:

1. **Frontmatter** with `status: verified`, `nyquist_compliant: true`, `wave_0_complete: true`, `verified: <date>`
2. **Test Infrastructure** table (framework, config, commands, runtime)
3. **Sampling Rate** section
4. **Per-Task Verification Map** with all rows showing actual status
5. **Test File Summary** table (file, test count, coverage description)
6. **Wave 0 Requirements** with all items checked
7. **Manual-Only Verifications** (or "all automated" note)
8. **Validation Audit** section with gap/resolved/escalated/total/green counts
9. **Validation Sign-Off** checklist with all 6 items checked
10. **Approval** line with date

### Key Differences from Current State

Each of the 4 target files is missing:
- `verified:` date in frontmatter
- Updated status columns (all show "pending" despite tests passing)
- Updated "File Exists" columns (Phase 18 shows "W0" for files that now exist)
- Test File Summary table (absent from phases 18-21)
- Validation Audit section (absent from phases 18-21)
- Checked sign-off items

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test gap detection | Manual file-by-file grep | `gsd-nyquist-auditor` agent (D-02) | Purpose-built for this exact workflow |
| VALIDATION.md format | Free-form updates | Phase 17 gold standard template | Ensures consistent compliance format |

## Common Pitfalls

### Pitfall 1: Marking Implicit Coverage as Explicit
**What goes wrong:** Marking RULE-01 or RULE-04 as "green" when the test doesn't have an explicit assertion for that specific behavior, just happens to exercise the code path.
**Why it happens:** The Zod validation happens inside addRule, which is called by many tests, but no test explicitly asserts "this rule passes Zod validation."
**How to avoid:** Grep for explicit test descriptions matching the requirement. If only implicit, add a small focused test.
**Warning signs:** Test description doesn't mention the requirement behavior.

### Pitfall 2: Forgetting the Audit Section
**What goes wrong:** All rows updated but Validation Audit section not added, so format doesn't match gold standard.
**Why it happens:** It's easy to focus on the Per-Task Verification Map and forget the new section.
**How to avoid:** Use Phase 17 as a checklist -- diff the sections.

### Pitfall 3: Test Filter Patterns Not Matching
**What goes wrong:** The `-t` filter in automated commands doesn't match any test, so vitest reports 0 tests run but exits 0 (no failure).
**Why it happens:** Test descriptions changed during implementation but VALIDATION.md wasn't updated.
**How to avoid:** Check that filtered test runs report >0 tests passed, not just "no failures."

### Pitfall 4: Not Running Full Suite After All Updates
**What goes wrong:** New test in one phase breaks another phase's test due to shared mock state.
**Why it happens:** Rare with vitest's isolation, but possible with shared fixtures.
**How to avoid:** D-09 explicitly requires full suite run after all 4 phases complete.

## Code Examples

### VALIDATION.md Frontmatter Update Pattern
```yaml
---
phase: 18
slug: safety-predicates-activity-log
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
verified: 2026-04-21
---
```
Source: Phase 17 gold standard [VERIFIED: read file]

### Validation Audit Section Pattern
```markdown
## Validation Audit 2026-04-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Total tests | {count from test run} |
| All green | yes/no |
```
Source: Phase 17 gold standard [VERIFIED: read file]

### Test File Summary Pattern
```markdown
## Test File Summary

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/log/activity.test.ts` | 20 | Source column migration, action-folder source with rule_id/name, isSystemMove |
| `test/unit/action-folders/registry.test.ts` | 8 | Registry shape, config key alignment, entry shapes, destinations |
| `test/unit/rules/sender-utils.test.ts` | 9 | isSenderOnly, findSenderRule with case-insensitive matching |
```
Source: Phase 17 gold standard [VERIFIED: read file]

## Execution Strategy

Based on all evidence, here is the recommended execution flow per phase:

1. Run the phase's quick test command to confirm all green
2. For each task row: verify the `-t` filter matches real tests (check >0 pass count)
3. Update "File Exists" column (W0 -> checkmark where files now exist)
4. Update "Status" column (pending -> green for all passing)
5. Add Test File Summary table with actual test counts
6. Check off Wave 0 items that are now complete
7. Add Validation Audit section with gap counts
8. Check all 6 sign-off items
9. Update frontmatter (status, nyquist_compliant, wave_0_complete, verified date)

After all 4 phases: run `npx vitest run` full suite, then optionally update the milestone audit file.

## Test Counts Summary

| Phase | Test File(s) | Test Count | All Green |
|-------|-------------|------------|-----------|
| 18 | activity.test.ts, registry.test.ts, sender-utils.test.ts | 20 + 8 + 9 = 37 | YES [VERIFIED] |
| 19 | processor.test.ts | 30 | YES [VERIFIED] |
| 20 | poller.test.ts | 20 | YES [VERIFIED] |
| 21 | processor.test.ts (shared with 19) | 30 (shared) | YES [VERIFIED] |
| Full suite | all 37 test files | 585 | YES [VERIFIED] |

## Likely Gap Count

| Phase | Likely Gaps | Nature |
|-------|-------------|--------|
| 18 | 0 | All coverage explicit |
| 19 | 0-2 | RULE-01 (Zod validation) and RULE-04 (indistinguishable from web UI) may need explicit tests |
| 20 | 0 | All coverage explicit |
| 21 | 0 | All coverage explicit |

**Total estimated new tests: 0-2 small unit tests.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RULE-01 coverage may be only implicit (via addRule path) | Phase 19 Assessment | Low -- auditor will detect and generate test if needed |
| A2 | RULE-04 coverage may be only implicit | Phase 19 Assessment | Low -- auditor will detect and generate test if needed |

## Open Questions

1. **Should the milestone audit file be updated?**
   - What we know: CONTEXT.md lists this as Claude's discretion
   - Recommendation: Yes, update `.planning/v0.6-MILESTONE-AUDIT.md` nyquist section to show phases 18-21 as compliant after all 4 are done. It's 2 minutes of work and closes the loop.

## Sources

### Primary (HIGH confidence)
- Phase 17 VALIDATION.md (gold standard) -- read and analyzed structure
- Phases 18-21 VALIDATION.md files -- read current draft state
- All test files verified via `npx vitest run` with verbose reporter
- Full test suite: 585 tests, 37 files, all green

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions (D-01 through D-09) -- user-locked execution strategy
- Milestone audit report -- identifies the 4 phases as partial compliance

## Metadata

**Confidence breakdown:**
- Current test coverage: HIGH -- verified every test file and ran every command
- VALIDATION.md format: HIGH -- gold standard template exists and was read
- Gap estimate: HIGH -- ran filtered tests for each task, only 2 tasks have ambiguous coverage
- Execution strategy: HIGH -- straightforward doc-update workflow with locked decisions

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable -- no external dependencies)
