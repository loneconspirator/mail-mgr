# Project Research Summary

**Project:** Mail Manager v0.4 — Extended Matchers and Behavioral Learning
**Domain:** Email organization system — IMAP rule engine extension with user behavior tracking
**Researched:** 2026-04-11
**Confidence:** HIGH

## Executive Summary

v0.4 divides into two conceptually distinct additions to the existing rule engine. The first is an extended matcher layer: envelope recipient (Delivered-To / X-Delivered-To headers), header visibility classification (direct / CC / BCC / list), and read status matching. All three are built entirely on capabilities the existing stack already possesses — imapflow's `headers` fetch option, the envelope, and the `\Seen` flag in `message.flags`. No new runtime dependencies are required. The work is wiring up existing library features and extending the `EmailMessage` type, match schema, and `matchRule()` function.

The second addition is a behavioral learning subsystem: periodic folder scanning to detect user-initiated moves, a statistical pattern detector that groups those move signals into candidate rules, and a proposals UI for review and approval. This is genuinely new infrastructure — two new SQLite tables, two new service classes (`MoveTracker`, `PatternDetector`), and a new API route group. The design follows the same dependency-injection and hot-reload patterns established by `Monitor`, `ReviewSweeper`, and `BatchEngine`. The critical architectural insight is that move tracking cannot use IMAP CONDSTORE (which tracks flag changes within a single mailbox, not cross-folder moves) and must instead use periodic UID snapshot diffing.

The primary risks are: (1) conflating the system's own automated moves with user-initiated moves — the move tracker must cross-reference the activity log using Message-ID, not UID, to suppress false signals; (2) schema migration fragility — new tables need version-gated transactional migrations, not scattered try/catch ALTER TABLE blocks; and (3) false positive rule proposals from small samples — the pattern detector must require a minimum move count, a minimum time span, and burst suppression before proposing a rule. All three risks have clear prevention strategies and none require redesigning the architecture.

## Key Findings

### Recommended Stack

No new runtime dependencies are needed for v0.4. The existing stack covers every requirement: imapflow 1.2.8 already supports the `headers` array fetch option (returning a raw `Buffer` via `BODY.PEEK[HEADER.FIELDS]`), CONDSTORE auto-enables on connect, and `better-sqlite3` bundles SQLite 3.51.2 which supports window functions and CTEs needed for pattern detection. The one confirmed Fastmail-specific detail is that the envelope recipient header is `X-Delivered-To` (not the standard `Delivered-To`), with `X-Resolved-To` available for post-alias-resolution address.

**Core technologies:**
- `imapflow 1.2.8`: `headers` fetch option for `Delivered-To`/`X-Delivered-To`/`List-Id` — verified from installed source, no upgrade needed
- `better-sqlite3 12.6.2` (SQLite 3.51.2): `GROUP BY`/`HAVING`/window functions for pattern detection — no external stats library needed
- `picomatch 4.0.3`: glob matching for new `envelopeRecipient` match field — same engine as existing sender/recipient matching
- `zod 4.3.6`: schema extension for `envelopeRecipient`, `visibility` (array), `readStatus` fields — optional fields maintain backward compatibility
- Raw string parsing (no library): 20-line header parser for extracting values from the `Buffer` returned by imapflow's headers fetch — `mailparser` and address-parsing libraries are overkill

**What NOT to add:** `mailparser`, `address-rfc2822`, any stats library, `node-cron`, QRESYNC enablement, or a message queue. All would add complexity without proportional value.

### Expected Features

**Must have (table stakes):**
- Envelope recipient matching — every serious filter system exposes the actual delivery address; critical for +tag and BCC routing
- Header visibility classification (direct / CC / BCC / list) — equivalent to Gmail's "sent directly to me" and Fastmail's To/CC/BCC filter conditions
- Read status matching — Fastmail rules, Thunderbird, and the existing sweep all use `\Seen`; exposing it to user rules is the obvious next step
- Move tracking (detection) — required foundation before any behavioral learning can happen
- Proposed rules from pattern detection — the payoff of the behavioral learning investment

**Should have (differentiators):**
- +tag extraction from envelope recipient for glob matching
- Mailing list detection via `List-Id` (RFC 2919) as a first-class visibility class
- BCC detection as a derived field from envelope recipient vs To/CC comparison
- Proposed rule confidence scores expressed in plain language ("You moved 12 messages from this sender to Receipts")
- Edit-before-approve flow for proposed rules
- Rule preview showing what messages a proposed rule would affect (reuse batch filing dry-run)

