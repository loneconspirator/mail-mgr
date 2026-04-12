# Feature Landscape

**Domain:** Email organization system -- extended matchers and behavioral learning
**Researched:** 2026-04-11

## Table Stakes

Features users expect from an email organization system at this maturity level. Missing = the system feels artificially limited compared to Fastmail rules, Gmail filters, or SaneBox.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Envelope recipient matching | Every serious filter system (Gmail, Fastmail, Thunderbird) matches on actual delivery address, not just To/CC. Critical for +tag routing and BCC detection. | Medium | Requires fetching `Delivered-To` / `X-Original-To` headers beyond the IMAP envelope. Fastmail uses `X-Delivered-To`. |
| Header visibility classification | Gmail has "sent directly to me" vs "sent to a list I'm on" filters. Fastmail rules expose To/CC/BCC. Users need to distinguish direct mail from list traffic. | Medium | Derivable from To/CC/List-Id headers without new IMAP fetches beyond what envelope + a few extra headers provide. |
| Read status matching | Fastmail and Thunderbird both support "is read/unread" as a filter condition. The sweep already uses read status -- exposing it to rules is natural. | Low | Already available in `message.flags` as `\Seen`. Just needs schema + matcher update. |
| Move tracking (detection) | SaneBox and Hey.com both learn from user moves. Without tracking what the user does in their mail client, the system is blind to user intent. | High | No push notification for moves in IMAP. Requires periodic folder scanning with UID/message-id correlation. |
| Proposed rules from patterns | SaneBox's core value proposition. Gmail's "unsubscribe" and "move similar" suggestions. Once you track moves, proposing rules is the obvious next step. | High | Statistical analysis on move logs, threshold tuning, false positive management. |

## Differentiators

Features that set the product apart. Not expected from a basic filter system, but valuable for a power user with 20 years of email.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| +tag extraction and glob matching | Fastmail's plus addressing routes to folders automatically, but the user can't write rules against the +tag portion specifically. Exposing `user+tag@domain` as a matchable field lets rules target tag patterns like `*+github*`. | Low | Parse the `+` portion from the envelope recipient. Glob matching already works via picomatch. |
| Mailing list detection via List-Id | Classify messages as "mailing list" traffic without relying on CC heuristics. List-Id (RFC 2919) and List-Unsubscribe (RFC 2369) are definitive signals. | Low | Fetch `List-Id` and `List-Unsubscribe` headers. Presence = mailing list. List-Id value is matchable. |
| BCC detection | If the user's address appears in `X-Delivered-To` but not in To or CC, the message was BCC'd. Useful for filtering automated systems and notifications. | Low | Derived field, no extra fetch needed. Compare envelope recipient against To/CC addresses. |
| Proposed rule confidence scores | Show the user how confident the system is in each proposed rule (e.g., "15 of 17 messages from this sender were moved to Projects"). Lets users trust the system. | Medium | Requires tracking move counts and computing precision metrics. |
| Bulk rule approval | Approve multiple proposed rules at once instead of one-by-one. Power user workflow for initial setup. | Low | UI feature. Backend just accepts an array of rule IDs to approve. |
| Rule simulation on proposed rules | Show "if this rule existed, it would have matched N messages in the last 30 days" before the user approves. | Medium | Query activity log + current inbox state. Already have batch filing dry-run as a pattern. |

## Anti-Features

