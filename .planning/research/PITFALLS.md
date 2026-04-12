# Pitfalls Research

**Domain:** Extended IMAP matchers (envelope recipient, header visibility, read status), move tracking, pattern detection, and proposed rules -- added to an existing rule evaluation pipeline
**Researched:** 2026-04-11
**Confidence:** HIGH (pitfalls derived from existing codebase analysis, IMAP protocol knowledge, and Fastmail-specific behavior)

## Critical Pitfalls

### Pitfall 1: Envelope Recipient Headers Are Not in the IMAP Envelope

**What goes wrong:**
The current codebase fetches messages using `{ envelope: true }` and gets To/CC from the IMAP ENVELOPE response. Developers assume they can get Delivered-To or X-Original-To the same way. They cannot. These are message body headers injected by the receiving MTA -- they are not part of the RFC 3501 ENVELOPE structure. Attempting to read them from the envelope object returns nothing, and the feature silently fails to match any messages.

**Why it happens:**
The IMAP ENVELOPE is a parsed summary of specific RFC 2822 headers (From, To, CC, BCC, Subject, Date, Message-ID, In-Reply-To, Reply-To, Sender). Delivered-To, X-Delivered-To, X-Original-To, and Envelope-To are non-standard headers added by MTAs during delivery. They exist only in the raw message headers, which requires a separate fetch for `headers` or specific `header.fields`.

**How to avoid:**
1. Fetch envelope recipient headers separately using ImapFlow's header fetch: `{ headers: ['Delivered-To', 'X-Delivered-To', 'X-Original-To', 'X-Original-Delivered-To'] }` in the fetch query.
2. On Fastmail specifically, the relevant header is `X-Delivered-To` (the envelope recipient address). `X-Original-Delivered-To` contains the pre-alias-resolution address. `X-Resolved-To` contains the post-alias address. Test which headers actually appear on the target Fastmail account.
3. Add the header fetch to the existing `fetchNewMessages` and `fetchAllMessages` calls without breaking the current parsing pipeline. Extend `ImapFetchResult` and `EmailMessage` to carry optional `envelopeRecipient` field.
4. Fall back gracefully: if no envelope recipient header is present (common for very old messages or messages from certain providers), the field is `undefined` and rules using `envelopeRecipient` match simply do not apply to that message.

**Warning signs:**
- `envelopeRecipient` is always empty/undefined in test runs
- Rules with envelope recipient matches never fire
- Message fetch suddenly returns much larger payloads (fetching full headers instead of just the needed ones)

**Phase to address:**
Phase 1 (Extended Matchers) -- this is the first thing to spike and verify against live Fastmail data before building any matching logic on top of it.

---

### Pitfall 2: Move Tracking vs Monitor Race Condition

**What goes wrong:**
Move tracking scans Inbox periodically to detect messages the user moved manually (in Mac Mail). The monitor also watches Inbox for new messages and moves them automatically. When the monitor moves message UID 500 to "Receipts," the next move tracker scan sees UID 500 is gone from Inbox and records "user moved UID 500 somewhere." The tracker has no way to distinguish between the monitor's automated move and the user's manual move -- it records a false signal that pollutes pattern detection.

**Why it happens:**
IMAP provides no metadata about who performed a MOVE operation. UIDs simply appear or disappear from folders. The move tracker sees a message vanish and must infer what happened. Without cross-referencing the activity log, every move looks like a user action.

**How to avoid:**
1. Cross-reference move tracker observations against the activity log. When the tracker detects UID 500 is gone from Inbox, check `activity` table: if there is a recent entry for `message_uid = 500` with `source = 'arrival'` or `source = 'sweep'`, it was the system's own move -- ignore it.
2. The cross-reference must use `message_id` (Message-ID header), not `message_uid`, because UIDs change when messages move between folders. The tracker needs to fetch the envelope of messages it is tracking to get the Message-ID.
3. Add a short delay between monitor processing and move tracker scans to avoid timing races where the tracker runs before the activity log entry is written.
4. Consider the inverse: the tracker detects a new message in "Receipts" that was not put there by the system. This is harder to detect reliably because it requires scanning destination folders too, which is expensive.