**Defer (v2+):**
- Bulk rule approval — start with one-at-a-time; bulk is a UX optimization
- Rule simulation with full dry-run on proposals — signal count and confidence is sufficient for v0.4
- Real-time IMAP NOTIFY for move tracking — anti-feature; polling is the correct approach for this use case
- Auto-applying proposed rules — explicitly ruled out; always require user approval
- Body content analysis — expensive and conflicts with IMAP-only constraint

### Architecture Approach

The extended matchers plug directly into the existing `matchRule()` pipeline — a single extension point that all consumers (Monitor, ReviewSweeper, BatchEngine) inherit automatically. The behavioral learning subsystem is standalone new infrastructure that sits alongside the rule engine without coupling to it: `MoveTracker` observes the IMAP state, `PatternDetector` queries move signals, and the proposals API writes to `proposed_rules`. Hot-reload config propagation to new components follows the existing `getMonitor()`/`getSweeper()` getter pattern. Schema changes use idempotent version-gated migrations rather than the current try/catch ALTER TABLE approach.

**Major components:**
1. `src/imap/messages.ts` (modified) — `EmailMessage` gains `envelopeRecipient: string | null` and `visibility: Visibility`; `parseMessage()` gains header Buffer parsing
2. `src/tracking/scanner.ts` (new) — `MoveTracker` class; periodic UID snapshot diffing with activity log cross-reference; snapshot persistence to SQLite state table
3. `src/learning/detector.ts` (new) — `PatternDetector` class; GROUP BY queries on `move_signals`; writes to `proposed_rules` table
4. `src/web/routes/proposals.ts` (new) — GET list / POST approve / POST dismiss / PUT modify for proposed rules
5. `src/log/index.ts` (modified) — adds `move_signals` and `proposed_rules` tables via versioned migration
6. `src/rules/matcher.ts` (modified) — three new match blocks for `envelopeRecipient`, `visibility`, `readStatus`

### Critical Pitfalls

1. **Envelope headers are not in the IMAP ENVELOPE** — Delivered-To and X-Delivered-To are MTA-injected headers, not part of RFC 3501 ENVELOPE. Must use imapflow's `headers: [...]` array fetch option. Spike and verify against live Fastmail data in Phase 1 before building any matching logic on top of it.

2. **Move tracker vs monitor race condition** — The monitor moves messages automatically; the tracker must not count those as user moves. Cross-reference by Message-ID (not UID, which changes after a move) against the activity log. This is a core design decision for Phase 2, not an afterthought.

3. **Schema migration fragility** — The existing try/catch ALTER TABLE pattern breaks for multi-step table and index creation. Introduce version-gated transactional migrations in Phase 1 so all subsequent phases inherit the correct pattern.

4. **False positive proposals from low-volume patterns** — A 3-move sample with 100% correlation is noise, not a pattern. Require minimum 5 moves spanning at least 7 days, suppress burst moves (10 messages moved in 5 minutes = 1 signal), and track dismissals to prevent re-proposals.

5. **Header visibility BCC/list confusion** — "Neither To nor CC" matches both BCC'd messages AND mailing list traffic. Check `List-Id` header first; classify as `list` before falling back to BCC inference. Fetch `List-Id` in the same header array fetch as `X-Delivered-To` — no extra IMAP round-trip.

6. **Header fetch performance in batch context** — Only fetch extended headers when at least one active rule uses them. Pre-check the ruleset on startup and config reload; cache a `needsExtendedHeaders` flag. Without this optimization, batch filing of thousands of messages is noticeably slower.

## Implications for Roadmap

The dependency chain is strict in one direction and parallel in another. Extended message data is the foundation for both the extended matchers and the behavioral learning subsystem. Phases 2-3 and Phase 4 can proceed in parallel after Phase 1 completes.

### Phase 1: Extended Message Data (Foundation)
**Rationale:** Everything else depends on `EmailMessage` carrying `envelopeRecipient` and `visibility`. Also the right time to introduce the versioned migration pattern that all subsequent schema changes will use. Contains the highest-risk implementation work (verifying Fastmail header behavior, header parsing correctness) that must be validated before building on top of it.
**Delivers:** Extended `EmailMessage` type with `envelopeRecipient` and `visibility`; updated IMAP fetch queries with `headers` array; header parsing logic in `parseMessage()`; versioned SQLite migration infrastructure; updated `ReviewMessage` type and `reviewMessageToEmailMessage()` converter
**Addresses:** Envelope recipient extraction foundation, visibility classification foundation, migration versioning for all subsequent phases
**Avoids:** Pitfall 1 (envelope vs ENVELOPE distinction), Pitfall 3 (schema migration fragility), Pitfall 5 (BCC/list confusion), Pitfall 6 (conditional header fetch)

