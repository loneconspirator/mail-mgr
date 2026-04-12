---
phase: 06-extended-message-data
verified: 2026-04-12T21:16:30Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Monitor calls parseMessage with envelopeHeader argument — private envelopeHeader field added to Monitor, stored from config.imap.envelopeHeader, passed to parseMessage call at line 114"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "Auto-discovery can be manually invoked from the UI"
    addressed_in: "Phase 8"
    evidence: "Phase 8 success criteria: IMAP settings page displays discovered envelope recipient header and provides button to re-run auto-discovery (UI-03)"
---

# Phase 6: Extended Message Data Verification Report

**Phase Goal:** EmailMessage carries envelope recipient and header visibility data, fetched efficiently from IMAP, with auto-discovery of the correct envelope header and versioned schema migrations for all future database changes
**Verified:** 2026-04-12T21:16:30Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plan 04)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System probes a sample of recent messages on IMAP connect and identifies the correct envelope recipient header, persisting the result in config | VERIFIED | src/imap/discovery.ts exports probeEnvelopeHeaders, called in src/index.ts at both initial startup (line 161, H4a) and onImapConfigChange (line 107, H3a). Result saved via saveConfig(). 7 discovery tests pass. |
| 2 | When auto-discovery finds no usable envelope header, envelope recipient and header visibility fields are marked unavailable and rules using them are skipped during evaluation | VERIFIED | classifyVisibility returns undefined when envelopeRecipient is undefined (messages.ts). parseMessage leaves envelopeRecipient/visibility undefined when no envelopeHeader configured. Both code paths wrapped in try/catch with graceful degradation. |
| 3 | Auto-discovery re-runs automatically when IMAP server details change (manual UI trigger deferred to Phase 8) | VERIFIED | Automatic re-run on IMAP config change implemented in onImapConfigChange handler (src/index.ts line 107). Manual trigger from UI deferred to Phase 8 per REQUIREMENTS.md traceability (UI-03 mapped to Phase 8). |
| 4 | EmailMessage instances populated by Monitor, Sweep, and Batch consumers include envelope recipient and visibility fields derived from fetched headers | VERIFIED | Monitor (src/monitor/index.ts): private envelopeHeader field at line 31, stored in constructor at line 45, passed to parseMessage at line 114. Sweep/Batch paths use reviewMessageToEmailMessage which passes through fields set by parseRawToReviewMessage. All three consumer paths now wired. 18/18 monitor tests pass including 3 new envelopeHeader passthrough tests. |
| 5 | Database schema changes use versioned transactional migrations instead of try/catch ALTER TABLE | VERIFIED | src/log/migrations.ts with schema_version table, transactional runner, bootstrap migration 20260411_001. src/log/index.ts imports runMigrations from ./migrations.js and calls runMigrations(this.db) in constructor. No private migrate() method or try/catch ALTER TABLE remains. 7 migration tests pass. |