**Warning signs:**
- Pattern detection suggests rules for senders that already have rules (because the system's moves are being counted as user moves)
- Proposed rules duplicate existing rules exactly
- Move signal count is suspiciously close to the activity log count for the same period

**Phase to address:**
Phase 2 (Move Tracking) -- the activity log cross-reference is the core design decision, not an afterthought.

---

### Pitfall 3: Schema Migration Breaks Existing Database

**What goes wrong:**
v0.4 needs new tables (move signals, proposed rules) and likely new columns on existing tables. The current migration approach uses try/catch around `ALTER TABLE ADD COLUMN` -- if it throws, the column already exists. This works for adding columns but does NOT work for adding tables with indexes, constraints, or foreign keys. A partial migration (table created, index creation fails) leaves the database in an inconsistent state. On next startup, the "CREATE TABLE IF NOT EXISTS" succeeds (table exists), the migration thinks it is done, but the index is missing.

**Why it happens:**
SQLite's ALTER TABLE is extremely limited -- only ADD COLUMN, RENAME TABLE, RENAME COLUMN, and DROP COLUMN. The current `migrate()` method in `ActivityLog` is a sequence of independent try/catch blocks, which is fine for simple column additions but becomes fragile when you need multiple coordinated schema changes. There is no version tracking -- the code cannot tell whether a migration was partially applied.

**How to avoid:**
1. Add a schema version to the `state` table: `INSERT OR REPLACE INTO state (key, value) VALUES ('schema_version', '2')`. Check version on startup, run only migrations above the current version.
2. Wrap each migration version in a transaction. SQLite DDL (CREATE TABLE, CREATE INDEX) is transactional, unlike PostgreSQL. If any step fails, the whole version rolls back.
3. For v0.4, the new tables (move_signals, proposed_rules) should be created in a single migration function gated by version check, not scattered across multiple try/catch blocks.
4. Back up the database file before migration. For a single-user app, this means copying `db.sqlite3` to `db.sqlite3.bak` before running migrations.

**Warning signs:**
- App crashes on startup with "table already exists" or "index already exists" errors
- Queries against new tables fail with "no such column" because the table was created but ALTER failed
- `PRAGMA user_version` returns 0 (never been set)

**Phase to address:**
Phase 1 (Extended Matchers) -- the first phase that touches the schema should establish the versioned migration pattern so subsequent phases inherit it.

---

### Pitfall 4: False Positive Rule Proposals from Low-Volume Patterns

**What goes wrong:**
The user manually moves 3 messages from "newsletters@example.com" to "Reading" over two weeks. The pattern detector sees 3/3 messages from this sender moved to "Reading" -- 100% correlation -- and proposes a rule. But this is just noise: the user was triaging, not establishing a pattern. The proposed rule fires on the next newsletter and the user wonders why their message disappeared from Inbox.

**Why it happens:**
Small sample sizes produce spuriously high confidence scores. A threshold like "80% of messages from this sender go to folder X" is meaningless when the sample size is 3. This is the base rate fallacy applied to email -- most senders send few messages, so most patterns will be low-volume with artificially high percentages.

**How to avoid:**
1. Require a minimum absolute count before proposing a rule. Something like: at least 5 moves from the same sender to the same folder, AND the moves span at least 7 days (not a one-time batch triage session).
2. Apply a recency decay: moves from 30 days ago count less than moves from yesterday. A sender the user dealt with once a month ago should not generate a proposal.
3. Exclude burst moves: if the user moved 10 messages from the same sender within 5 minutes, count that as 1 signal, not 10. Batch triaging is not a sustained pattern.
4. Never auto-apply proposed rules. Always require explicit user approval. The UI should make it trivially easy to dismiss bad proposals.
5. Track dismissals: if the user dismisses a proposal for sender X twice, stop proposing rules for sender X (add to a suppression list).

**Warning signs:**
- Proposals appear immediately after a small triage session
- The same sender appears in proposals repeatedly after being dismissed
- Proposals outnumber actual useful rules by 10:1 (alert fatigue)

**Phase to address:**
Phase 3 (Pattern Detection) -- threshold tuning is the core of this phase, not a parameter to set at the end.

---

### Pitfall 5: Header Visibility Classification Gets BCC Wrong

**What goes wrong:**
The developer classifies visibility by checking if the user's address appears in To (direct), CC, or neither (BCC). But "neither" also includes mailing list delivery (where the user's address is in the list subscription, not in To/CC), forwarded mail, and messages where the user's alias or +tag address was used. The classification marks all mailing list traffic as "BCC" and generates confusing rule proposals.