### Phase 2: Extended Matchers + Schema
**Rationale:** With the extended `EmailMessage` type in place, wiring the matcher is straightforward. Read status is independent and simplest — ship it here. The Zod schema extension is small and maintains backward compatibility with v0.3 config files. Existing tests need fixture updates but no logic changes.
**Delivers:** `envelopeRecipient`, `visibility`, `readStatus` match fields in `emailMatchSchema`; updated `matchRule()` with three new match blocks; all three automatically available in Monitor, Sweep, and Batch consumers
**Addresses:** Read status matching, envelope recipient matching, header visibility matching
**Avoids:** Integration gotcha — Zod `refine` validator must include new fields in the "at least one field required" check or rules using only new match fields are rejected

### Phase 3: Extended Matchers UI
**Rationale:** UI updates for the new match fields are independent of behavioral learning. Shipping them after the backend lets users immediately start writing rules against the new fields. Progressive disclosure keeps the rule editor clean for simple cases.
**Delivers:** Rule editor with envelope recipient glob input, visibility multi-select, read status toggle; updated rule display for new fields
**Addresses:** UI for all three new match types
**Avoids:** UX pitfall of showing advanced fields to all users by default — use "More match options" progressive disclosure

### Phase 4: Move Tracking Infrastructure
**Rationale:** Can run in parallel with Phases 2-3 after Phase 1 completes. Must precede pattern detection. The activity log cross-reference by Message-ID is the core design decision and must be built into the schema and class interface from the start, not added later.
**Delivers:** `move_signals` SQLite table; `MoveTracker` class with periodic UID snapshot scanning; snapshot persistence to state table; activity log cross-reference to filter system moves; `logMoveSignal()` and query methods on `ActivityLog`; tracking config in schema (scan interval, monitored folders)
**Addresses:** Move tracking (detection) feature
**Avoids:** Pitfall 2 (race condition with monitor), anti-pattern of in-memory-only snapshots, anti-pattern of scanning all folders on every poll

### Phase 5: Pattern Detection
**Rationale:** Depends on accumulated move signals from Phase 4. The threshold configuration — minimum count, time window, burst suppression, dismissal tracking — is the core deliverable of this phase and must be correct before the UI surfaces proposals to the user.
**Delivers:** `PatternDetector` class; `proposed_rules` SQLite table; GROUP BY/HAVING queries with configurable thresholds; duplicate-rule suppression (skip proposals for senders with existing rules); burst-move deduplication; dismissal suppression list
**Addresses:** Proposed rules from pattern detection
**Avoids:** Pitfall 4 (false positive proposals), integration gotcha (duplicate proposal vs existing rule check), technical debt of storing move signals in the activity table

### Phase 6: Proposed Rules UI and API
**Rationale:** The payoff of the behavioral learning investment. Backend infrastructure from Phases 4-5 is stable. The approve flow reuses the existing config hot-reload mechanism — a proposed rule being approved triggers the same path as adding a rule via the rules editor.
**Delivers:** `/api/proposals` routes (list / approve / dismiss / modify); proposals panel in frontend; approve flow that creates a real rule and triggers hot-reload; edit-before-approve capability; plain-language confidence display ("You moved N messages from this sender to Folder"); rule preview showing what messages a proposed rule would affect
**Addresses:** Proposed rules UI, confidence scores, edit-before-approve workflow
**Avoids:** UX pitfall of approve/dismiss-only (no edit path), UX pitfall of showing too many proposals at once (show top 3-5 ranked by confidence), UX pitfall of cryptic confidence percentages

### Phase Ordering Rationale

