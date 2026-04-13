---
phase: 11-pattern-detection
verified: 2026-04-12T23:41:00Z
status: human_needed
score: 4/5
overrides_applied: 0
gaps: []
human_verification:
  - test: "Open the app in a browser, click the Proposed tab, and confirm the empty state renders with 'No proposed rules yet' message"
    expected: "Empty state card appears with explanatory text. No errors in the browser console."
    why_human: "Browser DOM rendering cannot be verified programmatically from the test suite — tests only check compiled JS content strings."
  - test: "Move several messages manually from Inbox to a folder, wait for MoveTracker scan cycle, then refresh the Proposed tab"
    expected: "Proposal cards appear showing strength badge (colored pill), sender -> destination route, example subjects with dates, and Approve/Modify/Dismiss buttons."
    why_human: "Requires live IMAP interaction and real move signal accumulation — not testable without a connected IMAP server."
  - test: "Click Approve on a proposal card"
    expected: "Card fades out with a 'Rule created and active.' toast. Check the Rules tab — one new rule should appear named 'Auto: <sender>'. No duplicate rules."
    why_human: "End-to-end approve flow with real rule creation and hot-reload requires a running server."
  - test: "Click Modify on a proposal card, observe the rule editor modal, make a change, click Save"
    expected: "Modal opens pre-filled with sender, destination folder. After saving, exactly one new rule is created (not two). Proposal card disappears."
    why_human: "The critical 'no duplicate rule' invariant (markApproved vs approve endpoint) requires live modal interaction to verify. Unit tests confirm the endpoint separation but not the modal wiring."
  - test: "Click Dismiss on a proposal card"
    expected: "Card fades out with 'Proposal dismissed.' toast. If the same sender generates 5+ more moves, the proposal should reappear."
    why_human: "Toast and card fade animation are browser-only behaviors."
---

# Phase 11: Pattern Detection & Proposed Rules — Verification Report

**Phase Goal:** System analyzes accumulated move signals, identifies repeating patterns, and surfaces them as proposed rules that the user can approve, modify, or dismiss
**Verified:** 2026-04-12T23:41:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System identifies repeating move patterns from move signals using configurable thresholds (minimum count, time span, burst suppression) | PARTIAL | PatternDetector + ProposalStore group signals by sender+envelopeRecipient+sourceFolder and compute strength (matching - contradicting). Thresholds are HARDCODED (strength >= 1 shown, 5+ = strong, 2-4 = moderate) — NOT configurable via config. No time span windowing or burst suppression implemented. CONTEXT.md explicitly placed threshold values in "Claude's Discretion" and RESEARCH.md states "configurable thresholds not explicitly required by user decisions." Functional pattern detection is present; external configurability is absent. |
| 2 | Proposed rules appear in the UI with signal count, plain-language confidence description, and example messages | VERIFIED | GET /api/proposed-rules returns ProposedRuleCard[] with strengthLabel ("Strong pattern (N moves)" etc.), examples from move_signals JOIN, matchingCount. Frontend renderProposalCard() renders all fields. 15 frontend tests + 15 API tests confirm. |
| 3 | User can approve a proposed rule (creating a real rule in the active ruleset), modify it before approving, or dismiss it | VERIFIED | POST /api/proposed-rules/:id/approve calls configRepo.addRule() then proposalStore.approveProposal(). POST /api/proposed-rules/:id/modify returns pre-fill data. POST /api/proposed-rules/:id/dismiss calls proposalStore.dismissProposal(). POST /api/proposed-rules/:id/mark-approved handles Modify flow without duplicate rule creation. All confirmed by 15 API unit tests. |
| 4 | Dismissed patterns are suppressed from future proposals | VERIFIED | dismissProposal() sets status='dismissed'. upsertProposal() increments signals_since_dismiss for dismissed rows and flips to 'active' after 5 signals. getProposals() excludes approved (not dismissed) proposals. Test "increments signals_since_dismiss for dismissed proposals and resurfaces at 5" passes. |
| 5 | Approved rules integrate with existing config hot-reload so they take effect immediately | VERIFIED | Approve endpoint calls deps.configRepo.addRule() which calls ConfigRepository.addRule() — existing code that validates via Zod, persists to config.yml, and triggers notifyRulesChange() (hot-reload). Confirmed in src/web/routes/proposed-rules.ts lines 62-70. |

