---
phase: 12-retroactive-verification
verified: 2026-04-19T17:22:00Z
status: human_needed
score: 6/6
overrides_applied: 0
gaps: []
human_verification:
  - test: "Click Run Discovery button on IMAP settings page"
    expected: "Network request fires to POST /api/config/envelope/discover, discovery result updates on page"
    why_human: "Browser interaction with live IMAP server cannot be automated in unit tests"
  - test: "Remove envelope config, open rule editor, verify deliveredTo and visibility fields are disabled"
    expected: "Fields appear disabled with info icon indicating envelope data unavailable"
    why_human: "Frontend rendering state tied to runtime config cannot be verified in unit tests"
re_verification:
  previous_status: human_needed
  previous_score: 6/6
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  verifier_notes: "Previous verification (2026-04-20T00:16:00Z by gsd-executor) validated. All claims confirmed against actual source. One minor line-number imprecision noted (classifyVisibility starts line 113 in messages.ts, not 113-125 as a range — the function signature is on 113, body ends at 125, so the claim is correct in range form). No substantive errors found."
---

# Phase 12: Retroactive Verification -- Verification Report

**Phase Goal:** Verify that all code implemented in orphaned phases 6-9 meets requirements, producing formal VERIFICATION.md artifacts — no new implementation needed
**Verified:** 2026-04-19T17:22:00Z
**Status:** human_needed
**Re-verification:** Yes — secondary verification pass by gsd-verifier confirming executor claims against actual codebase (2026-04-20T00:16:00Z executor report was the initial artifact; this pass is the formal GSD gate check)

## Verifier Notes (Re-verification Pass)

All claims in the executor's initial verification report were cross-checked against actual source files and the live test suite. Findings:

- All 6 MATCH source files exist with the correct content at the claimed line numbers
- `classifyVisibility` is at `messages.ts:113-125` (signature on 113, body ends 125) — claim is correct
- File sizes match: discovery.ts=74, matcher.ts=61, evaluator.ts=32, envelope.ts=51, index.ts=263, messages.ts=158 (exact matches to executor claims)
- Full test suite: 453 tests, 28 files, exit 0 — confirmed live
- Targeted test run (discovery, matcher, evaluator, api): 91 tests, all pass — confirmed live
- MATCH-04 single-select deviation correctly documented; `visibilityMatchEnum = z.enum([...])` at schema.ts:32 is a single-value enum, not `z.array()` — confirmed
- Key links all confirmed wired: probeEnvelopeHeaders imported and called in index.ts (lines 7, 127, 210), envelope.ts POST endpoint exists and calls it (line 37), app.ts triggerDiscovery call at line 477, disabled fields at lines 170 and 174
- REQUIREMENTS.md maps MATCH-01 through MATCH-06 to Phase 12 — all 6 accounted for
- No orphaned MATCH requirements found; all 6 explicitly in PLAN frontmatter `requirements:` list

