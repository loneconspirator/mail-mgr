# Mail Manager Roadmap

## Where We Are

The current system (v0.1) is a working IMAP monitor with deterministic pattern-matching rules, a web UI for rule/activity/settings management, and SQLite-backed activity logging. It watches INBOX, matches messages by sender/recipient/subject globs, and moves them to folders. This is a solid foundation — but it only knows how to do one thing (move), only watches one folder (INBOX), and has no concept of triage vs. archive.

## Where We're Going

A system that separates **triage** from **retrieval**. Email arrives into one of two streams — Inbox (act on it) or Review (batch-process it later). An archival folder structure organizes messages for retrieval. The system learns from user behavior and eventually proposes its own rules. LLM classification handles what pattern matching can't.

---

## Tier 2: Two-Stream Intake

**The big quality-of-life upgrade.** This tier transforms the system from "auto-filer" to "triage assistant" by introducing the Review folder and the concept of routing disposition.

### Product Requirements

- **Three routing dispositions for rules:** A rule can now route a message to one of three places: a specific archive folder (auto-archive), the Review folder, or leave it in Inbox. Today every rule is a move-to-folder. This tier adds "route to Review" as a first-class action and "leave in Inbox" as an explicit skip.

- **Review folder:** A holding pen for messages that deserve a glance but not individual attention. Messages land here unread. The user batch-processes them a couple times a week.

- **Review lifecycle sweeps:** The system periodically sweeps the Review folder:
  - Read messages older than ~7 days → auto-archive (default destination: `MailingLists`, unless a rule specifies otherwise).
  - Unread messages older than ~14 days → auto-archive with the same logic.
  - Sweep intervals and age thresholds should be configurable.

- **Delete action:** Rules can now delete messages (move to Trash). This handles junk that should never reach Inbox or Review.

- **Multi-folder monitoring:** The monitor must now watch both INBOX (for arrival routing) and Review (for lifecycle sweeps). This is a meaningful architectural change — the current system assumes a single monitored mailbox.

- **UI updates:** Rule editing now includes disposition choice (archive to folder / route to Review / leave in Inbox / delete). Activity log shows which stream a message was routed to. A new "Review" status section shows the current Review folder item count and upcoming sweep actions.

### Technical Guardrails

- The sweep logic should be a separate concern from arrival-time routing. Arrival rules evaluate new messages; sweeps evaluate messages already sitting in Review based on age and read status. These are different pipelines even though they share the action execution layer.
- The IMAP client needs to support reading flags (specifically `\Seen`) and internal dates from messages in the Review folder. The current `fetchNewMessages` only pulls envelopes from INBOX by UID range.
- Sweep timing: periodic (e.g., every 6 hours), not continuous. This is a batch job, not a real-time monitor.

---

## Tier 3: Archival Folder Structure

**Make retrieval useful.** This tier establishes the intentional folder hierarchy and teaches the system where things belong.

### Product Requirements

- **Folder taxonomy configuration:** The user defines their archival folder structure in config — top-level categories (`Activities`, `MailingLists`, `Projects`), subcategories (`Activities/Mountaineers`, `Projects/HomeBuild`), and a retirement area (`zz_old/`). The system uses this as its universe of valid destinations.

- **Default archive destination:** Configurable per-stream. Messages aging out of Review default to `MailingLists` unless a more specific rule matches. Messages auto-archived at arrival time use whatever folder the rule specifies.

- **Folder browsing in UI:** Rule creation shows the configured folder tree as a picker instead of a free-text field. The user can also create new folders from the picker, which updates the taxonomy.

- **Folder lifecycle:** A way to mark a project/activity folder as "retired" — moves it under `zz_old/` in the config and stops routing new mail to it. Old mail stays put. This is a UI action, not automatic.

- **Retroactive filing (batch apply):** Apply a rule to existing messages in a folder. When the user creates a new rule or reorganizes, they can say "apply this rule to everything in INBOX" or "apply to Review." This is a one-shot operation, not ongoing monitoring.

### Technical Guardrails