Features to explicitly NOT build. These are traps that look useful but add complexity without proportional value, or conflict with the project's constraints.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time IMAP NOTIFY for move tracking | RFC 5465 (IMAP NOTIFY) would let the server push folder changes, but Fastmail support is uncertain, imapflow doesn't expose it, and it adds massive connection management complexity. | Periodic folder scanning (poll-based). Check every 5-15 minutes. Good enough for pattern detection which is inherently batch-oriented. |
| Full message body analysis | Tempting to scan body content for classification, but violates the project's IMAP-only constraint (body fetch is expensive), adds privacy concerns, and is the domain of LLM classification (Tier 4). | Stick to envelope + select headers. Headers are cheap to fetch and sufficient for routing rules. |
| Auto-applying proposed rules | SaneBox auto-applies without asking. Dangerous for a single-user system with 20 years of mail -- one bad rule could misfile thousands of messages. | Always require explicit user approval. Show what the rule would do before activation. |
| Machine learning classification | Neural network or Bayesian classifier for email categories. Way too complex for this milestone, and the deterministic approach (pattern detection on move history) is more transparent and debuggable. | Statistical pattern detection with simple thresholds. Save ML for Tier 4+ (LLM classification). |
| Cross-account tracking | Tracking moves across multiple IMAP accounts. Out of scope per project constraints (single user, single mailbox). | Single-account only. Multi-account is Tier 6. |
| Gmail-specific label tracking | Using X-GM-LABELS IMAP extension to track Gmail labels. Adds provider-specific complexity for a system primarily targeting Fastmail. | If Gmail support is added later, treat labels as folders. Don't special-case the tracking system. |

## Feature Details and Edge Cases

### Envelope Recipient Extraction

**What it is:** Match rules against the actual SMTP delivery address, which may differ from To/CC headers. This is the address the mail server received the message for.

**Headers to fetch:**
- `X-Delivered-To` -- Fastmail's primary envelope recipient header. Contains the resolved delivery address.
- `X-Original-To` -- Present on some servers (Postfix). Contains the original recipient before alias resolution.
- `Delivered-To` -- Gmail and some other servers use this (no X- prefix). Note: Gmail may strip this in IMAP access.

**Server-specific behavior:**
| Server | Header | Contains | Notes |
|--------|--------|----------|-------|
| Fastmail | `X-Delivered-To` | Resolved delivery address | Reliable. Also adds `X-Resolved-To` for post-alias address. |
| Fastmail | `X-Original-To` | Original SMTP RCPT TO | Present when different from X-Delivered-To |
| Gmail | `Delivered-To` | Delivery address | May not be visible via IMAP on all messages |
| Generic IMAP | Varies | Varies | Fall back to To/CC if no envelope header found |

**imapflow integration:** Fetch with `{ headers: ['X-Delivered-To', 'X-Original-To', 'Delivered-To'] }` alongside the envelope. Returns a Buffer of raw header lines that need parsing (split on `\r\n`, parse `Name: Value` format). Confidence: HIGH -- verified from imapflow source that `headers` accepts an array and returns Buffer.

**Edge cases:**
1. **Multiple X-Delivered-To values:** Forwarded messages accumulate these headers. Use the FIRST (topmost) value -- it's the one that delivered to this mailbox.
2. **Plus addressing:** `user+tag@fastmail.com` -- the `+tag` portion is preserved in X-Delivered-To. Must be available for glob matching.
3. **Subdomain addressing (Fastmail):** `tag@user.fastmail.com` -- Fastmail converts this to the canonical address in X-Delivered-To. Match against the full address.
4. **Missing header:** Not all messages have envelope recipient headers (e.g., old messages, migrated messages). Rule evaluation must treat missing envelope recipient as "no match" (not an error).
5. **Case sensitivity:** Email addresses are case-insensitive in the local part by convention (and always in the domain). Use case-insensitive matching (already the default via picomatch `nocase: true`).

**Impact on existing code:**
- `EmailMessage` interface needs an `envelopeRecipient?: string` field
- `parseMessage()` needs to accept fetched headers Buffer and extract the envelope recipient
- `emailMatchSchema` needs an `envelopeRecipient?: string` match field
- `matchRule()` needs a new clause for envelope recipient glob matching
- Fetch queries in `fetchNewMessages()` and `fetchAllMessages()` need to request extra headers

### Header Visibility Classification

**What it is:** Classify the user's relationship to a message as one of: `direct` (in To), `cc` (in CC), `bcc` (in envelope but not To/CC), or `list` (mailing list).

**Classification logic:**
```
1. If List-Id header present OR List-Unsubscribe header present --> "list"
2. If user's address appears in To header --> "direct"
3. If user's address appears in CC header --> "cc"
4. If message was delivered to user but address not in To or CC --> "bcc"
5. If none of the above match --> "unknown" (defensive fallback)
```

