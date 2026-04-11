# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.3 — Folder Taxonomy & Batch Filing

**Shipped:** 2026-04-11
**Phases:** 5 | **Plans:** 10 | **Tasks:** 17

### What Was Built
- IMAP folder hierarchy discovery with cached API, TTL, stale fallback, and validation warnings
- Interactive tree picker replacing text inputs for folder selection across rule editor, batch, and sweep settings
- Batch filing engine with dry-run preview, chunked execution (25 messages), cancellation, and per-message error isolation
- Editable sweep settings with tree pickers, cursor toggle, optional rule names with auto-generated behavior descriptions
- Frontend polish: no-match display fix, api wrapper consistency, type-safe error handling

### What Worked
- Dependency chain (folder discovery -> tree picker -> batch engine) kept each phase focused and testable
- Phase 4 (Config & Cleanup) had no dependency on Phases 2-3, allowing it to run independently
- Phase 5 gap closure caught real bugs (no-match filter protocol mismatch, cachedRecent never assigned)
- Quick tasks (260410-gm4, 260410-h20, 260411-fmv) handled mid-milestone refactors without disrupting phase flow
- Integration checker found the cachedRecent and BatchEngine stale config bugs that manual verification missed

### What Was Inefficient
- SUMMARY frontmatter `requirements_completed` was not populated by most executors — traceability table also stale; bookkeeping fell behind
- Nyquist validation was started for Phases 1-3 but never completed (draft status) — either commit to it or disable it
- Phase 3 SUMMARY one-liners were low quality (e.g., just "renderBatch()") — planner/executor should enforce meaningful summaries
- Progress table in ROADMAP.md was never updated during execution — all phases showed "0/N Planning complete"

### Patterns Established
- `evaluateRules` + `executeAction` shared between Monitor, ReviewSweeper, and BatchEngine — unified rule execution path
- `api.config.*` namespace pattern for all config-related API calls in frontend
- `catch(e: unknown)` with inline `instanceof Error` guard as the standard error handling pattern
- Tree picker as reusable component across rule editor, batch source selection, and sweep settings

### Key Lessons
1. Integration checking at milestone audit catches wiring bugs that per-phase verification misses — the cachedRecent and BatchEngine stale issues were only visible when checking cross-phase data flow
2. Frontend tech debt accumulates silently when multiple phases add code to the same files — a dedicated cleanup phase (like Phase 5) is worth the overhead
3. Quick tasks are the right vehicle for mid-milestone refactors that improve code quality but don't fit any phase scope

### Cost Observations
- Model mix: ~70% opus (planning + execution), ~30% sonnet (verification + integration checking)
- Notable: Single-plan phases (Phase 5) execute very efficiently; multi-plan phases (Phase 3 with 3 plans) have higher coordination overhead

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.3 | 5 | 10 | First milestone with GSD workflow, gap closure phase, integration checking |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v0.3 | 347 | 16/16 requirements satisfied, 3 quick tasks for mid-milestone fixes |

### Top Lessons (Verified Across Milestones)

1. Integration checking at milestone boundary catches cross-phase wiring bugs invisible to per-phase verification
2. Gap closure phases (like Phase 5) pay for themselves by catching real bugs before shipping