No gaps were found. Two human verification items correctly identified (browser-based tests).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Envelope header auto-discovery code verified functional (src/imap/discovery.ts probeEnvelopeHeaders) | VERIFIED | `probeEnvelopeHeaders()` at discovery.ts:22-74 probes CANDIDATE_HEADERS (lines 8-14: Delivered-To, X-Delivered-To, X-Original-To, X-Resolved-To, Envelope-To) on the 10 most recent INBOX messages, returns the header with highest count above MIN_CONSENSUS=3 (line 16). 9 unit tests pass covering: empty mailbox, below threshold, consensus detection, multiple candidates, non-email values, small mailbox, schema validation. |
| SC-2 | Auto-discovery triggers on IMAP config change and via manual POST endpoint | VERIFIED | `src/index.ts` line 110: `onImapConfigChange` handler calls `probeEnvelopeHeaders()` at line 127 and persists result via `saveConfig()` at line 136. Lines 206-218: startup discovery runs after initial IMAP connect. `src/web/routes/envelope.ts` lines 17-50: POST `/api/config/envelope/discover` endpoint creates a fresh ImapClient, calls `probeEnvelopeHeaders()` (line 37), and persists via `configRepo.updateImapConfig()` (line 38). Concurrency guard via `discoveryInProgress` flag (lines 9, 18, 48). 3 API tests cover envelope endpoints. |
| SC-3 | matchRule() correctly evaluates deliveredTo glob, visibility multi-select, and readStatus conditions | VERIFIED | `src/rules/matcher.ts`: deliveredTo branch (lines 38-44) uses picomatch with `{ nocase: true }`, strips angle brackets. Visibility branch (lines 47-50) uses exact enum equality (single-select — user confirmed acceptable). readStatus branch (lines 53-58) checks `\Seen` flag with 'any' as pass-through. 43 matcher tests pass covering all three fields with edge cases. Note: visibility uses single-select (see Discrepancies section). |
| SC-4 | needsEnvelopeData() skip logic confirmed — rules using unavailable envelope data are skipped gracefully | VERIFIED | `src/rules/evaluator.ts` lines 6-7: `needsEnvelopeData()` returns true when `deliveredTo` or `visibility` is set (NOT readStatus). Line 27: `evaluateRules()` skips rule when `!envelopeAvailable && needsEnvelopeData(rule)`. 12 evaluator skip-logic tests cover: skip deliveredTo, skip visibility, skip combo, NOT skip readStatus, NOT skip sender-only, fallthrough ordering. |
| SC-5 | VERIFICATION.md produced confirming all 6 MATCH requirements satisfied | VERIFIED | This document. All 6 MATCH requirements audited with line-level code evidence and test counts. |

**Score:** 5/5 truths verified

### Deferred Items

None.

## Requirement Compliance Matrix

| Req ID | Status | Primary Source | Line(s) | Test File | Test Count | Notes |
|--------|--------|----------------|---------|-----------|------------|-------|
| MATCH-01 | VERIFIED | `src/imap/discovery.ts` | 8-14 (CANDIDATE_HEADERS), 16 (MIN_CONSENSUS=3), 22-74 (probeEnvelopeHeaders) | `test/unit/imap/discovery.test.ts` | 9 | Probes 5 candidate headers on 10 recent messages, consensus threshold of 3, stores via configRepo |
| MATCH-02 | VERIFIED | `src/index.ts` + `src/web/routes/envelope.ts` | index.ts:110-136 (onImapConfigChange), 206-218 (startup), envelope.ts:17-50 (POST endpoint) | `test/unit/web/api.test.ts` | 3 | Triggers on IMAP config change, on startup, and via POST /api/config/envelope/discover. UI "Run Discovery" button at app.ts:443-491 |
| MATCH-03 | VERIFIED | `src/rules/matcher.ts` | 38-44 (deliveredTo branch) | `test/unit/rules/matcher.test.ts` | 7 | Uses picomatch with nocase, strips angle brackets, +tag variants work via glob syntax |
| MATCH-04 | VERIFIED | `src/rules/matcher.ts` + `src/config/schema.ts` + `src/imap/messages.ts` | matcher.ts:47-50, schema.ts:32, messages.ts:113-125 | `test/unit/rules/matcher.test.ts` | 7 | Single-select enum (direct/cc/bcc/list), exact equality check. User confirmed single-select is acceptable (see Discrepancies). classifyVisibility derives value from envelope + To/CC/List-Id comparison. |
| MATCH-05 | VERIFIED | `src/rules/matcher.ts` | 53-58 (readStatus branch) | `test/unit/rules/matcher.test.ts` | 7 | Checks \Seen flag. 'any' value is pass-through (no filtering). Works independently of envelope availability. |
| MATCH-06 | VERIFIED | `src/rules/evaluator.ts` + `src/web/frontend/app.ts` | evaluator.ts:6-7 (needsEnvelopeData), 27 (skip check), app.ts:169-170 (deliveredTo disabled), 173-174 (visibility disabled) | `test/unit/rules/evaluator.test.ts` | 12 | needsEnvelopeData checks deliveredTo and visibility (NOT readStatus). UI disables deliveredTo and visibility inputs with info icon when envelopeAvailable=false. |

