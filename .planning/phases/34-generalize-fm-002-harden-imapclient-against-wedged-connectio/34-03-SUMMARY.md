---
phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio
plan: 03
subsystem: docs

tags: [specs, fm-002, mod-0002, ix-001, validate-failure-mode, wedge-detection, imapclient]

# Dependency graph
requires:
  - phase: 34-01
    provides: guardedOp wrapper, CONNECT_TIMEOUT_MS / LOCK_TIMEOUT_MS / WRITE_TIMEOUT_MS / BULK_FETCH_TIMEOUT_MS constants, cleanupFlow that calls flow.close(), bounded flow.connect()
provides:
  - Generalized FM-002 spec body — title, Required behavior, Test approach all bind the entire ImapClient public surface (R1)
  - Updated MOD-0002 wedge-detection Notes paragraph naming guardedOp, the timeout buckets, and the cleanupFlow→flow.close() drain chain
  - Backfilled VALIDATION.md per-task verification map (9 rows across plans 34-01/02/03) and flipped status to in-progress with nyquist_compliant=true
  - validate-failure-mode FM-002 PASS verdict (deterministic + semantic checks)
affects: [phase-34-02, future-phases-modifying-MOD-0002, future-phases-adding-public-ImapClient-ops]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FM↔MOD spec/code parity — every public op listed in MOD-0002 Notes must have a guardedOp call site in src/imap/client.ts"
    - "FM-002 Test approach now describes the it.each matrix shape (N×2) instead of enumerating individual tests, so future op additions don't drift the spec"

key-files:
  created:
    - .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-03-SUMMARY.md
  modified:
    - specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md
    - specs/modules/mod-0002-imap-client.md
    - .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-VALIDATION.md

key-decisions:
  - "Did NOT rename FM-002 file — title-frontmatter rewrite is sufficient; renaming would invalidate file paths baked into IX-001 / MOD-0002 / external linkers (per plan + RESEARCH.md guidance)"
  - "FM-002 Required behavior section enumerates the full guarded surface inline (instead of pointing at MOD-0002) so the spec stands alone — a reader doesn't need to chase pointers to know which ops are covered"
  - "VALIDATION.md status set to in-progress (not approved) because plan 34-02 is in a parallel worktree and cannot be observed green from this worktree; orchestrator owns the final flip after wave merge"

patterns-established:
  - "Spec-first wedge contract: FM-002 spec is the authoritative list of guarded ops; MOD-0002 Notes mirrors it; src/imap/client.ts implements it. Any of the three out of sync is a finding."

requirements-completed: [R1]

# Metrics
duration: 6min
completed: 2026-05-01
---

# Phase 34 Plan 03: Generalize FM-002 spec + MOD-0002 wedge note + VALIDATION.md backfill Summary

**FM-002 spec retitled to bind every ImapClient operation, Required behavior widened to enumerate the full guarded public surface (15+ ops + lock acquisition), MOD-0002 Notes paragraph rewritten to match, validate-failure-mode FM-002 returns PASS, and VALIDATION.md per-task verification map backfilled with 9 rows.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-01T22:43:13Z
- **Completed:** 2026-05-01T22:49:22Z
- **Tasks:** 4 (3 spec tasks + 1 orchestrator-added VALIDATION.md backfill)
- **Files modified:** 3

## Accomplishments

- FM-002 spec title dropped "folder load" framing — now reads "Wedged IMAP connection silently halts every ImapClient operation"
- FM-002 Required behavior section enumerates every public op covered by guardedOp (connect, fetchNewMessages, fetchAllMessages, fetchMessagesRaw, moveMessage, appendMessage, searchByHeader, deleteMessage, listMailboxes, listFolders, status, createMailbox, renameFolder, getSpecialUseFolder, withMailboxLock, withMailboxSwitch) plus the cleanupFlow→flow.close() drain requirement
- FM-002 Trigger paragraph generalized — names Monitor, ReviewSweeper, ActionFolderPoller, MoveTracker, batch routes, sentinel, etc., as the surfaces sharing the wedge symptom
- FM-002 Test approach rewritten to describe the it.each matrix shape (N public ops × 2 failure shapes) plus the R4 in-flight rejection test and the connect-path tests
- FM-002 "Why this exists" section gains a 3rd bullet (Silent background-process loss)
- MOD-0002 Notes wedge-detection paragraph rewritten — names guardedOp, every covered op, the timeout buckets (15s/30s/120s), and the cleanupFlow→flow.close() chain. "currently listFolders" framing removed
- VALIDATION.md `status` flipped draft → in-progress; `nyquist_compliant: true`; `wave_0_complete: true`
- VALIDATION.md per-task verification map populated with 9 rows (34-01-T1..T3, 34-02-T1..T3, 34-03-T1..T3) — 6 marked green, 3 pending (parallel wave)
- All FM-002 frontmatter immutables preserved: id=FM-002, fault-injection-test=test/unit/imap/client.test.ts, integrations=[IX-001], invariants-protected=[], modules=[MOD-0002]
- IX-001 Failure Handling section still cites FM-002 (Blocker 2 fix — back-link survives generalization)
- validate-failure-mode FM-002 returns PASS in full mode (zero findings)