- Phase 1 before everything: `EmailMessage` type changes cascade into every test fixture. Getting this right first avoids a type-error tail across all subsequent phases.
- Phases 2-3 and Phase 4 can run in parallel after Phase 1: extended matchers and move tracking have no inter-dependency.
- Phase 5 strictly after Phase 4: pattern detection needs accumulated signals to be meaningful.
- Phase 6 strictly after Phase 5: the proposals panel has nothing to show without proposed rules in the database.
- Versioned migration pattern established in Phase 1 means Phases 4 and 5 inherit the correct approach without additional design decisions.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Move Tracking):** Destination folder discovery strategy is specified at a high level, but the exact imapflow API for multi-folder message-id search and the performance characteristics against Fastmail's rate limits need validation before committing to the implementation approach.
- **Phase 6 (Proposed Rules UI):** The rule preview feature is described as reusing batch filing dry-run infrastructure. Confirm that the batch engine's dry-run mode is accessible from the proposals API route context before designing the approve flow around it.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Extended Matchers):** Purely additive changes to an existing well-understood pipeline. picomatch, Zod schema extension, and matcher if-blocks follow patterns already in the codebase.
- **Phase 3 (Extended Matchers UI):** UI pattern established by existing rule editor. Progressive disclosure is a standard pattern with no novel implementation decisions.
- **Phase 5 (Pattern Detection):** SQLite GROUP BY / HAVING aggregation on indexed columns. No novel algorithms. Threshold values are configuration parameters, not research questions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All capabilities verified directly from installed source (`node_modules/imapflow`, `sqlite_version()`). No new dependencies required. |
| Features | HIGH | Grounded in comparable systems (SaneBox, Hey.com, Fastmail rules, Gmail filters). Anti-features explicitly justified. Feature dependencies charted. |
| Architecture | HIGH | Based on deep analysis of existing codebase patterns. All new components follow established Monitor/Sweeper/BatchEngine conventions. |
| Pitfalls | HIGH | Derived from IMAP protocol specs (RFC 3501, RFC 2919, RFC 7162), Fastmail documentation, and direct codebase analysis. Not theoretical. |

**Overall confidence:** HIGH

### Gaps to Address

- **Fastmail `X-Delivered-To` vs `Delivered-To`:** Research confirms Fastmail uses `X-Delivered-To`, but this must be spiked against a real Fastmail account in Phase 1 before any matching logic is built on it. The exact header names differ by provider and message type.
- **User address/alias config field:** Visibility classification requires knowing the user's owned addresses. The config schema currently has no `identity.addresses` field. Phase 1 must decide whether to derive this from `imap.auth.user` only or require an explicit aliases list in config.
- **Destination folder discovery performance:** Scanning the top N recently used folders for a moved message is the recommended approach, but the exact N and IMAP operations (STATUS per folder vs SEARCH) need validation against Fastmail rate limits and response times in Phase 4.
- **Proposed rule ordering:** When a proposed rule is approved, it is appended at the end of the rule list. First-match-wins evaluation order may make it ineffective if a broader rule fires first. The proposals UI should advise the user to verify rule ordering after approval.

## Sources

### Primary (HIGH confidence)
- `node_modules/imapflow/lib/imap-flow.d.ts` lines 369-370, 474 — `headers?: boolean | string[]` in FetchQueryObject; `headers?: Buffer` in FetchMessageObject
- `node_modules/imapflow/lib/imap-flow.js` line 904 — CONDSTORE auto-enable on connect
- `node_modules/imapflow/lib/commands/fetch.js` — `BODY.PEEK[HEADER.FIELDS (...)]` confirmed for headers array
- SQLite 3.51.2 version confirmed locally; window functions available since 3.25.0
- Existing codebase: `src/imap/client.ts`, `src/rules/matcher.ts`, `src/log/index.ts`, `src/monitor/index.ts`, `src/sweep/index.ts`, `src/batch/index.ts`
- [ImapFlow Fetching Messages Guide](https://imapflow.com/docs/guides/fetching-messages/)
- [RFC 3501 — IMAP4rev1](https://www.rfc-editor.org/rfc/rfc3501) — ENVELOPE structure Section 7.4.2
- [RFC 2919 — List-Id header](https://www.rfc-editor.org/rfc/rfc2919.html)
- [RFC 7162 — CONDSTORE/QRESYNC](https://datatracker.ietf.org/doc/html/rfc7162)
- [RFC 8474 — IMAP OBJECTID](https://datatracker.ietf.org/doc/html/rfc8474)
- [Fastmail email addressing](https://www.fastmail.help/hc/en-us/articles/360058753414-Email-addressing)
- [Fastmail email delivery process](https://www.fastmail.help/hc/en-us/articles/1500000278262-The-email-delivery-process)

### Secondary (MEDIUM confidence)
- [SaneBox review — behavioral learning approach](https://toolchamber.com/sanebox-review/)
- [HEY Screener — approval workflow UX pattern](https://help.hey.com/article/722-the-screener)
- [EmailEngine: tracking deleted messages on IMAP](https://docs.emailengine.app/tracking-deleted-messages-on-an-imap-account/)
- [SQLite migration versioning strategies](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies)

---
*Research completed: 2026-04-11*
*Ready for roadmap: yes*