- The folder taxonomy is metadata the system maintains, not a mirror of what's on the IMAP server. The server may have folders the system doesn't know about (legacy folders, folders created by other clients). The taxonomy represents the *intended* structure.
- Batch apply needs to be interruptible and report progress. Filing 10,000 messages takes time.

---

## Tier 4: Extended Matchers and Behavioral Learning

**Smarter deterministic rules, trained by watching the user.** This tier expands the rule matcher with new fields, tracks how the user manually organizes mail, and proposes new rules based on statistical patterns.

### Product Requirements

- **Extended rule match criteria:** Rules currently match on sender and subject globs. Add three new match fields:
  - **Recipient:** Match on the recipient address (To, CC). Same glob syntax as sender matching.
  - **Read status:** Match on whether the message is read or unread at evaluation time. Useful for sweep rules that treat read and unread messages differently.
  - **Recipient visibility:** Match on how the recipient appears in the message headers. Categories: `direct` (in the To field), `cc` (in the CC field), `bcc` (recipient address not in To or CC — likely BCC or envelope-only delivery), `list` (message has List-Id or similar mailing list headers indicating list delivery). A rule can match one or more of these visibility types.

- **UI updates for new fields:** Rule creation/editing surfaces the new match fields. Recipient and read status are straightforward additions. Recipient visibility is a multi-select (direct, cc, bcc, list).