## Task Commits

Each task was committed atomically with `--no-verify` (parallel-execution flag):

1. **Task 1: Rewrite FM-002 spec — title, Required behavior, Test approach** — `77ea7ce` (docs)
2. **Task 2: Update MOD-0002 wedge-detection Notes paragraph** — `d6f3ee6` (docs)
3. **Task 3: Final validation — validate-failure-mode FM-002 (full mode)** — verification-only, no source modifications
4. **Task 4: Backfill VALIDATION.md per-task verification map** — `f9a8aaa` (docs)

**Plan metadata:** see Final commit below.

## Files Created/Modified

- `specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md` — title rewrite + Trigger paragraph generalization + Required behavior section widened + Why-this-exists 3rd bullet + Test approach rewrite (frontmatter immutables preserved)
- `specs/modules/mod-0002-imap-client.md` — Notes line 46 wedge-detection paragraph rewritten to name guardedOp, full op coverage, timeout buckets, cleanupFlow→flow.close() chain
- `.planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-VALIDATION.md` — status/flags flipped, per-task map populated, sign-off boxes ticked

## Decisions Made

- **Did NOT rename the FM-002 file.** Filename stays as `fm-002-wedged-imap-connection-hangs-folder-load.md`. RESEARCH.md and the plan both note that the file path is referenced by IX-001 and MOD-0002 — re-renaming would invalidate any baked-in paths for zero benefit because the validator follows IDs, not filenames. The title-frontmatter rewrite is sufficient.
- **Inline enumeration of covered ops in FM-002 body** (instead of pointing at MOD-0002). Trade-off: ~3 lines of duplication versus a self-contained spec a reviewer can read without chasing pointers. Spec-as-source-of-truth wins.
- **VALIDATION.md status set to `in-progress` not `approved`.** Plan 34-02 is running in a parallel worktree; this executor cannot observe its green/red state. The orchestrator owns the final flip after wave merge per the prompt's "Do NOT update STATE.md or ROADMAP.md" instruction.

## Deviations from Plan

None — plan executed exactly as written. The orchestrator's prompt added Task 4 (VALIDATION.md backfill) which the in-file plan does not list; that's an orchestrator-level deviation handled per the prompt's explicit objective, not a Rule 1-3 auto-fix.

## Validation Report

Per `.claude/skills/validate-failure-mode/SKILL.md` "Reporting" template:

