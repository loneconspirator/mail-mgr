---
phase: 06-extended-message-data
verified: 2026-04-12T03:56:14Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "EmailMessage instances populated by Monitor, Sweep, and Batch consumers include envelope recipient and visibility fields derived from fetched headers"
    status: failed
    reason: "Monitor calls parseMessage(raw as ImapFetchResult) without passing envelopeHeader (src/monitor/index.ts line 112). The Monitor stores config.review and config.rules but does not retain config.imap.envelopeHeader. Even when ImapClient conditionally fetches the headers buffer, parseMessage ignores it — envelopeRecipient and visibility are always undefined for Monitor-processed messages. Sweep and Batch consumers use reviewMessageToEmailMessage which correctly passes through fields set by parseRawToReviewMessage inside ImapClient, so they are fine."
    artifacts:
      - path: "src/monitor/index.ts"
        issue: "Line 112: parseMessage(raw as ImapFetchResult) — missing second argument envelopeHeader. Monitor constructor receives Config but does not store config.imap.envelopeHeader."
    missing:
      - "Store config.imap.envelopeHeader in Monitor constructor (e.g., private readonly envelopeHeader: string | undefined)"
      - "Pass envelopeHeader to parseMessage call: parseMessage(raw as ImapFetchResult, this.envelopeHeader)"
---

# Phase 6: Extended Message Data Verification Report

**Phase Goal:** EmailMessage carries envelope recipient and header visibility data, fetched efficiently from IMAP, with auto-discovery of the correct envelope header and versioned schema migrations for all future database changes
**Verified:** 2026-04-12T03:56:14Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System probes a sample of recent messages on IMAP connect and identifies the correct envelope recipient header, persisting the result in config | VERIFIED | src/imap/discovery.ts exports probeEnvelopeHeaders, called in src/index.ts at both initial startup (H4a, line 161) and onImapConfigChange (H3a, line 107). Result saved via saveConfig(). 7 discovery tests pass. |
| 2 | When auto-discovery finds no usable envelope header, envelope recipient and header visibility fields are marked unavailable and rules using them are skipped during evaluation | VERIFIED | classifyVisibility returns undefined when envelopeRecipient is undefined (messages.ts line 120). parseMessage leaves envelopeRecipient/visibility undefined when no envelopeHeader configured. Both paths wrapped in try/catch with graceful degradation. |
| 3 | Auto-discovery re-runs automatically when IMAP server details change and can be triggered manually | VERIFIED (partial — manual trigger deferred to Phase 8) | Automatic re-run on IMAP config change is implemented in onImapConfigChange handler. Manual trigger from UI is deferred to Phase 8 per REQUIREMENTS.md traceability (UI-03 mapped to Phase 8). Auto-discovery on server detail change is the Phase 6 deliverable per MATCH-02 scope split. |
| 4 | EmailMessage instances populated by Monitor, Sweep, and Batch consumers include envelope recipient and visibility fields derived from fetched headers | FAILED | Monitor calls parseMessage(raw as ImapFetchResult) without envelopeHeader argument (src/monitor/index.ts line 112). Monitor constructor receives Config but does not store config.imap.envelopeHeader. Sweep and Batch use reviewMessageToEmailMessage which passes through fields set by parseRawToReviewMessage — those paths are correct. |
| 5 | Database schema changes use versioned transactional migrations instead of try/catch ALTER TABLE | VERIFIED | src/log/migrations.ts with schema_version table, transactional runner, bootstrap migration 20260411_001. src/log/index.ts calls runMigrations(this.db); no private migrate() method or try/catch ALTER TABLE remains. 7 migration tests pass. |