**Priority note:** A message TO the user that is ALSO from a mailing list should be classified as "list" because the routing behavior for list mail is the key distinction. The user wants to separate "stuff sent directly to me" from "stuff sent to a list I happen to be on."

**Edge cases:**
1. **Mailing lists that CC the user:** Some lists (e.g., GitHub notifications when you're mentioned) put the user in CC AND have List-Id. Classify as "list" -- the List-Id header is the strongest signal.
2. **User has multiple addresses:** The "user's address" check needs to know ALL the user's email addresses. Fastmail users often have aliases. Config needs a list of owned addresses.
3. **Distribution groups:** Messages sent to a group address (not a proper mailing list, no List-Id) where the user is a member. These appear as "bcc" since the user's address isn't in To/CC. This is correct behavior -- they behave like BCC.
4. **Reply-to-all chains:** User may appear in both To and CC due to reply threading. Classify based on first match (To wins over CC).
5. **No owned addresses configured:** If the user hasn't configured their addresses, skip visibility classification entirely. Don't guess.

**Headers to fetch:** `List-Id`, `List-Unsubscribe` (in addition to To/CC from envelope).

**Schema design:** The match field should accept an array of visibility values (multi-select in UI):
```typescript
visibility?: Array<'direct' | 'cc' | 'bcc' | 'list'>
```
Rule matches if the message's computed visibility is in the array. This lets users write rules like "match anything that's CC or list" in a single rule.

**Configuration requirement:** Need a new config field for the user's owned email addresses:
```yaml
identity:
  addresses:
    - user@fastmail.com
    - alias@customdomain.com
```

### Read Status Matching

**What it is:** Match rules based on whether a message has been read (has `\Seen` flag) at evaluation time.

**Implementation:** Trivially derived from `message.flags.has('\\Seen')`. The sweep already checks this for age-based decisions.

**Schema design:**
```typescript
readStatus?: 'read' | 'unread'
```

**Edge cases:**
1. **Race condition:** Message may be read between fetch and rule evaluation. Acceptable -- the flag state at fetch time is the best available signal.
2. **Batch filing context:** When batch filing retroactively, read status reflects current state, not state at arrival. This is actually useful -- "file all read messages from sender X."
3. **Monitor context:** New messages arriving are almost always unread. Read status matching is more useful in sweep and batch contexts.

### Move Tracking

**What it is:** Detect when the user manually moves messages in their mail client (Mac Mail) and log these moves for pattern detection.

**Approach:** Periodic folder scanning. Cannot use push notifications (IMAP NOTIFY not reliably available). The system already connects to IMAP and can scan folders.

**Implementation strategy:**

1. **Baseline scan:** On startup, snapshot INBOX contents (UID + message-id pairs).
2. **Periodic scan:** Every 5-15 minutes, re-scan INBOX. Compare against baseline.
3. **Disappearance detection:** Messages in baseline but missing from new scan were moved or deleted.
4. **Destination discovery:** For each disappeared message, search other folders by message-id using IMAP SEARCH. Fastmail supports OBJECTID (RFC 8474, authored by Fastmail's Bron Gondwana), so `emailId` provides a stable cross-folder identifier. If OBJECTID is available, use it. Otherwise fall back to Message-ID header search.
5. **Log the move:** Record `{message_id, from_folder, to_folder, sender, subject, timestamp}` in SQLite.

**Why message-id tracking (not UID tracking):**
UIDs change when messages move between folders. The Message-ID header is stable across moves. Fastmail's OBJECTID/emailId is even better (guaranteed unique, server-assigned), but Message-ID is the universal fallback.

**Edge cases:**
1. **Deleted messages:** A disappeared message might be deleted, not moved. Check Trash folder. If found there, log as delete, not move. If not found anywhere, log as "vanished" (likely permanently deleted).
2. **Messages moved BY the system:** The app itself moves messages. Must exclude system-initiated moves from tracking. Cross-reference against activity log -- if the app logged a move for that message-id recently, skip it.
3. **Bulk moves:** User selects 50 messages and moves them at once. The scan will detect all 50 disappearing simultaneously. Process them all, but batch the destination search to avoid hammering IMAP.
4. **UIDVALIDITY changes:** If UIDVALIDITY changes on a folder, all UIDs are invalidated. Reset the baseline for that folder and skip that scan cycle.
5. **Scan timing vs user action:** If the user moves a message between two scans, we catch it. If they move it and move it back before the next scan, we miss it. Acceptable -- we're detecting patterns, not auditing every action.
6. **Large folders:** INBOX with thousands of messages. The baseline scan must be efficient. Fetch only UIDs and message-ids (small payload). Consider tracking only recent messages (last 30 days) to bound the scan.
7. **Review folder tracking:** Also track moves FROM the Review folder. The user reading review items and filing them manually is a strong learning signal.

**Destination search strategy:**
Searching every folder for a disappeared message is expensive. Optimize by:
1. Search the most common user destinations first (from activity log's recent folders).
2. Search Trash folder to distinguish moves from deletes.
3. If not found in top 5-10 folders + Trash, log as "vanished" and skip. Don't scan 200 folders looking for one message.
4. Over time, the system learns which folders the user files to, making searches faster.

**Database schema for move tracking:**
```sql
CREATE TABLE move_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  message_id TEXT NOT NULL,
  from_folder TEXT NOT NULL,
  to_folder TEXT NOT NULL,
  sender TEXT,
  subject TEXT,
  envelope_recipient TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_sender ON move_signals(sender);
CREATE INDEX idx_moves_to_folder ON move_signals(to_folder);
CREATE INDEX idx_moves_timestamp ON move_signals(timestamp);
```

### Pattern Detection

**What it is:** Analyze move signals to find recurring patterns (e.g., "user always moves emails from noreply@github.com to Projects") and generate candidate rules.

**Algorithm:**
1. Group move signals by `{sender_domain, to_folder}` pairs.
2. For each group, count occurrences in the last 30 days.
3. If count exceeds threshold (e.g., 3+ moves of same sender to same folder), generate a candidate rule.
4. Compute confidence: `moves_to_target / total_moves_from_sender`. If the user moved 15 messages from `notifications@github.com` and 14 went to "Projects" and 1 went to "Trash", confidence = 14/15 = 93%.
5. Only propose rules above a confidence threshold (e.g., 80%).

**Pattern types to detect:**
| Pattern | Signal | Proposed Rule |
|---------|--------|---------------|
| Sender to folder | Same sender always goes to same folder | `match.sender: "*@domain.com"`, `action: move to folder` |
| Sender to trash | Same sender always deleted | `match.sender: "*@domain.com"`, `action: delete` |
| Subject pattern to folder | Subject containing keyword always filed | `match.subject: "*keyword*"`, `action: move to folder` |
| Envelope recipient to folder | Messages to a +tag address always filed | `match.envelopeRecipient: "*+tag*"`, `action: move to folder` |

**Threshold tuning:**
- Minimum signal count: 3 (don't propose rules from 1-2 moves)
- Minimum confidence: 80% (don't propose if user's behavior is inconsistent)
- Minimum time span: 7 days (require signals spanning at least a week to avoid one-off bursts)
- Cooldown: After dismissal, don't re-propose the same pattern for 30 days

**Edge cases:**
1. **Existing rules:** Don't propose rules that duplicate existing rules. Check proposed match against current rule set.
2. **Conflicting patterns:** User moved 5 messages from sender X to "Projects" and 3 to "Archive." Don't propose a rule -- the pattern isn't clear enough (confidence below threshold).
3. **Seasonal patterns:** User files tax emails in April. Don't propose a permanent rule from a short burst. Require minimum time span (signals spanning at least 7 days).
4. **Too broad:** "All email goes to Archive" is technically a pattern but useless. Require patterns to be specific enough (sender-based, not just destination-based).

### Proposed Rules UI

**What it is:** Present detected patterns to the user for approval, modification, or dismissal.

**UX patterns from the ecosystem:**

**SaneBox model:** Fully automatic. User corrects by moving messages. No explicit approval step. Too aggressive for this project (anti-feature: auto-applying).

**Hey.com Screener model:** Binary yes/no per sender. Simple but limited -- doesn't let user adjust the proposed action. Good inspiration for the approval flow but needs more flexibility.

**Recommended approach:** Notification-style cards showing:
- The detected pattern ("Emails from `notifications@github.com` moved to `Projects` 14 times")
- The proposed rule (editable sender glob, action, destination)
- Confidence score ("93% confidence")
- Actions: Approve (creates rule), Edit (opens rule editor pre-filled), Dismiss (marks as rejected, won't propose again)

**States for proposed rules:**
```
pending --> approved (becomes a real rule)
pending --> dismissed (hidden, won't re-propose for same pattern)
pending --> expired (auto-dismiss after 30 days with no action)
```

**Database schema:**
```sql
CREATE TABLE proposed_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_key TEXT NOT NULL UNIQUE,  -- e.g., "sender:*@github.com->Projects"
  match_sender TEXT,
  match_recipient TEXT,
  match_subject TEXT,
  match_envelope_recipient TEXT,
  action_type TEXT NOT NULL,
  action_folder TEXT,
  confidence REAL NOT NULL,
  signal_count INTEGER NOT NULL,
  first_signal TEXT NOT NULL,
  last_signal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, dismissed, expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
```

## Feature Dependencies

```
Read Status Matching --------> (independent, no prerequisites)

Envelope Recipient Extraction ---> Header Visibility Classification
     |                                    |
     |                                    v
     |                              (needs user's owned addresses config)
     |
     v
Move Tracking -----> Pattern Detection -----> Proposed Rules UI
     |
     +--> (needs message-id in fetch results -- already available)
     +--> (needs activity log cross-reference to exclude system moves)
```

**Dependency notes:**
- Envelope recipient and header visibility both require fetching extra headers. Should be implemented together to avoid two rounds of fetch query changes.
- Read status is fully independent -- can be done first or in parallel.
- Move tracking must exist before pattern detection can run.
- Pattern detection must exist before proposed rules can be shown.
- The UI updates for new match fields (envelope recipient, visibility, read status) are independent of move tracking and can ship in a separate phase.

## MVP Recommendation

**Phase 1: Extended Matchers**
1. Read status matching (lowest complexity, already have the data)
2. Envelope recipient extraction (medium complexity, high value for +tag users)
3. Header visibility classification (medium complexity, depends on envelope work)
4. UI updates for all three new match fields

**Phase 2: Behavioral Learning**
1. Move tracking infrastructure (periodic scan, SQLite logging)
2. Pattern detection engine (statistical analysis, candidate generation)
3. Proposed rules UI (approval/dismiss/edit workflow)

**Defer:**
- Rule simulation on proposed rules: Nice-to-have but not essential for the first cut. Can show signal count and confidence instead of a full dry-run simulation.
- Bulk rule approval: Start with one-at-a-time approval. Bulk is a UX optimization for later.

## Sources

- [ImapFlow Fetching Messages](https://imapflow.com/docs/guides/fetching-messages/) -- fetch API, headers option
- [ImapFlow Client API](https://imapflow.com/docs/api/imapflow-client/) -- search by emailId, OBJECTID support
- [Fastmail Email Addressing](https://www.fastmail.help/hc/en-us/articles/360058753414-Email-addressing) -- plus addressing behavior
- [Fastmail Plus and Subdomain Addressing](https://www.fastmail.help/hc/en-us/articles/360060591053) -- +tag folder routing
- [Fastmail Email Delivery Process](https://www.fastmail.help/hc/en-us/articles/1500000278262-The-email-delivery-process) -- X-Delivered-To, X-Resolved-To headers
- [RFC 8474: IMAP Extension for Object Identifiers](https://datatracker.ietf.org/doc/html/rfc8474) -- OBJECTID/emailId for cross-folder tracking (authored by Fastmail)
- [EmailEngine: Tracking Deleted Messages](https://docs.emailengine.app/tracking-deleted-messages-on-an-imap-account/) -- UID/move tracking approaches
- [HEY Screener](https://help.hey.com/article/722-the-screener) -- approval workflow UX pattern
- [SaneBox Review](https://toolchamber.com/sanebox-review/) -- behavioral learning approach
- imapflow source (`node_modules/imapflow/lib/commands/fetch.js`) -- verified headers fetch accepts array, returns Buffer (HIGH confidence)
