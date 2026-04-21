# Mail Manager Roadmap

## Where We Are

The current system (v0.3) has a working IMAP monitor with deterministic pattern-matching rules, a two-stream intake model (Inbox + Review), review lifecycle sweeps, a web UI for rule/activity/settings management, an archival folder taxonomy with a folder picker, folder retirement, retroactive batch filing, and SQLite-backed activity logging. It watches INBOX and Review, matches messages by sender/recipient/subject globs, and routes them to archive folders, Review, Inbox, or Trash.

Tiers 2 (Two-Stream Intake) and 3 (Archival Folder Structure) are complete. The system handles arrival-time routing, review lifecycle sweeps, delete actions, multi-folder monitoring, configurable folder taxonomy, folder browsing in the UI, folder retirement to `zz_old/`, and retroactive batch filing.

## Where We're Going

A system that learns from user behavior and eventually proposes its own rules. Extended rule matchers handle what simple sender/subject globs can't. Action folders let the user manage routing from the mail client. LLM classification handles what deterministic rules can't. The system gets smarter over time while the user stays in control — no routing happens without an explicit rule.

---

## Tier 4: Extended Matchers and Behavioral Learning

**Smarter deterministic rules, trained by watching the user.** This tier expands the rule matcher with new fields based on the two distinct addressing signals (envelope recipient and header visibility), tracks how the user manually organizes mail, and proposes new rules based on statistical patterns.

### Product Requirements

- **Envelope recipient matching:** Match on the address that actually received the message, extracted from delivery headers (`Delivered-To`, `X-Original-To`, or inferred from `Received` headers). This captures `+tag` variants and catch-all addresses. Same glob syntax as sender matching. Useful for rules like "anything to `mike+github@example.com` goes to Projects."