**Why it happens:**
BCC detection is fundamentally a process of elimination: if the message reached you but your address is not in To or CC, you were either BCC'd, on a mailing list, or the message was forwarded. There is no BCC header to check (it is stripped by the sender's MTA by design). The only reliable heuristic is: `List-Id` present = mailing list, user address in To = direct, user address in CC = cc, everything else = probably BCC but uncertain.

**How to avoid:**
1. Classify as four categories: `direct`, `cc`, `list`, `bcc`. Do not conflate mailing lists with BCC.
2. Check `List-Id` header (RFC 2919) first -- if present, classify as `list` regardless of To/CC contents. Parse the List-Id value from inside angle brackets only; ignore the optional description prefix.
3. Also check `List-Post`, `List-Unsubscribe`, and `Precedence: list` as fallback indicators for mailing list traffic that lacks a proper List-Id.
4. For `direct` vs `cc`, match the user's known addresses (primary + aliases) against To and CC. This requires knowing the user's addresses -- store them in config or auto-detect from the IMAP account.
5. Mark the BCC classification as low-confidence in the UI. "Likely BCC" is honest; "BCC" implies certainty that does not exist.

**Warning signs:**
- Large volume of messages classified as "BCC" that are actually mailing list posts
- Mailing list messages not matching `list` visibility rules because List-Id header was not fetched
- User's alias addresses not recognized in To/CC checks

**Phase to address:**
Phase 1 (Extended Matchers) -- header visibility requires fetching List-Id headers (same fetch extension as envelope recipient), and the classification logic must handle the list/BCC ambiguity from the start.

---

### Pitfall 6: Fetching Headers for Every Message Tanks Performance

**What goes wrong:**
The current monitor fetches `{ envelope: true, flags: true }` for new messages -- lightweight, fast, parsed by the IMAP server. Adding header fetches for Delivered-To, List-Id, etc. means fetching raw header text, parsing it client-side, and doing this for every single message. On a batch filing run of 5,000 messages, this multiplies the data transfer and parsing time dramatically.

**Why it happens:**
IMAP ENVELOPE is a server-side parsed structure returned efficiently. Raw header fetches require the server to send the actual header text, which the client must parse. Headers can be large (especially with long Received chains). Fetching `BODY.PEEK[HEADER.FIELDS (Delivered-To X-Delivered-To List-Id List-Post)]` is specific but still more expensive than envelope-only fetches.

**How to avoid:**
1. Fetch the specific headers needed, not all headers. Use `BODY.PEEK[HEADER.FIELDS (Delivered-To X-Delivered-To X-Original-To List-Id List-Post Precedence)]` -- ImapFlow supports this via the `headers` array in the fetch query.
2. Only fetch extended headers when rules actually use them. If no rule has an `envelopeRecipient` or `visibility` match, skip the header fetch entirely. Check the active ruleset at monitor startup and on config reload.
3. For batch filing, the header fetch can be combined with the envelope fetch in a single IMAP command -- do not issue separate fetch calls per message.
4. For move tracking, the tracker only needs the envelope (sender, subject, Message-ID) to build signals -- it does not need Delivered-To or List-Id.