**Score:** 4/5 truths verified (SC-1 partial due to no external configurability of thresholds)

### Deferred Items

None — no items deferred to later phases.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tracking/proposals.ts` | ProposalStore class with CRUD for proposed_rules table | VERIFIED | 236 lines. Exports ProposalStore. Contains upsertProposal(), getProposals(), getById(), getExampleSubjects(), approveProposal(), dismissProposal(). All use parameterized SQL. |
| `src/tracking/detector.ts` | PatternDetector class that processes signals into proposals | VERIFIED | 20 lines. Exports PatternDetector. processSignal() extracts ProposalKey and calls proposalStore.upsertProposal(). |
| `src/log/migrations.ts` | proposed_rules table migration | VERIFIED | Contains version '20260413_001' with CREATE TABLE proposed_rules and two indexes. |
| `src/shared/types.ts` | ProposedRule, ProposalKey, ExampleMessage, ProposedRuleCard interfaces | VERIFIED | All four interfaces present at lines 140-178. |
| `src/web/routes/proposed-rules.ts` | Fastify route handlers for proposed rules API | VERIFIED | 125 lines. Exports registerProposedRuleRoutes. Five endpoints: GET list, POST approve, POST dismiss, POST modify, POST mark-approved. |
| `src/web/server.ts` | getProposalStore in ServerDeps, registerProposedRuleRoutes call | VERIFIED | getProposalStore: () => ProposalStore in interface. registerProposedRuleRoutes(app, deps) call on line 69. |
| `src/index.ts` | ProposalStore and PatternDetector instantiated and wired | VERIFIED | new ProposalStore(activityLog.getDb()) line 47. new PatternDetector(proposalStore) line 48. patternDetector in MoveTracker deps at line 179. getProposalStore: () => proposalStore in ServerDeps at line 194. |
| `src/web/frontend/index.html` | Proposed nav button with badge span | VERIFIED | Line 17: button data-page="proposed" with span.nav-badge id="proposed-badge". |
| `src/web/frontend/app.ts` | renderProposed(), renderProposalCard(), updateProposedBadge(), pendingProposalApproval | VERIFIED | All functions present. pendingProposalApproval state variable at line 11. navigate() dispatches to renderProposed() at line 62. openRuleModal save handler uses api.proposed.markApproved() at line 289 (not api.proposed.approve). |
| `src/web/frontend/api.ts` | proposed API methods (list, approve, dismiss, getModifyData, markApproved) | VERIFIED | Lines 71-77: proposed object with all five methods. markApproved uses /mark-approved endpoint. |
| `src/web/frontend/styles.css` | Phase 11 proposal card styles | VERIFIED | .proposal-card (line 484), .strength-strong (513), .strength-moderate (518), .strength-weak (523), .strength-ambiguous (528), .btn-dismiss (598), .nav-badge (608). |
| `test/unit/tracking/proposals.test.ts` | ProposalStore unit tests | VERIFIED | 17 test cases. All pass. |
| `test/unit/tracking/detector.test.ts` | PatternDetector unit tests | VERIFIED | 4 test cases. All pass. |
| `test/unit/web/proposed-rules.test.ts` | API route unit tests | VERIFIED | 15 test cases covering all 5 endpoints including mark-approved. All pass. |
| `test/unit/web/frontend.test.ts` | Frontend proposal tests (extended) | VERIFIED | "Proposed Rules page" describe block with 6 tests for list, approve, dismiss, conflict annotation, resurfaced notice. Plus 3 static asset tests. All 15 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tracking/detector.ts` | `src/tracking/proposals.ts` | proposalStore.upsertProposal() | WIRED | Line 18: this.proposalStore.upsertProposal(key, signal.destinationFolder, signal.id) |
| `src/tracking/index.ts` | `src/tracking/detector.ts` | this.deps.patternDetector.processSignal() | WIRED | Lines 291-294: patternDetector optional dep, processSignal called after signal log |
| `src/web/routes/proposed-rules.ts` | `src/tracking/proposals.ts` | deps.getProposalStore() | WIRED | Line 42, 55, 81, 100, 112: all handlers call deps.getProposalStore() |
| `src/web/routes/proposed-rules.ts` | `src/config/repository.ts` | configRepo.addRule() | WIRED | Line 62: deps.configRepo.addRule() in approve handler |
| `src/web/server.ts` | `src/web/routes/proposed-rules.ts` | registerProposedRuleRoutes(app, deps) | WIRED | Line 69: route registration confirmed |
| `src/web/frontend/app.ts` | `src/web/frontend/api.ts` | api.proposed.* | WIRED | Lines 1041, 1056, 1078, 1090: all four api.proposed methods called |
| `src/web/frontend/app.ts` (Modify flow) | /api/proposed-rules/:id/mark-approved | api.proposed.markApproved() | WIRED | Line 289: markApproved called in openRuleModal save handler, NOT approve — correct per plan |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/web/frontend/app.ts` renderProposed() | proposals (ProposedRuleCard[]) | api.proposed.list() -> GET /api/proposed-rules -> ProposalStore.getProposals() | Yes — SQL SELECT from proposed_rules with computed strength | FLOWING |
| `src/web/routes/proposed-rules.ts` GET handler | proposals | ProposalStore.getProposals() | Yes — real SQL with JOIN to move_signals for examples | FLOWING |
| `src/web/frontend/app.ts` renderProposalCard() | p (ProposedRuleCard) | Passed from renderProposed() list iteration | Yes — real data from DB | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All tracking unit tests pass | npx vitest run test/unit/tracking/ | 49 tests pass (5 suites) | PASS |
| Proposed rules API unit tests pass | npx vitest run test/unit/web/proposed-rules.test.ts | 15 tests pass | PASS |
| Frontend tests pass | npx vitest run test/unit/web/frontend.test.ts | 15 tests pass | PASS |
| TypeScript build succeeds | npm run build | tsc + esbuild success | PASS |
| ProposalStore module exports | Node module check | exports ProposalStore class | PASS |
| PatternDetector module exports | Node module check | exports PatternDetector class | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LEARN-03 | 11-01-PLAN.md | Statistical analysis on move signals to identify repeating patterns above configurable thresholds | PARTIAL | Pattern detection engine built and working. Strength computation groups by sender+recipient+source. Thresholds hardcoded (not configurable via config.yml). CONTEXT.md D-04/D-05 + RESEARCH.md explicitly descoped external configurability as "Claude's discretion." Core analysis functionality delivered; config surface area descoped. |
| LEARN-04 | 11-02-PLAN.md, 11-03-PLAN.md | Surface detected patterns as proposed rules in the UI with approve/modify/dismiss actions | VERIFIED | GET /api/proposed-rules returns ProposedRuleCard[] with all required fields. Frontend Proposed tab renders cards with strength badges, examples, conflict annotations. Approve/Modify/Dismiss all wired. |
| LEARN-05 | 11-02-PLAN.md | Approved proposed rules become real rules in the active ruleset with config hot-reload | VERIFIED | POST approve endpoint calls configRepo.addRule() which triggers ConfigRepository.notifyRulesChange(). Confirmed in proposed-rules.ts lines 62-71. |
| UI-02 | 11-03-PLAN.md | Proposed rules view displays detected patterns with signal count, confidence, example messages, and approve/modify/dismiss controls | VERIFIED | Frontend Proposed tab: strength label (plain-language confidence), matchingCount (signal count), examples array (from move_signals JOIN), three action buttons per card. All elements confirmed in app.ts renderProposalCard() and tests. |

**REQUIREMENTS.md Traceability Discrepancy (informational, not a code gap):** The REQUIREMENTS.md traceability table (lines 75-79) incorrectly maps LEARN-03, LEARN-04, LEARN-05, and UI-02 to "Phase 10 Complete." These requirements are covered by Phase 11 per ROADMAP.md Phase 11 requirements field and all three Phase 11 PLAN files. Phase 10 plans only claim LEARN-01 and LEARN-02. REQUIREMENTS.md needs a manual update to reflect Phase 11 as the implementing phase — this is a documentation issue, not a code gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, empty handlers, or stub patterns detected in any Phase 11 files.

### Human Verification Required

#### 1. Empty State Rendering

**Test:** Open the app in a browser, click the "Proposed" tab.
**Expected:** Empty state with heading "No proposed rules yet" and explanatory text about moving messages to generate proposals. No console errors.
**Why human:** Browser DOM rendering is not covered by automated tests — frontend tests only verify compiled JS content strings and API endpoint behavior.

#### 2. Proposal Cards with Live Data

**Test:** Move several messages manually from Inbox to a specific folder, wait for MoveTracker scan cycle, then refresh the Proposed tab.
**Expected:** Proposal cards appear showing a colored strength badge pill ("Weak (1 move)", "Moderate pattern", etc.), sender -> destination route, example message subjects with dates, and three action buttons (Approve, Modify, Dismiss).
**Why human:** Requires live IMAP connection and real move signal accumulation — outside the scope of automated tests.

#### 3. Approve Flow (No Duplicate Rules)

**Test:** Click the "Approve Rule" button on a proposal card.
**Expected:** Card fades out with toast "Rule created and active." Navigate to the Rules tab and confirm exactly one new rule exists named "Auto: \<sender\>". No duplicate rule.
**Why human:** End-to-end approve flow with real ConfigRepository.addRule() and hot-reload requires a running server with connected IMAP.

#### 4. Modify Flow (Critical — No Duplicate Rules)

**Test:** Click "Modify" on a proposal card. Observe the rule editor modal opens pre-filled with the sender and destination folder. Make any change (e.g., add a subject glob). Click Save.
**Expected:** Modal closes. Exactly ONE new rule is created in the Rules tab (not two). The proposal card disappears from the Proposed tab.
**Why human:** The no-duplicate-rule invariant (openRuleModal calls api.rules.create(), then the save handler calls api.proposed.markApproved() — NOT api.proposed.approve()) cannot be verified without live modal interaction. Unit tests confirm endpoint separation but not the modal lifecycle wiring.

#### 5. Dismiss and Resurface

**Test:** Click "Dismiss" on a proposal card.
**Expected:** Card fades out with "Proposal dismissed." toast. The badge count decreases. If the same sender generates 5+ new move signals, the card should reappear with a resurfaced notice.
**Why human:** Toast and fade animations are browser-only. The resurface behavior requires generating 5 real signals, which needs live IMAP.

### Gaps Summary

No hard code gaps found. All must-have artifacts exist, are substantive, and are wired correctly. All 60+ unit tests pass. Build compiles clean.

**SC-1 Partial:** The ROADMAP success criteria mentions "configurable thresholds (minimum count, time span, burst suppression)" but the implementation uses hardcoded strength thresholds with no external config surface. This was explicitly planned as "Claude's discretion" in CONTEXT.md and the RESEARCH.md document states "configurable thresholds not explicitly required by user decisions." The core pattern detection functionality (grouping, strength computation, proposal lifecycle) is fully implemented. The external configurability aspect was descoped during design.

If this deviation needs to be formally accepted, add an override to this file's frontmatter:

```yaml
overrides:
  - must_have: "System identifies repeating move patterns using configurable thresholds (minimum count, time span, burst suppression)"
    reason: "Thresholds hardcoded per CONTEXT.md D-04/D-05 (Claude's discretion). RESEARCH.md explicitly notes configurable thresholds not required by user decisions. Pattern detection engine fully functional."
    accepted_by: "{your name}"
    accepted_at: "{ISO timestamp}"
```

---

_Verified: 2026-04-12T23:41:00Z_
_Verifier: Claude (gsd-verifier)_