**Score:** 5/5 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Manual UI trigger for auto-discovery | Phase 8 | Phase 8 success criteria: IMAP settings page displays discovered envelope recipient header and provides button to re-run auto-discovery (UI-03) |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/log/migrations.ts` | Migration definitions and runMigrations function | VERIFIED | Exports Migration interface, migrations array, runMigrations. Bootstrap migration 20260411_001 present. |
| `src/log/index.ts` | ActivityLog using versioned migrations | VERIFIED | Imports runMigrations from ./migrations.js, calls runMigrations(this.db) in constructor. No try/catch ALTER TABLE. |
| `test/unit/log/migrations.test.ts` | Tests for migration system | VERIFIED | 7 tests, all pass. |
| `src/imap/messages.ts` | Extended EmailMessage with envelopeRecipient and visibility, parseHeaderLines, classifyVisibility | VERIFIED | Visibility type, envelopeRecipient/visibility on EmailMessage and ReviewMessage, parseHeaderLines, classifyVisibility, updated parseMessage signature all present. |
| `src/imap/client.ts` | Conditional header fetching in fetchNewMessages, fetchAllMessages, parseRawToReviewMessage | VERIFIED | getHeaderFields() present, fetchNewMessages and fetchAllMessages conditionally add headers query param, parseRawToReviewMessage extracts envelopeRecipient and visibility. |
| `src/config/schema.ts` | imapConfigSchema with envelopeHeader optional field | VERIFIED | envelopeHeader: z.string().min(1).optional() at line 68. Backward compatible. |
| `test/unit/imap/messages.test.ts` | Tests for header parsing, visibility classification, extended message parsing | VERIFIED | 31 tests, all pass. |
| `test/unit/imap/client.test.ts` | Tests for conditional header query in fetch methods | VERIFIED | 54 tests, all pass. |
| `src/imap/discovery.ts` | probeEnvelopeHeaders function for auto-discovery | VERIFIED | Exports probeEnvelopeHeaders and CANDIDATE_HEADERS. MIN_CONSENSUS=3, slices last 10, validates '@', uses withMailboxLock. |
| `src/index.ts` | Discovery integrated into onImapConfigChange handler and initial startup | VERIFIED | probeEnvelopeHeaders called at line 107 (config change) and line 161 (initial startup), both before monitor.start(). saveConfig called in both paths. |
| `test/unit/imap/discovery.test.ts` | Tests for header probing, consensus logic, threshold behavior | VERIFIED | 7 tests, all pass. |
| `src/monitor/index.ts` | Monitor stores envelopeHeader and passes it to parseMessage | VERIFIED | private envelopeHeader field (line 31), stored in constructor (line 45), passed to parseMessage (line 114). Previously-identified gap is closed. |
| `test/unit/monitor/monitor.test.ts` | Tests proving envelopeHeader is passed to parseMessage | VERIFIED | 3 new envelopeHeader passthrough tests in describe block. 18/18 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/log/index.ts | src/log/migrations.ts | import runMigrations | WIRED | Line 6: import; line 56: runMigrations(this.db) |
| src/imap/client.ts | src/imap/messages.ts | parseRawToReviewMessage calls parseHeaderLines and classifyVisibility | WIRED | Both functions called in parseRawToReviewMessage |
| src/imap/client.ts | src/config/schema.ts | ImapConfig.envelopeHeader drives getHeaderFields() | WIRED | getHeaderFields() gates on this.config.envelopeHeader |
| src/index.ts | src/imap/discovery.ts | import probeEnvelopeHeaders, called in onImapConfigChange | WIRED | Lines 107 and 161: both calls precede monitor.start() |
| src/imap/discovery.ts | src/imap/client.ts | Uses ImapClient.withMailboxLock to fetch headers | WIRED | client.withMailboxLock('INBOX', ...) in probeEnvelopeHeaders |
| src/index.ts | src/config/repository.ts | Calls configRepo to persist discovered envelopeHeader | WIRED | cfg.imap.envelopeHeader updated, saveConfig called in both paths |
| src/monitor/index.ts | src/imap/messages.ts | parseMessage called with envelopeHeader | WIRED | Line 114: parseMessage(raw as ImapFetchResult, this.envelopeHeader) — gap from initial verification closed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| src/imap/client.ts parseRawToReviewMessage | envelopeRecipient, visibility | parseHeaderLines(msg.headers) when config.envelopeHeader set | Yes — conditional on envelopeHeader config | FLOWING |
| src/monitor/index.ts processNewMessages | envelopeRecipient, visibility | parseMessage(raw, this.envelopeHeader) → parseHeaderLines | Yes — this.envelopeHeader now passed from config.imap.envelopeHeader | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Monitor envelopeHeader passthrough tests | npx vitest run test/unit/monitor/monitor.test.ts | 18/18 pass, 3 new envelopeHeader tests included | PASS |
| Full test suite | npx vitest run | 388/388 tests pass, 20 test files | PASS |
| probeEnvelopeHeaders called before monitor.start() in both code paths | grep on src/index.ts | Lines 107/121 (config change) and 161/175 (initial startup) — discovery precedes monitor.start() in both | PASS |
| try/catch ALTER TABLE fully removed | grep private migrate in src/log/index.ts | Zero matches | PASS |
| Monitor parseMessage wiring | grep parseMessage.*envelopeHeader in src/monitor/index.ts | Line 114 confirms argument passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MATCH-01 | 06-03 | System auto-discovers envelope recipient header by probing common headers on sample of recent messages, storing found header name in config | SATISFIED | probeEnvelopeHeaders probes 5 CANDIDATE_HEADERS in 10 most recent messages. MIN_CONSENSUS=3. Result saved to config.yml via saveConfig. |
| MATCH-02 | 06-03 | Auto-discovery triggers automatically on successful IMAP connect when server details change, and can be manually invoked from the UI | PHASE 6 SCOPE MET | Automatic trigger on IMAP config change implemented. Manual UI trigger deferred to Phase 8 (UI-03) per REQUIREMENTS.md traceability. |
| MATCH-06 | 06-01, 06-02, 06-04 | When envelope recipient header not configured, envelope recipient and header visibility match fields are disabled and rules using them are skipped | SATISFIED | classifyVisibility returns undefined when envelopeRecipient undefined. parseMessage leaves fields undefined when no envelopeHeader provided. Monitor now correctly passes envelopeHeader (or undefined) — MATCH-06 graceful degradation works across all consumers. |

### Anti-Patterns Found

None. All modified files are clean — no TODOs, FIXMEs, placeholders, or stubs found in any phase 6 artifacts.

### Human Verification Required

None. All verification items are programmatically determinable.

### Gaps Summary

No gaps. The single gap from the initial verification — Monitor calling parseMessage without the envelopeHeader argument — was closed by Plan 04. The Monitor now stores config.imap.envelopeHeader in a private field and passes it to every parseMessage call. The full test suite passes at 388/388, up from 384/388 (the 4 pre-existing frontend.test.ts failures are also resolved).

---

_Verified: 2026-04-12T21:16:30Z_
_Verifier: Claude (gsd-verifier)_