**Warning signs:**
- Monitor processing time per message jumps from <50ms to >200ms after adding header fetches
- Batch filing of 1,000 messages takes 3x longer than before the header changes
- IMAP connection timeouts during large fetches

**Phase to address:**
Phase 1 (Extended Matchers) -- the conditional fetch optimization should be designed into the fetch pipeline, not bolted on after performance complaints.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing move signals in the activity table instead of a dedicated table | Reuse existing table, no migration | Activity queries slow down, signal queries require complex WHERE clauses, 30-day prune deletes signals needed for pattern detection | Never -- signals have different retention and query patterns |
| Polling folders for move tracking instead of using IMAP NOTIFY | Simple implementation, works everywhere | Misses rapid moves (user moves 5 messages in 10 seconds between polls), wastes bandwidth scanning unchanged folders | Acceptable for v0.4 since IMAP NOTIFY is not widely supported and imapflow does not expose it |
| Hardcoding the user's email address for visibility classification | Quick to implement | Breaks when user has aliases, +tag addresses, or switches accounts | Never -- require it in config from the start |
| Skipping suppression list for dismissed proposals | Simpler proposal UI | Same bad proposals reappear after every detection cycle, training the user to ignore all proposals | Never -- track dismissals from the first proposal UI release |
| Using sender-only pattern detection (ignoring recipient, subject) | Simpler statistical model | Misses patterns like "all messages CC'ing team@company.com go to Team folder" | Acceptable for v0.4 MVP, but design the signal schema to support multi-field patterns later |

## Integration Gotchas