**Score:** 4/5 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Manual UI trigger for auto-discovery | Phase 8 | Phase 8 SC4: "IMAP settings page displays the discovered envelope recipient header name and provides a button to re-run auto-discovery" (UI-03) |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/log/migrations.ts` | Migration definitions and runMigrations function | VERIFIED | Exports Migration interface, migrations array, runMigrations function. 61 lines. |
| `src/log/index.ts` | ActivityLog using versioned migrations | VERIFIED | Imports runMigrations from ./migrations.js, calls runMigrations(this.db) in constructor. No try/catch ALTER TABLE. |
| `test/unit/log/migrations.test.ts` | Tests for migration system | VERIFIED | 139 lines, 7 tests, all pass. |
| `src/imap/messages.ts` | Extended EmailMessage with envelopeRecipient and visibility, parseHeaderLines, classifyVisibility | VERIFIED | Visibility type, envelopeRecipient/visibility on EmailMessage and ReviewMessage, parseHeaderLines, classifyVisibility, updated parseMessage signature all present. |
| `src/imap/client.ts` | Conditional header fetching in fetchNewMessages, fetchAllMessages, parseRawToReviewMessage | VERIFIED | getHeaderFields() present, fetchNewMessages and fetchAllMessages conditionally add headers query param, parseRawToReviewMessage extracts envelopeRecipient and visibility. |
| `src/config/schema.ts` | imapConfigSchema with envelopeHeader optional field | VERIFIED | envelopeHeader: z.string().min(1).optional() present at line 68. |
| `test/unit/imap/messages.test.ts` | Tests for header parsing, visibility classification, extended message parsing | VERIFIED | 405 lines, 31 tests, all pass. |
| `test/unit/imap/client.test.ts` | Tests for conditional header query in fetch methods | VERIFIED | 989 lines, 54 tests, all pass. |
| `src/imap/discovery.ts` | probeEnvelopeHeaders function for auto-discovery | VERIFIED | Exports probeEnvelopeHeaders and CANDIDATE_HEADERS. MIN_CONSENSUS=3, slices last 10, validates '@', uses withMailboxLock. |
| `src/index.ts` | Discovery integrated into onImapConfigChange handler | VERIFIED | probeEnvelopeHeaders called at line 107 (config change) and line 161 (initial startup), both before monitor.start(). saveConfig called in both paths. |
| `test/unit/imap/discovery.test.ts` | Tests for header probing, consensus logic, threshold behavior | VERIFIED | 109 lines, 7 tests, all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/log/index.ts | src/log/migrations.ts | import runMigrations | WIRED | Line 6: `import { runMigrations } from './migrations.js'`; line 56: `runMigrations(this.db)` |
| src/imap/client.ts | src/imap/messages.ts | parseRawToReviewMessage calls parseHeaderLines and classifyVisibility | WIRED | Lines 3-4: imports parseHeaderLines, classifyVisibility. Both called in parseRawToReviewMessage (lines 270-276). |
| src/imap/client.ts | src/config/schema.ts | ImapConfig.envelopeHeader drives getHeaderFields() | WIRED | Line 194: `if (!this.config.envelopeHeader) return undefined` |
| src/index.ts | src/imap/discovery.ts | import probeEnvelopeHeaders, called in onImapConfigChange | WIRED | Line 7: import. Lines 107 and 161: calls before monitor.start(). |
| src/imap/discovery.ts | src/imap/client.ts | Uses ImapClient.withMailboxLock to fetch headers | WIRED | Line 23: `client.withMailboxLock('INBOX', ...)` |
| src/index.ts | src/config/repository.ts | Calls configRepo to persist discovered envelopeHeader | WIRED | Lines 114-116: `cfg.imap.envelopeHeader = discoveredHeader ?? undefined; saveConfig(configPath, cfg)` |
| src/monitor/index.ts | src/imap/messages.ts | parseMessage called with envelopeHeader | NOT WIRED | Line 112: `parseMessage(raw as ImapFetchResult)` — envelopeHeader argument missing. Monitor does not store config.imap.envelopeHeader. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| src/imap/client.ts parseRawToReviewMessage | envelopeRecipient, visibility | parseHeaderLines(msg.headers) when config.envelopeHeader set | Yes — conditional on envelopeHeader config | FLOWING (sweep/batch path) |
| src/imap/messages.ts parseMessage | envelopeRecipient, visibility | parseHeaderLines(fetched.headers) when envelopeHeader param provided | Yes — conditional on param | DISCONNECTED for Monitor (envelopeHeader never passed) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All phase 6 unit tests pass | npx vitest run test/unit/log/migrations.test.ts test/unit/imap/messages.test.ts test/unit/imap/client.test.ts test/unit/imap/discovery.test.ts | 99 tests passed | PASS |
| Full test suite passes | npx vitest run | 385 tests passed, 20 test files | PASS |
| probeEnvelopeHeaders called before monitor.start() in both code paths | grep confirmed lines 107/121 (config change) and 161/175 (initial startup) | Both discovery calls precede monitor.start() | PASS |
| try/catch ALTER TABLE fully removed | grep -n "private migrate\|ALTER TABLE activity ADD COLUMN source" src/log/index.ts | Zero matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MATCH-01 | 06-03 | System auto-discovers envelope recipient header by probing common headers on sample of recent messages, storing found header name in config | SATISFIED | probeEnvelopeHeaders probes 5 CANDIDATE_HEADERS in 10 most recent messages. Result saved to config.yml via saveConfig. MIN_CONSENSUS=3. |
| MATCH-02 | 06-03 | Auto-discovery triggers automatically on successful IMAP connect when server details change, and can be manually invoked from the UI | PARTIAL | Automatic trigger on IMAP config change implemented. Manual UI trigger deferred to Phase 8 (UI-03). |
| MATCH-06 | 06-01, 06-02 | When envelope recipient header not configured, envelope recipient and header visibility match fields are disabled and rules using them are skipped | PARTIALLY SATISFIED | classifyVisibility returns undefined when envelopeRecipient undefined. parseMessage leaves fields undefined when envelopeHeader not configured. However, Monitor never passes envelopeHeader to parseMessage, so Monitor messages always have undefined fields regardless of config — this is the SC4 gap. |

### Anti-Patterns Found

None. All modified files are clean — no TODOs, FIXMEs, placeholders, console.log stubs, or empty implementations found.

### Human Verification Required

None. All verification items are programmatically determinable.

### Gaps Summary

**One gap blocking full goal achievement:**

The Monitor (`src/monitor/index.ts`) processes arriving messages by calling `parseMessage(raw as ImapFetchResult)` without the second `envelopeHeader` argument. The Monitor constructor receives `Config` but only extracts `reviewFolder`, `trashFolder`, and `rules` — it discards `config.imap.envelopeHeader`. Even though `ImapClient.fetchNewMessages()` conditionally fetches the headers buffer when `envelopeHeader` is configured, the Monitor's `parseMessage` call ignores that buffer, producing `EmailMessage` instances with `undefined` `envelopeRecipient` and `visibility` for all arrival-time messages.

Sweep and Batch are unaffected — they go through `fetchAllMessages` → `parseRawToReviewMessage` (inside ImapClient) which correctly reads `this.config.envelopeHeader`. The gap is isolated to the Monitor's direct `parseMessage` call.

**Fix is small:** Store `config.imap.envelopeHeader` in the Monitor constructor and pass it to `parseMessage`.

Note: This gap may be addressed in Phase 7 ("Rules using new match fields work identically in Monitor (live), Sweep (review), and Batch (retroactive) contexts" — SC4), but it is a Phase 6 deliverable gap per SC4 of this phase.

---

_Verified: 2026-04-12T03:56:14Z_
_Verifier: Claude (gsd-verifier)_