```
# Failure mode validation: FM-002

## Script findings (deterministic)
- 0 errors
- 0 warnings
- (script JSON: `findings: []`)

## Fault-injection test
- File: test/unit/imap/client.test.ts
- Run: `npx vitest run test/unit/imap/client.test.ts -t "FM-002"`
- Result: 9 FM-002 cases passed (Plan 34-02's it.each matrix will add ~30 more once it lands; this executor's Plan 34-01 baseline of 9 cases is green)

## Semantic findings

### Named-component coverage

| Named in FM body | Where it should live | Found? | Notes |
|---|---|---|---|
| ImapClient | architecture.md | yes (line 67) | matches |
| guardedOp | MOD-0002 Notes (post-Task-2) | yes (line 46) | now mirrors spec |
| withMailboxLock | MOD-0002 Interface Summary | yes (line 31) | matches |
| withMailboxSwitch | MOD-0002 Interface Summary | yes (line 32) | matches |
| cleanupFlow | MOD-0002 Notes | yes (line 46, post-Task-2) | private helper documented |
| handleClose | src/imap/client.ts | yes (private method) | not in arch.md but documented in spec body context |
| ReviewSweeper | architecture.md | yes (line 35) | matches |
| ActionFolderPoller | architecture.md | yes (line 53) | matches |
| Monitor | architecture.md | yes (existed pre-phase) | matches |
| MoveTracker | architecture.md | yes (line 42) | matches |
| FolderCache | architecture.md | yes (line 69) | matches |

### Trigger fidelity
- The four pre-existing FM-002 tests (cycleIdle×2, listFolders×2) drive the wedge through the ImapFlowLike mock seam — usable=false flip and never-resolving promise substitution — both shapes named in the Required behavior MUST clauses.
- Plan 34-01 added two cleanupFlow tests asserting `flow.close()` is called and exceptions are swallowed — these align with the new "cleanupFlow MUST call flow.close()" MUST clause.
- Plan 34-01 also added two connect-hang tests (flow.connect, mailboxOpen) that align with the new "connect (the underlying flow.connect() and the initial mailboxOpen('INBOX'))" coverage in the Required behavior list.
- The full it.each matrix that asserts every public op satisfies its respective MUST clause is delivered in Plan 34-02 Task 3 (parallel worktree). Once it lands, the matrix × 2 cases will assert each MUST clause for each named op.

### INV linkage coherence
- Skipped — `invariants-protected: []` is empty (FM-002 is a wedge-detection trip-wire, not an invariant enforcer).

## Verdict
PASS — no errors, no warnings. The spec body now matches what Plan 01's foundation already implements; Plan 02 will fill in the remaining matrix cases and per-op `guardedOp` call sites against this same spec contract.
```

## Issues Encountered

- **Worktree base mismatch.** Initial branch HEAD was `e38a7a5` (main) instead of `d2be0ed` (Plan 34-01 completion). Resolved per the worktree_branch_check protocol with `git reset --hard d2be0ed54176050aa04ad4d3e7fd909adc6c17e3` before any edits — confirmed empty tree status, so no work was lost.
- **PreToolUse:Edit hook noisy.** The runtime emitted "READ-BEFORE-EDIT REMINDER" system reminders on each edit even though the target file had already been Read in this session. All edits succeeded as confirmed by post-edit grep verification; the reminders were spurious noise from the hook, not actual rejections.
- **`pnpm vitest` not in PATH.** The phase's VALIDATION.md and 34-03-PLAN.md use `pnpm vitest` but this project uses `npx vitest run` (per package.json scripts). Used `npx vitest run` for the test execution. Recorded the correct command in the updated VALIDATION.md.

## User Setup Required

None — this plan is docs-only.

## Next Phase Readiness

- FM-002 spec/code parity is now contractually visible: any future agent adding a public op to ImapClient must (a) wrap it in guardedOp, (b) update MOD-0002 Notes line 46, and (c) update FM-002 Required behavior. validate-failure-mode's semantic check will catch missing components if the body names something that doesn't exist.
- Plan 34-02 in the parallel worktree can complete against the spec contract this plan blesses — no further spec edits needed once it lands.
- ROADMAP.md and STATE.md updates are owned by the orchestrator (per the prompt's explicit instruction "Do NOT update STATE.md or ROADMAP.md"). This SUMMARY plus the per-task commits give the orchestrator everything it needs for the wave merge.

## Self-Check: PASSED

Files created/modified verified to exist:
- FOUND: specs/failure-modes/fm-002-wedged-imap-connection-hangs-folder-load.md
- FOUND: specs/modules/mod-0002-imap-client.md
- FOUND: .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-VALIDATION.md
- FOUND: .planning/phases/34-generalize-fm-002-harden-imapclient-against-wedged-connectio/34-03-SUMMARY.md

Commits verified to exist:
- FOUND: 77ea7ce (Task 1 — FM-002 spec rewrite)
- FOUND: d6f3ee6 (Task 2 — MOD-0002 Notes update)
- FOUND: f9a8aaa (Task 4 — VALIDATION.md backfill)

Validator verified:
- FOUND: validate-failure-mode FM-002 → exit 0, findings: []

---
*Phase: 34-generalize-fm-002-harden-imapclient-against-wedged-connectio*
*Plan: 03*
*Completed: 2026-05-01*