Common mistakes when integrating v0.4 features into the existing codebase.

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| EmailMessage type extension | Adding new fields as required, breaking all existing tests and callers | Add `envelopeRecipient?: string`, `visibility?: string`, etc. as optional fields. Existing code that does not use them is unaffected. |
| matchRule() expansion | Adding new match fields without updating the AND-logic refine validator | The Zod `emailMatchSchema` refine checks `sender \|\| recipient \|\| subject`. Must update to include new fields or the schema rejects rules with only new match fields. |
| evaluateRules() with new matchers | Assuming new matchers cannot change which rule wins first-match | A rule that previously did not match (because it had no sender/recipient/subject constraint) now matches because it has a visibility constraint. The rule evaluation ORDER matters -- new matchers can change first-match-wins results. |
| Activity log schema for move signals | Trying to reuse the `activity` table for move tracking signals | Move signals need different columns (source_folder, destination_folder, detected_at, signal_type) and different retention (longer than 30 days). Use a separate `move_signals` table. |
| Monitor's processMessage with read status | Checking `\Seen` flag at fetch time, but the flag changes between fetch and rule evaluation | Read status matching should use the flags from the fetched message snapshot, which is already what `parseMessage` captures. Do NOT re-fetch flags. But document that the flag reflects the state at fetch time, which may differ from the state when the user views the message. |
| Config reload with new match fields | Old config files without new fields fail validation | Zod schema defaults and `.optional()` on new match fields ensure backward compatibility. Test config reload with a v0.3-era config file. |
| Sweep using new matchers | Sweep evaluates rules against Review folder messages. If rules now match on visibility/envelope-recipient, sweep needs those headers too. | Extend `fetchAllMessages` to include the same header fields as `fetchNewMessages`. The `ReviewMessage` type needs the same optional fields. |
| Proposed rules vs existing rules | Pattern detector proposes a rule that duplicates an existing rule | Before proposing, check if an existing enabled rule already covers the same sender/pattern. If so, skip the proposal. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Scanning entire Inbox on every move tracker poll | Poll takes >10 seconds, IMAP connection held open too long, monitor starved | Use IMAP SEARCH to find only messages that arrived since last scan (by UID range or SINCE date), then diff against previous snapshot | >500 messages in Inbox |
| Storing per-message snapshots in memory for move diffing | Memory usage grows linearly with Inbox size | Store only UID + Message-ID pairs in SQLite, not full message objects. Diff against the database, not an in-memory set | >2,000 tracked messages |
| Running pattern detection on every tracker poll | CPU spike every poll interval, blocks event loop for statistical computation | Run detection on a schedule (daily or after N new signals), not on every poll. Use SQLite aggregation queries instead of loading all signals into memory | >10,000 signals in database |
| Fetching headers for all messages in batch filing regardless of rule requirements | 5x slower batch filing, unnecessary data transfer | Pre-check ruleset: if no rules use extended matchers, skip header fetch. Cache the "needs headers" flag and update on config reload | >1,000 messages in batch |
| Full folder LIST on every move tracker poll to find destination folders | LIST is expensive on accounts with 300+ folders, rate-limited by Fastmail | Cache folder list with TTL (already implemented in v0.3). Use the cached list for destination folder resolution | >200 folders |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing too many proposed rules at once | Alert fatigue -- user stops reviewing proposals, ignores all of them | Show top 3-5 proposals ranked by confidence. "3 new suggestions" badge, not a wall of 50 proposals. |
| Requiring the user to understand statistical confidence scores | "82% confidence" means nothing to someone managing email | Use plain language: "You moved 12 messages from this sender to Receipts in the last 30 days. Create a rule?" |
| Proposed rule UI that only allows approve/dismiss | User wants to approve but change the destination folder, or approve but add a subject filter | Allow editing the proposed rule before approving -- pre-fill the rule editor with the proposal's values, let the user modify, then save as a real rule. |
| Not showing what messages a proposed rule would affect | User approves a rule blind, then discovers it matches messages they did not intend | Show a preview: "This rule would also match 15 messages currently in Inbox" -- reuse the dry-run preview from batch filing. |
| Envelope recipient and visibility fields shown to all users | Most rules only need sender/subject. Extra fields clutter the UI for simple cases. | Use progressive disclosure: show sender/recipient/subject by default, add "More match options" expander for envelope recipient, visibility, and read status. |
| Read status matching without explaining evaluation timing | User creates a rule "match unread messages from X, move to Y" and wonders why already-read messages from X are not moved | Explain in the UI: "Read status is checked when the message is first processed. Messages you have already read in your mail client may not match." |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Envelope recipient matching:** Works on test messages but fails on mailing list messages where Delivered-To contains the list address, not the user's address -- verify with real mailing list traffic on Fastmail
- [ ] **Header visibility:** Classifies direct/cc correctly but marks all mailing list mail as BCC -- verify List-Id parsing is actually working, check that the header is being fetched
- [ ] **Read status matching:** Works for new messages but ReviewMessage already uses `\Seen` flag for sweep eligibility -- verify read status matching in sweep context does not conflict with sweep age thresholds
- [ ] **Move tracking:** Records moves correctly but also records the system's own moves as user moves -- verify activity log cross-reference is filtering system moves
- [ ] **Move tracking:** Detects messages leaving Inbox but does not detect the destination folder -- verify the tracker is scanning destination folders or inferring destination from IMAP COPY/MOVE responses
- [ ] **Pattern detection:** Proposes rules but does not deduplicate against existing rules -- verify a sender with an existing rule does not generate a duplicate proposal
- [ ] **Pattern detection:** Works on recent data but the 30-day prune on activity log deletes the signals -- verify move signals use separate retention from activity log
- [ ] **Proposed rules:** Approve works but the new rule is added at the end of the rule list with max order -- verify rule ordering UI still works and the new rule can be repositioned
- [ ] **Schema migration:** New tables created on fresh database but existing v0.3 database fails to migrate -- test migration from a real v0.3 database file
- [ ] **Config backward compatibility:** v0.4 config schema accepts old config files without new fields -- test loading a v0.3 config.yml with the v0.4 codebase

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Move tracker records system moves as user signals | MEDIUM | Delete from `move_signals` WHERE the `message_id` matches entries in the `activity` table. Add the cross-reference check. Re-run pattern detection. |
| Schema migration partially applied | LOW | Drop the partially created tables, bump schema version back, restart. The version-gated migration will re-run cleanly. |
| Bad proposed rule auto-approved and moves wrong messages | MEDIUM | Query activity log for the rule ID, get all message UIDs moved by it, use batch filing to move them back. Disable the rule. |
| Envelope recipient header not available on old messages | LOW | No recovery needed -- the field is optional. Rules with envelope-recipient match simply do not fire for those messages. Document this limitation. |
| False positive proposals overwhelming the UI | LOW | Raise minimum thresholds. Purge existing proposals. Add dismissed proposals to suppression list. |
| Performance degradation from header fetching | MEDIUM | Add the conditional-fetch optimization (only fetch headers when rules need them). This is a code change but not a rewrite -- it is a conditional check before the fetch call. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Envelope headers not in ENVELOPE (Pitfall 1) | Phase 1: Extended Matchers | Spike test: fetch Delivered-To from a real Fastmail message via ImapFlow header fetch |
| Move tracker vs monitor race (Pitfall 2) | Phase 2: Move Tracking | Integration test: monitor moves a message, tracker runs, verify signal is NOT recorded |
| Schema migration fragility (Pitfall 3) | Phase 1: Extended Matchers | Migration test: start with v0.3 database, run v0.4 migrations, verify all tables and indexes exist |
| False positive proposals (Pitfall 4) | Phase 3: Pattern Detection | Test with synthetic data: verify 3 moves from same sender does NOT trigger a proposal |
| BCC/mailing-list confusion (Pitfall 5) | Phase 1: Extended Matchers | Test with real mailing list message: verify classified as `list`, not `bcc` |
| Header fetch performance (Pitfall 6) | Phase 1: Extended Matchers | Benchmark: measure per-message fetch time with and without header fetch on 100 messages |
| evaluateRules order change (Integration) | Phase 1: Extended Matchers | Regression test: verify existing rules produce identical results with and without new match fields |
| Move signal retention vs activity prune (Integration) | Phase 2: Move Tracking | Verify: 30-day prune does not delete move_signals table data |
| Duplicate proposed rules (Integration) | Phase 3: Pattern Detection | Test: create a rule for sender X, verify no proposal generated for sender X |
| Proposed rule preview (UX) | Phase 4: Proposed Rules UI | Manual test: approve a proposal, verify it matches the expected messages in dry-run |

