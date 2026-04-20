# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.5 — Sender Disposition Views

**Shipped:** 2026-04-20
**Phases:** 4 | **Plans:** 5 | **Commits:** 66

### What Was Built
- Disposition query API with isSenderOnly predicate filtering all 6 EmailMatch fields
- Four sender disposition views: Priority, Blocked (flat lists), Reviewed, Archived (folder-grouped accordions)
- Inline sender management: add/remove from any view, folder picker for Archived, Edit Rule links
- Tab navigation integrating disposition views alongside existing rule list

### What Worked
- Query-based views over existing rules — zero new data models, zero migration, zero sync issues
- Shared render functions (renderDispositionView, renderFolderGroupedView) eliminated duplication across 4 views
- Small milestone scope (4 phases, 5 plans) shipped in a single day
- Gap closure pattern (Phase 13 Plan 02) caught incomplete isSenderOnly predicate before it propagated to UI phases

### What Was Inefficient
- SUMMARY frontmatter `requirements_completed` field missing from 3 of 4 phases — needed manual audit to confirm coverage
- REQUIREMENTS.md checkboxes never updated during execution — purely cosmetic but made audit noisier
- Nyquist validation only run on 2 of 4 phases

### Patterns Established
- Disposition views as query filters over existing rules (no new storage) — reusable pattern for future view types
- Shared render functions parameterized by disposition type — scales to additional dispositions without new code
- UI-SPEC → implementation → verification pipeline for vanilla JS frontend phases

### Key Lessons
1. Keep milestones tight — 4 phases in 1 day beats 7 phases over 9 days for momentum and coherence
2. Gap closure plans should be expected, not exceptional — first implementation of predicates rarely covers all edge cases
3. SUMMARY frontmatter discipline matters for automated audit — missing fields create noise in milestone verification

### Cost Observations
- Model mix: primarily opus for execution, sonnet for verification/audit
- Sessions: ~4 sessions across planning, execution, audit, completion
- Notable: entire milestone from requirements to shipped in under 24 hours

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v0.3 | — | 5 | Established GSD workflow, first folder taxonomy |
| v0.4 | 214 | 7 | Catastrophic clobber recovery, retroactive verification pattern |
| v0.5 | 66 | 4 | Tight scope, query-based views, single-day delivery |

### Cumulative Quality

| Milestone | Tests | Key Quality Metric |
|-----------|-------|--------------------|
| v0.3 | ~300 | First batch filing with dry-run safety |
| v0.4 | 478 | Full retroactive verification of orphaned phases |
| v0.5 | 478+ | 11/11 requirements satisfied, 7/7 E2E flows verified |

### Top Lessons (Verified Across Milestones)

1. Smaller milestones ship faster and with fewer incidents (v0.5 vs v0.4)
2. Query-based views over existing data beat new storage every time (v0.5 dispositions, v0.3 folder taxonomy)
3. Gap closure and verification phases are worth the overhead — they catch real bugs before they compound
