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

## Milestone: v0.6 — Action Folders

**Shipped:** 2026-04-22
**Phases:** 9 | **Plans:** 15 | **Commits:** ~100

### What Was Built
- Declarative action folder registry with configurable prefix and folder names
- Drag-to-act processing: VIP Sender, Block Sender, Undo VIP, Unblock Sender
- Sender extraction, rule CRUD, conflict resolution with existing rules
- Poll-based monitoring with startup pre-scan and always-empty invariant
- Idempotent processing with duplicate-rule detection and audit logging
- Config API with dynamic prefix updates and poller rebuild

### What Worked
- Registry pattern made action types declarative — adding new actions requires only a registry entry
- Always-empty invariant proved robust for action folder reliability
- Nyquist validation backfill (Phase 24) caught gaps in earlier phases retroactively

### What Was Inefficient
- Phase 22 (Folder Rename UI) was shipped then immediately superseded by v0.7 sentinel auto-healing — wasted effort
- Plan 25-04 skipped mid-execution — scope should have been trimmed during planning
- 9 phases across 3 days felt stretched; some phases were too granular

### Patterns Established
- Declarative registry for extensible action types
- Always-empty invariant for processing queues
- Config API → poller rebuild pipeline for runtime config changes

### Key Lessons
1. Don't build UI for something you're about to automate — Phase 22's folder rename UI was dead on arrival
2. Nyquist backfill phases are worth it but should be integrated into execution, not bolted on after
3. Action types as registry entries scale well — future actions (e.g., "Move to Folder") just need a registry entry

### Cost Observations
- Model mix: opus for execution, sonnet for validation/review
- Sessions: ~8 sessions over 3 days
- Notable: most complex milestone yet in terms of cross-cutting concerns (monitor, tracker, config, UI)

---

## Milestone: v0.7 — Sentinel Message System

**Shipped:** 2026-04-23
**Phases:** 7 | **Plans:** 13 | **Commits:** 121

### What Was Built
- RFC 2822 sentinel message format builder with INBOX guard and header injection prevention
- SQLite persistence for sentinel-to-folder mappings with full CRUD
- IMAP APPEND/SEARCH/DELETE operations for sentinel lifecycle
- Pipeline guards ensuring all 5 message processors skip sentinels
- Two-tier periodic scanning: fast-path expected folder, deep scan all folders on miss
- Auto-healing: folder rename reference updates, sentinel re-planting, INBOX failure notifications
- Removed ~400 lines of dead folder rename UI code

### What Worked
- TDD approach throughout — every phase was test-first, caught edge cases early
- Two-tier scan design minimized IMAP traffic while maintaining detection reliability
- Clean separation: format → store → IMAP ops → lifecycle → guards → scanning → healing
- Phase dependency chain was well-ordered — no backtracking needed

### What Was Inefficient
- REQUIREMENTS.md checkboxes not updated during execution (same problem as v0.5/v0.6 — still not fixed)
- Seed data for dev testing didn't cover review rules with `action.folder` set — masked a production bug where review rules skipped the review folder entirely
- Action folder polling has stuck messages creating log noise — secondary issue discovered during deployment

### Patterns Established
- Sentinel-based folder tracking as alternative to IMAP extensions (MAILBOXID, CONDSTORE)
- Config mutation via saveConfig() bypassing listeners to prevent cascade rebuilds
- Dedup notification tracking to avoid spamming INBOX with repeated failure alerts

### Key Lessons
1. **Test with production-like data** — seed data with minimal config hid the review action bug that only manifested when `action.folder` was set
2. Tests that verify buggy behavior are worse than no tests — they give false confidence. The review action test explicitly asserted the wrong destination
3. Two-tier scan pattern (cheap check first, expensive fallback) is broadly applicable beyond sentinels
4. Auto-healing that bypasses normal config listeners is tricky but necessary — full rebuilds on rename would be catastrophic for UX

### Cost Observations
- Model mix: opus for all execution and planning
- Sessions: ~6 sessions over 2 days
- Notable: 7 phases with clean dependency chain executed without any re-planning or scope changes

---

## Milestone: v0.8 — Action Folder Safety Hardening & FM-002 Generalization

**Shipped:** 2026-05-06
**Phases:** 2 (33-34) | **Plans:** 5 | **Tasks:** 11
**Timeline:** 12 days (2026-04-24 → 2026-05-05)

### What Was Built
- Action-folder processor: post-move logging via `pendingActivities` accumulator, duplicate-path early return, structured diagnostic logging
- Sentinel-aware poller skip eliminates ~4 wasteful `fetchAllMessages` IMAP round-trips per cycle when folders contain only their sentinel
- `guardedOp` chokepoint wraps every public ImapClient op + lock acquisition with per-op timeout buckets (CONNECT/LOCK/WRITE/BULK_FETCH)
- `cleanupFlow` drains in-flight imapflow promises via `flow.close()`; bounded `connect`/`mailboxOpen`/`logout`
- `idleTimeout` default lowered 300s→90s; 22 fixtures swept
- FM-002 spec generalized to bind every ImapClient op; MOD-0002 Notes mirrors; 42-case `it.each` matrix replaces enumerated tests