## Sources

- [Fastmail email addressing](https://www.fastmail.help/hc/en-us/articles/360058753414-Email-addressing) -- X-Delivered-To, X-Original-Delivered-To, X-Resolved-To header documentation
- [Fastmail email delivery process](https://www.fastmail.help/hc/en-us/articles/1500000278262-The-email-delivery-process) -- How Fastmail injects envelope recipient headers
- [RFC 2919 - List-Id](https://www.rfc-editor.org/rfc/rfc2919.html) -- Mailing list identification header format and parsing rules
- [RFC 3501 - IMAP4rev1](https://www.rfc-editor.org/rfc/rfc3501) -- ENVELOPE structure definition (Section 7.4.2), FETCH command, BODY.PEEK header fields
- [ImapFlow fetch documentation](https://imapflow.com/docs/guides/fetching-messages/) -- Header fetch syntax, envelope vs header fields
- [Mailhardener email address types](https://www.mailhardener.com/kb/email-address-types-explained) -- Envelope vs header recipient distinction
- [SQLite migration strategies](https://www.sqliteforum.com/p/sqlite-versioning-and-migration-strategies) -- Version tracking, transactional DDL, ALTER TABLE limitations
- [Safely modify SQLite columns](https://synkee.com.sg/blog/safely-modify-sqlite-table-columns-with-production-data/) -- Table rebuild pattern for complex migrations
- Existing codebase analysis: `src/imap/messages.ts`, `src/rules/matcher.ts`, `src/log/index.ts`, `src/monitor/index.ts`, `src/sweep/index.ts`

---
*Pitfalls research for: v0.4 Extended Matchers and Behavioral Learning*
*Researched: 2026-04-11*