- **Header visibility matching:** Match on how prominently the user was addressed in the message headers. Categories: `direct` (in the To field), `cc` (in the CC field), `bcc` (user's address not in To or CC — likely BCC or envelope-only delivery), `list` (message has List-Id or similar mailing list headers). A rule can match one or more of these categories. This is orthogonal to envelope recipient — a message delivered to `mike+lists@example.com` may show `members@group.org` in the To field (header visibility = list).

- **Read status matching:** Match on whether the message is read or unread at evaluation time. Primarily useful for sweep rules that treat read and unread messages differently.

- **UI updates for new fields:** Rule creation/editing surfaces the new match fields. Envelope recipient uses the same glob input as sender. Header visibility is a multi-select (direct, cc, bcc, list). Read status is a toggle.

- **Move tracking:** The system detects when the user manually moves messages by periodically scanning folder contents and comparing against known state. For each detected move, log: sender, envelope recipient (including +tag), mailing list headers, subject, read status, header visibility, source folder, destination folder. Key movements to track:
  - Inbox → archive folders (user filing messages the system didn't catch)
  - Inbox → Review (user demoting messages to batch processing)
  - Review → archive folders (user filing during batch review)
  - Review → Inbox (user promoting messages back — candidate for inbox-pinning rule)
  - Archive folders → Inbox (user pulling something back — indicates a rule may be filing too aggressively)

- **Pattern detection:** Statistical analysis on logged moves to identify repeating patterns. If the user moves 5+ messages matching a common pattern (same sender, same header visibility, same destination), that's a candidate rule.

- **Proposed rules:** The system surfaces detected patterns as rule proposals in the UI: "You've moved 8 emails from `noreply@rei.com` to Review — want me to do this automatically?" The user can approve (becomes a real rule), modify (adjust the pattern or destination), or dismiss. When the user repeatedly moves a sender's messages back from Review to Inbox, the system proposes an inbox-pinning rule for that sender.

### Technical Guardrails

- Envelope recipient extraction must handle multiple header formats: `Delivered-To`, `X-Original-To`, and parsing `Received` headers as a fallback. Not all mail servers include the same headers. The system should try each source in order and use the first match.
- Header visibility detection must handle edge cases: messages delivered via mailing list that also CC the user directly, messages where the user's address appears in both To and CC, etc. When ambiguous, prefer the most visible category (direct > cc > list > bcc).
- Move detection requires scanning multiple folders, which is expensive on IMAP. This should run infrequently (e.g., every few hours) and use IMAP CONDSTORE/QRESYNC if available to minimize data transfer.
- Proposed rules must be conservative. A false positive (auto-filing something the user wanted to see) is much worse than a false negative (leaving something in Inbox). Set a high threshold for proposal confidence.
- Move tracking state must be durable across restarts. The system needs to know what was where last time it checked.

---

## Tier 5: Sender Disposition Views

**A sender-centric lens on routing rules.** This tier surfaces filtered views of the rule list organized by what happens to mail from each sender. Every view shows rules where sender is the only match criterion, grouped by routing action. These are presentation-layer features over the existing rule system — no new data structures, no new rule types.

### Product Requirements

- **Priority Senders:** Rules where the only match criterion is sender and the action is "leave in inbox." Displayed as a flat list of sender addresses. Feels like managing a VIP list. Users can add/remove senders directly from this view (which creates/deletes the underlying rule).

- **Blocked Senders:** Rules where the only match criterion is sender and the action is "delete." Same flat-list presentation. Feels like managing a block list.

- **Reviewed Senders:** Rules where the only match criterion is sender and the action is "route to Review." Flat list of senders whose mail is automatically diverted to batch processing.

- **Archived Senders:** Rules where the only match criterion is sender and the action is "move to [archive folder]." Grouped by destination folder — so the user sees sections like "MailingLists (12 senders)", "Projects/HomeBuild (3 senders)", etc. Within each group, a flat list of sender addresses.

- **Inline management:** Each view supports adding and removing senders directly, without navigating to the full rule editor. Adding a sender from a disposition view creates a sender-only rule with the appropriate action (and, for Archived Senders, the selected destination folder). Removing a sender deletes the rule. For users who need more complex match criteria, the full rule editor is still available — these views only show and manage the simple sender-only cases.

- **Navigation:** The disposition views are accessible as tabs or sections alongside the main rule list, not replacements for it. The main rule list continues to show all rules including the sender-only ones. A rule that appears in a disposition view should link back to its full rule entry for editing.

### Technical Guardrails

- The views are query-based filters over the existing rule set. No separate storage, no sync concerns.
- A rule stops appearing in a disposition view the moment it gains a second match criterion (e.g., sender + subject). This is by design — the views are specifically for the simple "this sender always gets this treatment" pattern.
- The Archived Senders grouping should update dynamically as the folder taxonomy changes. If a destination folder is retired to `zz_old/`, rules targeting it should still appear (possibly with a visual indicator that the folder is retired).

---

## Tier 6: Action Folders

**Manage routing from the mail client.** This tier lets the user create and remove common rules by moving messages to special folders in their mail client, without switching to the web UI. Action folders are shortcuts for rule management — the resulting rules are standard rules that appear in the normal rule list and the sender disposition views.

### Product Requirements

- **Action folder set:** The system creates and monitors a set of folders under an `Actions/` prefix:
  - **Actions/VIP Sender** — moving a message here creates a sender-only inbox-pinning rule (action: leave in inbox) for the message's sender, then archives the message to the appropriate folder. If a rule already exists for this sender, no duplicate is created.
  - **Actions/Block Sender** — creates a sender-only delete rule for the message's sender, then deletes the message (moves to Trash). If a rule already exists, no duplicate.
  - **Actions/Undo VIP** — removes any inbox-pinning rule matching the message's sender, then archives the message. If no matching rule exists, the message is still archived.
  - **Actions/Unblock Sender** — removes any delete rule matching the message's sender, then moves the message to Inbox. If no matching rule exists, the message is still moved.

- **Folder lifecycle:** The system creates the action folders on startup if they don't exist. They should always be empty after processing — the system processes messages immediately (or on the next poll cycle) and moves them to their final destination.

- **Activity logging:** Every action folder operation is logged: which sender was affected, what rule was created or removed, where the message ended up. The activity log entry should make it clear this was triggered by an action folder, not a manual rule edit.

- **UI integration:** Action folder operations appear in the activity log. The sender disposition views (from Tier 5) reflect rules created via action folders identically to rules created in the web UI — because they are the same rules.

- **Extensibility:** The action folder pattern should be designed so additional action types can be added later (e.g., "Actions/Route to Review" to create a review-routing rule, "Actions/File to [Folder]" for direct archive rules). This tier implements the four sender disposition actions; the architecture should support future additions without rework.

### Technical Guardrails

- The monitor must watch the `Actions/` folders in addition to Inbox and Review. This extends the multi-folder monitoring from Tier 2.
- Action folder processing must be idempotent. If the system restarts while a message is sitting in an action folder, it should process it on startup without creating duplicate rules.
- The system must handle the case where a message in an action folder has no parseable sender address — log an error and move the message to Inbox rather than silently dropping it.
- Action folders should be processed with higher priority than regular arrival routing — the user is explicitly asking for something, so it should happen promptly.
- Rule creation via action folders must respect the same validation as the web UI. If a sender glob would be invalid, log the error and move the message to Inbox.

---

## Tier 7: LLM Classification

**Handle what patterns can't.** Some mail can't be sorted by deterministic rules alone. This tier adds LLM-based classification with privacy-conscious progressive disclosure, and LLM-driven rule suggestions.

### Product Requirements

- **LLM-instructed rules:** Rules that use natural language instructions instead of glob patterns. Example: "Anything about upcoming outdoor trips → Activities." These are evaluated only when no deterministic rule matches.

- **Progressive disclosure:** When the LLM evaluates a message, it receives information incrementally:
  - Level 1: Envelope only (sender, envelope recipient, header visibility, mailing list headers). Many messages can be classified on metadata alone.
  - Level 2: Plus subject line.
  - Level 3: Plus body text. Most invasive; opt-in.
  The system stops at the first level that produces a confident classification.

- **Disclosure controls:**
  - Global maximum disclosure level (default: Level 2 — envelope + subject, no body).
  - Per-pattern caps using the same match syntax as deterministic rules. Example: anything to `mike+medical@example.com` capped at Level 1.

- **Classification logging:** Every LLM classification logs which disclosure level was needed and what the LLM decided. This data informs future deterministic rule creation.

- **LLM-driven rule suggestions:** If the LLM consistently classifies messages that share a simple deterministic pattern (same sender, same list-id, same header visibility), the system suggests promoting it to a deterministic rule. This reduces LLM costs and improves speed.

- **LLM configuration in UI:** API provider, model, key. Support for at least one provider (Anthropic or OpenAI-compatible).

- **Cost visibility:** The UI shows LLM usage — classifications per day, estimated cost, disclosure level distribution.

### Technical Guardrails

- LLM calls must be async and must not block the arrival-routing pipeline for other messages. If the LLM is slow, other messages should still process.
- The progressive disclosure levels should be implemented as a pipeline, not three separate API calls. The system should be able to short-circuit at any level.
- The LLM needs to know the folder taxonomy (from Tier 3) to make useful classifications. The prompt should include the available folders and any descriptions the user has attached to them.
- Rate limiting and retry logic for LLM API calls. A temporary API outage should not cause messages to pile up unprocessed — they should stay in Inbox and be retried on the next cycle.
- LLM rule suggestions and behavioral rule suggestions (from Tier 4) should use the same proposal UI and workflow — approve, modify, or dismiss. LLM-created rules that are sender-only should appear in the sender disposition views (Tier 5).

---

## Tier 8: Review Digest and Polish

**Quality of life.** Refinements that make the system feel finished rather than functional.

### Product Requirements

- **Review digest:** Before the sweep runs, generate a summary of items about to age out of Review and surface it — either as a notification in the UI, a digest email, or both. This gives the user one last chance to pull something back to Inbox before it's archived. (See design concept for discussion of when this matters.)

- **Rule dry-run:** Preview what a rule would do against existing messages before activating it. Shows a list of messages that would match and where they'd go.

- **Retroactive rule application:** When creating or editing a rule, an optional checkbox to apply it to existing messages in a specified folder. One-shot batch operation with progress reporting.

- **Multi-account support:** Run one instance that monitors multiple IMAP accounts. The current architecture (one instance per account) works, but a single UI managing multiple accounts is more convenient.

- **Mobile-friendly UI:** The current SPA works fine on desktop. Make it responsive for quick checks from a phone.

- **Rule effectiveness dashboard:** Which rules fire most often? Which rules has the user overridden by manually moving messages elsewhere? Are there messages sitting in Inbox that match a Review-stream profile? Depends on move tracking data from Tier 4.

---

## Sequencing Rationale

The tiers are ordered by impact and dependency:

1. **Tier 2 (Two-Stream Intake)** is the single biggest quality-of-life improvement. It takes the system from "auto-filer" to "triage assistant" and delivers the core value proposition: dramatically reducing inbox volume without losing visibility. *(Complete.)*

2. **Tier 3 (Folder Structure)** establishes the organizational backbone. Without an intentional taxonomy, the system doesn't know *where* things should go — it only knows individual rule destinations. The taxonomy gives the system (and later, the LLM) a coherent map of the archive. *(Complete.)*

3. **Tier 4 (Extended Matchers and Behavioral Learning)** enriches the deterministic rule engine before introducing LLM complexity. Adding envelope recipient, header visibility, and read status to matchers makes the existing rule system significantly more powerful — many messages that would require LLM classification can be handled deterministically with these fields. Move tracking and rule suggestions let the system learn from user behavior using pure statistical analysis, no external API dependencies. This tier also generates the behavioral data that makes Tier 7's LLM suggestions more informed.

4. **Tier 5 (Sender Disposition Views)** is a pure UI tier that gives the user a sender-centric view of their rules. It depends on Tier 4's extended matchers (since rules now have richer match criteria, the "sender-only" filter becomes more meaningful as a way to distinguish simple sender routing from complex multi-field rules). Placing it here means the views are ready before action folders (Tier 6) start creating rules that should appear in them. No backend changes — just filtered queries over existing rules.

5. **Tier 6 (Action Folders)** depends on Tier 5's disposition views — the rules created by action folders should immediately appear in the appropriate view (Priority Senders, Blocked Senders). It also depends on Tier 4's move tracking infrastructure to distinguish action-folder moves from organic user moves. This tier has no external dependencies and is relatively lightweight compared to LLM integration.

6. **Tier 7 (LLM Classification)** depends on the folder taxonomy (Tier 3) and benefits from the extended matcher fields and behavioral data (Tier 4). The LLM needs to know what folders are available, what fields are matchable, and what the user's filing patterns look like. Progressive disclosure leverages the envelope recipient and header visibility concepts from Tier 4. LLM rule suggestions complement the statistical suggestions from Tier 4 by catching patterns that require semantic understanding. Sender-only rules created by LLM promotion appear in the disposition views (Tier 5).

7. **Tier 8 (Polish)** is genuinely optional. The system is fully functional after Tier 7. These are refinements that improve trust (review digest), convenience (retroactive application, dry-run), and reach (multi-account, mobile).

Each tier is independently deployable and useful. You could stop after Tier 3 and have a well-organized, two-stream email experience. Tier 4 makes the deterministic engine substantially smarter without any external dependencies. Tier 5 gives the user an intuitive sender-centric interface over those rules. Tier 6 brings rule management into the mail client. The LLM capabilities in Tier 7 are powerful but not prerequisites for daily value.

---

## Ideas for future versions

- "Explain" Action folder - move a message here and the system will email you an explanation of why it was moved
- "Propose" Action folder - move a message here and the system will suggest a rule to handle it, including an analysis of existing messages matching elements of the moved message and where they are archived, also surfacing related rules
- "Snooze" Action Folders (1day, 1week, 1month, and smart) Sets messages to the side to be stuck back in to the inbox at a later date. Smart snooze uses LLM to determine when to resurface the message
- Proposed rules messages. Have a "Rules" folder. The system will put messages in there describing proposed rules that have met a certain threshold of strength. It will have subfolders for "New Move Rule", "New Review Rule", and "Reject" where the user can move the rule messages