### What Worked
- Splitting Phase 34 into 3 plans (foundation → wire-up → spec) kept each plan reviewable; parallel worktrees on plans 02 and 03 actually merged cleanly
- Audit-driven gap closure pattern: audit found 2 doc inconsistencies + 1 test gap, all closed in the same session before completion
- Treating FM-002 as a contract (failure-mode spec) rather than a test gave the implementation a clear north star — every public op had to map to a guarded call site
- TDD throughout — every fault-injection test was RED before GREEN, including the cross-cutting matrix
- Preserving the existing FM-002 file path during generalization (rewrote frontmatter, didn't rename) avoided breaking IX-001/MOD-0002/external linkers

### What Was Inefficient
- Initial v0.8 scope was incident-driven and reactive — Phase 34 grew from a backlog todo into a full phase mid-milestone instead of being scoped up front
- Auto-generated MILESTONES.md accomplishments needed manual rewrite (CLI extracted code-review bullets and "TDD RED" boilerplate from SUMMARY files instead of the actual deliverable summary)
- Auto-generated v0.8-ROADMAP.md archive was a dump of the entire ROADMAP.md, not the milestone-scoped detail format used for v0.3-v0.7 — required full rewrite
- Two doc inconsistencies in 34-02 timeout buckets (LIST vs WRITE, WRITE vs BULK_FETCH) shipped to merged plan before the audit caught them — a tighter plan-checker pass would have caught these

### Patterns Established
- Chokepoint wrapper pattern for cross-cutting concerns (`guardedOp` is the second instance after `withTimeout` itself); future cross-cutting hardening should look for the chokepoint first
- Library-level cancellation seam (`imapflow.close()`) over user-space plumbing (AbortController) when the library exposes it
- Op-class timeout buckets over per-op constants for ops with similar wedge characteristics
- Spec-first contract for failure modes: FM-XXX spec is authoritative; module spec mirrors; code implements; any drift is a finding
- Pending-effects accumulator pattern for ordering log/audit entries after the operation they describe

### Key Lessons
1. **Audit-driven gap closure beats post-merge cleanup.** The v0.8 audit caught 2 doc inconsistencies + 1 test gap; closing them in the same session preserves coherent shipping. If closure had slipped to "next milestone," they'd rot.
2. **Auto-extracted accomplishments need a human pass.** SUMMARY files contain TDD ceremony ("TDD RED:") and review-fix line items that pollute auto-extraction. Either tighten the SUMMARY template's "one-liner" field discipline, or accept that the milestone-completion step will rewrite them.
3. **Reactive milestones are valid but should be re-scoped explicitly.** v0.8 started as one-incident-fix and grew to two phases. That's fine, but the growth should be a deliberate scope-add commit, not implicit drift.
4. **Don't rename spec files when their semantics widen.** Path baked into linkers everywhere; title-frontmatter rewrite is sufficient and avoids cascade churn.
5. **Test fixture sweeps are worth it.** Lowering `idleTimeout` 300s→90s touched 22 fixtures; sweeping them all in one commit beats per-test breakage downstream.

### Cost Observations
- Model mix: opus for planning/execution; sonnet for audit and validation
- Sessions: ~6 sessions over 12 days (some long gaps for adjacent quick tasks: BASIC auth, replyTo matcher)
- Notable: smallest milestone yet (2 phases) but longest calendar duration — driven by interleaving with quick tasks rather than continuous focus

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v0.3 | — | 5 | Established GSD workflow, first folder taxonomy |
| v0.4 | 214 | 7 | Catastrophic clobber recovery, retroactive verification pattern |
| v0.5 | 66 | 4 | Tight scope, query-based views, single-day delivery |
| v0.6 | ~100 | 9 | Declarative registry pattern, always-empty invariant, config API |
| v0.7 | 121 | 7 | Sentinel-based folder tracking, auto-healing, clean TDD throughout |
| v0.8 | ~35 | 2 | Audit-driven gap closure, chokepoint pattern (guardedOp), spec-first contract for failure modes |

### Cumulative Quality

| Milestone | Tests | Key Quality Metric |
|-----------|-------|--------------------|
| v0.3 | ~300 | First batch filing with dry-run safety |
| v0.4 | 478 | Full retroactive verification of orphaned phases |
| v0.5 | 478+ | 11/11 requirements satisfied, 7/7 E2E flows verified |
| v0.6 | 700+ | Nyquist backfill, 25/25 requirements, action folder idempotency |
| v0.7 | 759 | 25/25 requirements, production bug caught post-deploy (review action routing) |
| v0.8 | 800+ | 12/12 requirements, 4/4 integration flows, 4/4 E2E flows, audit-gap closure same-session |

### Top Lessons (Verified Across Milestones)

1. Smaller milestones ship faster and with fewer incidents (v0.5 vs v0.4)
2. Query-based views over existing data beat new storage every time (v0.5 dispositions, v0.3 folder taxonomy)
3. Gap closure and verification phases are worth the overhead — they catch real bugs before they compound
4. Tests that assert buggy behavior are actively harmful — worse than no test at all (v0.7 review action bug)
5. Seed/test data must mirror production config — minimal seeds mask real-world bugs (v0.7 review rules)
6. Don't build UI you're about to automate — v0.6 folder rename UI was immediately replaced by v0.7 auto-healing
7. Audit-driven gap closure beats post-merge cleanup — close findings in the same session, not "next milestone" (v0.8)
8. Chokepoint wrapper pattern (single seam per cross-cutting concern) outperforms scattered per-op plumbing — `guardedOp` is the canonical example (v0.8)