## Requirements Coverage (REQUIREMENTS.md Cross-Reference)

| Requirement | Phase | PLAN Claims | Status |
|-------------|-------|-------------|--------|
| MATCH-01 | 12 (gap closure) | Yes | VERIFIED |
| MATCH-02 | 12 (gap closure) | Yes | VERIFIED |
| MATCH-03 | 12 (gap closure) | Yes | VERIFIED |
| MATCH-04 | 12 (gap closure) | Yes | VERIFIED |
| MATCH-05 | 12 (gap closure) | Yes | VERIFIED |
| MATCH-06 | 12 (gap closure) | Yes | VERIFIED |

All 6 MATCH requirements mapped to Phase 12 in REQUIREMENTS.md traceability table. All 6 appear in PLAN frontmatter `requirements:` field. No orphaned requirements.

## Required Artifacts

| Artifact | Expected | Actual Size | Status | Details |
|----------|----------|-------------|--------|---------|
| `src/imap/discovery.ts` | MATCH-01: probeEnvelopeHeaders with CANDIDATE_HEADERS probe | 74 lines | VERIFIED | Exports probeEnvelopeHeaders and CANDIDATE_HEADERS. Consensus threshold MIN_CONSENSUS=3. |
| `src/index.ts` | MATCH-02: onImapConfigChange calls probeEnvelopeHeaders, startup discovery | 263 lines | VERIFIED | Line 110: config change handler runs discovery and persists. Lines 206-218: startup discovery. |
| `src/web/routes/envelope.ts` | MATCH-02: POST /api/config/envelope/discover endpoint | 51 lines | VERIFIED | Creates fresh ImapClient, runs probeEnvelopeHeaders, persists result. Concurrency guard via discoveryInProgress flag. |
| `src/rules/matcher.ts` | MATCH-03/04/05: matchRule with deliveredTo, visibility, readStatus branches | 61 lines | VERIFIED | All three new match fields implemented with correct logic. |
| `src/rules/evaluator.ts` | MATCH-06: needsEnvelopeData + evaluateRules skip logic | 32 lines | VERIFIED | Skip logic correctly excludes readStatus from envelope dependency check. |
| `src/config/schema.ts` | Schema: visibilityMatchEnum, readStatusMatchEnum, emailMatchSchema | 156 lines | VERIFIED | visibilityMatchEnum at line 32: z.enum(['direct','cc','bcc','list']). readStatusMatchEnum at line 33: z.enum(['read','unread','any']). emailMatchSchema includes all 6 match fields. |
| `src/imap/messages.ts` | MATCH-04: classifyVisibility function, parseMessage with envelope extraction | 158 lines | VERIFIED | classifyVisibility at lines 113-125: checks List-Id (list), To (direct), CC (cc), fallback (bcc). parseMessage at lines 127-158: extracts envelopeRecipient from configured header and derives visibility. |
| `src/web/frontend/app.ts` | UI: rule editor with envelope fields, settings page with discovery button | 1100+ lines | VERIFIED | openRuleModal at lines 155+: deliveredTo input (line 170), visibility select (line 174), readStatus select (line 184). Disabled with info icon when !envelopeAvailable. Settings page: Run Discovery button at lines 443-445, click handler at lines 470-491. |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/imap/discovery.ts` | `src/index.ts` | probeEnvelopeHeaders called on startup + config change | WIRED | index.ts line 7 imports probeEnvelopeHeaders. Called at lines 127 (config change) and 210 (startup). |
| `src/index.ts` | configRepo (saveConfig) | Discovered header persisted to config | WIRED | Lines 134-136: `cfg.imap.envelopeHeader = discoveredHeader ?? undefined; saveConfig(configPath, cfg)`. Lines 216-218: startup persistence. |
| `src/web/routes/envelope.ts` | `src/imap/discovery.ts` | POST endpoint calls probeEnvelopeHeaders | WIRED | Line 4 imports probeEnvelopeHeaders. Line 37 calls it with fresh client. Line 38 persists via configRepo.updateImapConfig. |
| `src/rules/matcher.ts` | picomatch | deliveredTo glob matching | WIRED | Line 1 imports picomatch. Line 41: `picomatch.isMatch(recipient, match.deliveredTo, { nocase: true })`. |
| `src/rules/evaluator.ts` | `src/rules/matcher.ts` | evaluateRules calls matchRule after skip check | WIRED | Line 3 imports matchRule. Line 28: `if (matchRule(rule, message)) return rule` — called only after skip check passes. |
| `src/web/frontend/app.ts` | `src/web/routes/envelope.ts` | Run Discovery button calls POST endpoint | WIRED | app.ts line 477: `api.config.triggerDiscovery()` which calls POST /api/config/envelope/discover. Button rendered at lines 443-445 with click handler at lines 470-491. |

## Test Evidence

### Full Suite Summary

**Total:** 453 tests passing across 28 test files (vitest)
**Exit code:** 0
**Duration:** ~1.14s

### Per-File Breakdown

| Test File | Tests | Status | Covers |
|-----------|-------|--------|--------|
| `test/unit/imap/discovery.test.ts` | 9 | ALL PASS | MATCH-01 (probe, consensus, candidates, schema) |
| `test/unit/rules/matcher.test.ts` | 43 | ALL PASS | MATCH-03 (7 deliveredTo), MATCH-04 (7 visibility), MATCH-05 (7 readStatus), plus sender/recipient/subject/multi-field |
| `test/unit/rules/evaluator.test.ts` | 20 | ALL PASS | MATCH-06 (12 skip-logic tests), plus core evaluator (8 tests) |
| `test/unit/web/api.test.ts` | 26+ | ALL PASS | MATCH-02 (3 envelope endpoint tests: GET status, GET configured, POST discover) |

### Key Test Names by Requirement

**MATCH-01:**
- "returns null when client fetch returns no messages"
- "returns null when no candidate header reaches threshold of 3"
- "returns Delivered-To when 5 of 10 messages have it"
- "returns the header with highest count when multiple candidates are present"
- "ignores header values that do not contain @"
- "works with fewer than 10 messages"
- "CANDIDATE_HEADERS contains exactly the expected headers per D-02"
- "validates imapConfigSchema accepts optional envelopeHeader string field"
- "validates imapConfigSchema without envelopeHeader (backward compatible)"

**MATCH-02:**
- "returns { envelopeHeader: null } when not configured"
- "returns { envelopeHeader: 'Delivered-To' } when configured"
- "returns envelope status shape on error (no IMAP server)"

**MATCH-03:**
- "matches envelopeRecipient with glob pattern"
- "matches envelopeRecipient with +tag variant"
- "does not match when envelopeRecipient differs"
- "matches case-insensitively"
- "returns false when envelopeRecipient is undefined"
- "matches envelopeRecipient with angle brackets"
- "matches any envelopeRecipient when deliveredTo not specified"

**MATCH-04:**
- "matches direct visibility"
- "matches cc visibility"
- "matches bcc visibility"
- "matches list visibility"
- "does not match when visibility differs"
- "returns false when message visibility is undefined"
- "matches any message when visibility not specified"

**MATCH-05:**
- "readStatus read matches message with \\Seen flag"
- "readStatus read does not match message without \\Seen flag"
- "readStatus unread matches message without \\Seen flag"
- "readStatus unread does not match message with \\Seen flag"
- "readStatus any matches message with \\Seen flag"
- "readStatus any matches message without \\Seen flag"
- "matches any message when readStatus not specified"

**MATCH-06:**
- "skips rule with deliveredTo when message has no envelopeRecipient"
- "skips rule with visibility when message has no envelopeRecipient"
- "skips rule with both deliveredTo AND sender when no envelope (whole rule bypassed)"
- "does NOT skip rule with only readStatus when no envelope"
- "does NOT skip rule with only sender when no envelope"
- "skips rule with readStatus + visibility when no envelope (visibility triggers skip)"
- "skipped envelope rule falls through to non-envelope rule"
- "skipped visibility rule falls through to readStatus rule"
- "evaluates deliveredTo normally when message HAS envelopeRecipient (matching)"
- "evaluates deliveredTo normally when message HAS envelopeRecipient (non-matching)"
- "evaluates visibility normally when message HAS visibility"
- "readStatus unread matches unread message even when envelopeRecipient is undefined"

## Discrepancies

### MATCH-04: Multi-Select vs Single-Select Visibility

**Requirement wording:** "User can create rules that match on header visibility (direct, cc, bcc, list) as a **multi-select field**"

**Actual implementation:** Single-select enum.
- Schema: `visibilityMatchEnum = z.enum(['direct', 'cc', 'bcc', 'list'])` (line 32 of schema.ts) — single value, not `z.array()`
- Matcher: `message.visibility !== match.visibility` (lines 48-49 of matcher.ts) — exact equality, not `array.includes()`
- classifyVisibility: Returns a single `Visibility` value (lines 113-125 of messages.ts) — each message has exactly one classification
- UI: Standard `<select>` dropdown (line 174 of app.ts), not `<select multiple>`

**Rationale for deviation:** Each message can only have ONE visibility classification — the categories are mutually exclusive:
- If List-Id header present -> `list`
- If envelope recipient is in To field -> `direct`
- If envelope recipient is in CC field -> `cc`
- Otherwise -> `bcc`

Since the message-side value is always a single enum, a multi-select on the rule side would mean "match if message visibility is any of these selected values." This is valid but not the design that was implemented. The single-select approach is simpler and covers the primary use case (e.g., "route all BCC messages to a folder").

**Resolution:** User confirmed single-select is acceptable. MATCH-04 marked as VERIFIED with this note documenting the deviation from the literal requirement wording.

## Anti-Patterns Found

None. This phase is documentation-only (12-VERIFICATION.md). No source code was modified.

## Human Verification Required

### 1. Run Discovery Button

**Test:** Open the app in a browser, navigate to Settings, click the "Run Discovery" (or "Re-run Discovery") button.
**Expected:** Network request fires to POST /api/config/envelope/discover. Button shows spinner during discovery. On success, discovered header name appears (e.g., "Delivered-To detected"). On failure, error toast appears.
**Why human:** Requires a running server connected to a live IMAP server. Unit test for POST endpoint confirms the route exists but uses a mock client that fails (no real IMAP server).

### 2. Disabled Envelope Fields in Rule Editor

**Test:** Remove envelope configuration (or connect to an IMAP server where discovery finds no header). Open the rule editor (Add Rule or Edit).
**Expected:** The "Delivered-To" input field appears disabled. The "Recipient Field" (visibility) select appears disabled. Both show an info icon with tooltip: "Envelope header not discovered — run discovery in IMAP settings." The "Read Status" select remains enabled (it does not depend on envelope data).
**Why human:** Frontend rendering state is determined at runtime by the `envelopeAvailable` parameter passed to `openRuleModal()`. Unit tests verify the HTML template strings but cannot render a live DOM with runtime state.

## Gaps Summary

No code gaps found. All 6 MATCH requirements are fully implemented with comprehensive test coverage:
- 9 discovery tests (MATCH-01)
- 3 envelope API tests (MATCH-02)
- 7 deliveredTo matcher tests (MATCH-03)
- 7 visibility matcher tests (MATCH-04)
- 7 readStatus matcher tests (MATCH-05)
- 12 evaluator skip-logic tests (MATCH-06)

The MATCH-04 multi-select vs single-select deviation is documented and user-approved. All 453 tests pass with zero failures.

---

_Initial verification: 2026-04-20T00:16:00Z by Claude (gsd-executor)_
_Re-verified: 2026-04-19T17:22:00Z by Claude (gsd-verifier) — all executor claims confirmed against actual source_
