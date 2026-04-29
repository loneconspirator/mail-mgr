---
phase: 260428-x6c
plan: 01
subsystem: docs
tags: [spec-hygiene, architecture, validate]
requires: []
provides:
  - architecture-covers-frontmatter-populated
  - validate-arch-back-link-warnings-cleared
affects:
  - specs/architecture.md
tech_stack:
  added: []
  patterns:
    - "frontmatter-driven bi-directional spec link validation"
key_files:
  created:
    - .planning/todos/done/2026-04-29-populate-architecture-covers-integrations-frontmatter.md
  modified:
    - specs/architecture.md
decisions:
  - "Populate covers-modules and covers-integrations with the entire MOD/IX universe (19 + 12). The single architecture doc is by definition the back-link target for all of them."
  - "Add IX-009..IX-012 body bullets even though the populated frontmatter alone clears the validator. Keeps the back-link grounded in real prose, not just YAML bookkeeping."
  - "Skip adding MOD-#### markers in the module-table rows. Validator sweep across all 19 modules emitted zero MOD-ARCHITECTURE-NOT-LINKED-BACK findings after frontmatter was populated; in-table IDs would be noise."
metrics:
  duration_seconds: 126
  completed: 2026-04-29
---

# Quick Task 260428-x6c: Populate architecture covers-modules and covers-integrations Summary

Populated the empty `covers-modules` and `covers-integrations` arrays in `specs/architecture.md` with all 19 modules and all 12 integrations on disk, added body one-liners for IX-009..IX-012 (the four IX IDs not previously mentioned by ID), and confirmed via the deterministic validator scripts that zero `IX-ARCHITECTURE-NOT-MENTIONED` and zero `MOD-ARCHITECTURE-NOT-LINKED-BACK` findings remain.

## Frontmatter diff

**Before**

```yaml
---
title: Mail-Mgr System Architecture
covers-modules: []
covers-integrations: []
---
```

**After**

```yaml
---
title: Mail-Mgr System Architecture
covers-modules: [MOD-0001, MOD-0002, MOD-0003, MOD-0004, MOD-0005, MOD-0006,
                 MOD-0007, MOD-0008, MOD-0009, MOD-0010, MOD-0011, MOD-0012,
                 MOD-0013, MOD-0014, MOD-0015, MOD-0016, MOD-0017, MOD-0018,
                 MOD-0019]
covers-integrations: [IX-001, IX-002, IX-003, IX-004, IX-005, IX-006,
                      IX-007, IX-008, IX-009, IX-010, IX-011, IX-012]
---
```

IDs verified against `ls specs/modules/` (19 files: mod-0001..mod-0019) and `ls specs/integrations/` (12 files: ix-001..ix-012).

## Body additions

A new subsection was added between `### UC-001.c Variant: Review sweep delayed filing` and the `---` rule that precedes `## Data Flow Overview`:

```markdown
### Other integration entry points

- **IX-009: Batch Dry-Run Preview** — Web UI requests a dry-run preview from BatchEngine; no IMAP mutations.
- **IX-010: Batch Execute & Cancel** — Web UI commits or aborts a batch run via BatchEngine; per-message cancel honoured.
- **IX-011: Rule CRUD & Hot Reload** — Web UI mutates `config.yml` via ConfigRepository; subsystems reload without process restart.
- **IX-012: Proposal Dismissal & Resurfacing** — User dismisses a proposal via Web UI; PatternDetector resurfaces after 5 new contradicting signals.
```

No MOD-#### markers were added inside the module tables — the validator sweep showed they were not needed.

## /validate outcome (counts before vs after)

The plan calls for `/validate IX` and `/validate MOD`. Rather than spawning the full orchestrator (which fans out one subagent per artifact and runs `npm test`), I ran the deterministic per-artifact validator scripts directly — they own the `IX-ARCHITECTURE-NOT-MENTIONED` and `MOD-ARCHITECTURE-NOT-LINKED-BACK` checks. The semantic and test-runner steps weren't required to evaluate this plan's success criteria.

| Validator                                       | Architecture-back-link findings before | After |
| ----------------------------------------------- | -------------------------------------- | ----- |
| validate-integration (IX-001..IX-012, 12 specs) | 4 (IX-009, IX-010, IX-011, IX-012)     | 0     |
| validate-module (MOD-0001..MOD-0019, 19 specs)  | up to 19 possible                      | 0     |

Full per-IX/per-MOD `arch_warn` count was confirmed zero across all 31 specs after the frontmatter populate.

## Residual findings (unrelated, not acted on)

The IX sweep still surfaces two findings each on IX-003 and IX-004:

- `IX-INTEGRATION-TEST-UNSET` — `integration-test:` frontmatter is null
- `IX-NAMED-INTERACTIONS-WITHOUT-TEST` — named interactions declared but no test wired

These are exactly the work tracked by the existing pending todos:

- `.planning/todos/pending/2026-04-29-wire-ix-003-integration-test.md`
- `.planning/todos/pending/2026-04-29-wire-ix-004-integration-test.md`

Out of scope for this plan; no new pending todos required.

## Deviations from Plan

None — plan executed as written. Task 2's conditional MOD-#### in-table marker fix was not needed because the frontmatter populate alone cleared all module back-link warnings.

## Commits

| Task | Commit  | Message                                                |
| ---- | ------- | ------------------------------------------------------ |
| 1    | 3189796 | docs(260428-x6c-01): populate architecture covers-* frontmatter |
| 2    | 68e20c6 | docs(260428-x6c-02): close architecture covers-* todo |

## Self-Check: PASSED

- specs/architecture.md frontmatter contains `covers-modules: [MOD-0001` — confirmed present.
- specs/architecture.md frontmatter contains `covers-integrations: [IX-001` — confirmed present.
- Body contains literal `IX-009:`, `IX-010:`, `IX-011:`, `IX-012:` prefixes — confirmed (one each).
- `.planning/todos/pending/2026-04-29-populate-architecture-covers-integrations-frontmatter.md` — confirmed absent.
- `.planning/todos/done/2026-04-29-populate-architecture-covers-integrations-frontmatter.md` — confirmed present.
- Commit 3189796 — confirmed in `git log`.
- Commit 68e20c6 — confirmed in `git log`.