- **Move tracking:** The system detects when the user manually moves messages by periodically scanning folder contents and comparing against known state. For each detected move, log: sender, all recipients, mailing list headers, subject, read status, recipient visibility, source folder, destination folder. Key movements to track:
  - Inbox → archive folders (user filing messages the system didn't catch)
  - Inbox → Review (user demoting messages to batch processing)
  - Review → archive folders (user filing during batch review)
  - Review → Inbox (user promoting messages back to action-needed)
  - Archive folders → Inbox (user pulling something back — indicates a rule may be filing too aggressively)

- **Pattern detection:** Statistical analysis on logged moves to identify repeating patterns. If the user moves 5+ messages matching a common pattern (same sender, same recipient visibility, same destination), that's a candidate rule.

- **Proposed rules:** The system surfaces detected patterns as rule proposals in the UI: "You've moved 8 emails from `noreply@rei.com` to Review — want me to do this automatically?" The user can approve (becomes a real rule), modify (adjust the pattern or destination), or dismiss.

- **Rule effectiveness dashboard:** Which rules fire most often? Which rules has the user overridden by manually moving messages elsewhere? Are there messages sitting in Inbox that match a Review-stream profile?

### Technical Guardrails

- Recipient visibility detection must handle edge cases: messages delivered via mailing list that also CC the user directly, messages where the user's address appears in both To and CC, etc. When ambiguous, prefer the most visible category (direct > cc > list > bcc).
- Move detection requires scanning multiple folders, which is expensive on IMAP. This should run infrequently (e.g., every few hours) and use IMAP CONDSTORE/QRESYNC if available to minimize data transfer.
- Proposed rules must be conservative. A false positive (auto-filing something the user wanted to see) is much worse than a false negative (leaving something in Inbox). Set a high threshold for proposal confidence.
- Move tracking state must be durable across restarts. The system needs to know what was where last time it checked.

---

## Tier 5: LLM Classification

**Handle what patterns can't.** Some mail can't be sorted by deterministic rules alone. This tier adds LLM-based classification with privacy-conscious progressive disclosure, and LLM-driven rule suggestions.

### Product Requirements

- **LLM-instructed rules:** Rules that use natural language instructions instead of glob patterns. Example: "Anything about upcoming outdoor trips → Activities." These are evaluated only when no deterministic rule matches.

- **Progressive disclosure:** When the LLM evaluates a message, it receives information incrementally:
  - Level 1: Envelope only (sender, recipients, recipient visibility, mailing list headers). Many messages can be classified on metadata alone.
  - Level 2: Plus subject line.
  - Level 3: Plus body text. Most invasive; opt-in.
  The system stops at the first level that produces a confident classification.

- **Disclosure controls:**
  - Global maximum disclosure level (default: Level 2 — envelope + subject, no body).
  - Per-pattern caps using the same match syntax as deterministic rules. Example: anything to `mike+medical@example.com` capped at Level 1.

- **Classification logging:** Every LLM classification logs which disclosure level was needed and what the LLM decided. This data informs future deterministic rule creation.

- **LLM-driven rule suggestions:** If the LLM consistently classifies messages that share a simple deterministic pattern (same sender, same list-id, same recipient visibility), the system suggests promoting it to a deterministic rule. This reduces LLM costs and improves speed.

- **LLM configuration in UI:** API provider, model, key. Support for at least one provider (Anthropic or OpenAI-compatible).

- **Cost visibility:** The UI shows LLM usage — classifications per day, estimated cost, disclosure level distribution.

### Technical Guardrails

- LLM calls must be async and must not block the arrival-routing pipeline for other messages. If the LLM is slow, other messages should still process.
- The progressive disclosure levels should be implemented as a pipeline, not three separate API calls. The system should be able to short-circuit at any level.
- The LLM needs to know the folder taxonomy (from Tier 3) to make useful classifications. The prompt should include the available folders and any descriptions the user has attached to them.
- Rate limiting and retry logic for LLM API calls. A temporary API outage should not cause messages to pile up unprocessed — they should stay in Inbox and be retried on the next cycle.
- LLM rule suggestions and behavioral rule suggestions (from Tier 4) should use the same proposal UI and workflow — approve, modify, or dismiss.

---

## Tier 6: Review Digest and Polish

**Quality of life.** Refinements that make the system feel finished rather than functional.

### Product Requirements

- **Review digest:** Before the sweep runs, generate a summary of items about to age out of Review and surface it — either as a notification in the UI, a digest email, or both. This gives the user one last chance to pull something back to Inbox before it's archived.

- **Amusing scams folder:** A novelty archive destination. The system (via LLM) can identify entertaining scam emails and file them to a designated folder instead of deleting them.

- **Rule dry-run:** Preview what a rule would do against existing messages before activating it. Shows a list of messages that would match and where they'd go.

- **Multi-account support:** Run one instance that monitors multiple IMAP accounts. The current architecture (one instance per account via Docker) works, but a single UI managing multiple accounts is more convenient.

- **Mobile-friendly UI:** The current SPA works fine on desktop. Make it responsive for quick checks from a phone.

---

## Sequencing Rationale

The tiers are ordered by impact and dependency:

1. **Tier 2 (Two-Stream Intake)** is the single biggest quality-of-life improvement. It takes the system from "auto-filer" to "triage assistant" and delivers the core value proposition: dramatically reducing inbox volume without losing visibility.

2. **Tier 3 (Folder Structure)** establishes the organizational backbone. Without an intentional taxonomy, the system doesn't know *where* things should go — it only knows individual rule destinations. The taxonomy gives the system (and later, the LLM) a coherent map of the archive.

3. **Tier 4 (Extended Matchers and Behavioral Learning)** enriches the deterministic rule engine before introducing LLM complexity. Adding recipient, read status, and recipient visibility to matchers makes the existing rule system significantly more powerful — many messages that would require LLM classification can be handled deterministically with these fields. Move tracking and rule suggestions let the system learn from user behavior using pure statistical analysis, no external API dependencies. This tier also generates the behavioral data that makes Tier 5's LLM suggestions more informed.

4. **Tier 5 (LLM Classification)** depends on the folder taxonomy (Tier 3) and benefits from the extended matcher fields and behavioral data (Tier 4). The LLM needs to know what folders are available, what fields are matchable, and what the user's filing patterns look like. Progressive disclosure leverages the recipient visibility concept introduced in Tier 4. LLM rule suggestions complement the statistical suggestions from Tier 4 by catching patterns that require semantic understanding.

5. **Tier 6 (Polish)** is genuinely optional. The system is fully functional after Tier 5. These are refinements.

Each tier is independently deployable and useful. You could stop after Tier 2 and have a significantly better email experience than what exists today. You could stop after Tier 3 and have a well-organized archive. Tier 4 makes the deterministic engine substantially smarter without any external dependencies. The LLM capabilities in Tier 5 are powerful but not prerequisites for daily value.
