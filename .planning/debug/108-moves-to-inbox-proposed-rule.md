---
status: diagnosed
trigger: "108-moves-to-inbox-proposed-rule: Proposed rule shows '108' moves to INBOX from info@e.boynerewards.com on Soma prod"
created: 2026-04-30T00:00:00Z
updated: 2026-04-30T00:00:00Z
---

## Current Focus

hypothesis: Two compounding issues — (a) destination=INBOX is permitted at all (no guard against proposing routes to INBOX), and (b) `getRecentFolders` legitimately surfaces INBOX as a candidate destination whenever the source folder is the Review folder, because action-folder processing (`vip`/`undoVip`/`unblock`) writes activity rows with `folder='INBOX'`.
test: Read proposal generation pipeline end-to-end; check candidate filtering; verify source-of-truth for destination_folder values.
expecting: The 108-count proposal most likely has `source_folder = <review folder>` (NOT 'INBOX'); the UI rendering may have led the user to assume the source is INBOX.
next_action: Produce diagnosis report; do NOT fix.

## Symptoms

expected: Proposed rules should have a sensible destination (not INBOX, since INBOX is the origin); count should reflect real observations.
actual: Proposed rule shows "108" moves to INBOX from info@e.boynerewards.com.
errors: None - data/logic anomaly only.
reproduction: View proposed rules in Mail Manager web UI on Soma (192.168.1.90).
started: Not specified - surfaced "now" on prod Soma instance.

## Eliminated

- hypothesis: matching_count=108 is a literal/stringified bug or accumulation bug
  evidence: proposals.ts line 68-69: `const matchingCount = maxCount` where maxCount is the per-destination count from `destCounts[destination] = (destCounts[destination] ?? 0) + 1`. Each increment is +1 per real signal. 108 means 108 real signal rows. Not an artifact.
  timestamp: 2026-04-30

- hypothesis: A code path explicitly synthesizes destination='INBOX' as a default
  evidence: All call sites of `signalStore.logSignal` (only one: `tracking/index.ts:300`) pass `destinationFolder` from `destinationResolver.resolveFast()` (return type `string | null`) or from `runDeepScan` results. No literal 'INBOX' default. PatternDetector.processSignal (`tracking/detector.ts:20`) just forwards `signal.destinationFolder` unchanged.
  timestamp: 2026-04-30

- hypothesis: Source folder filter is broken letting INBOX→INBOX through
  evidence: destinations.ts lines 65-69 and 70-74 both skip `if (folder !== sourceFolder)`. Comparison is case-sensitive but both `inboxFolder` ('INBOX' from index.ts:258/423) and the activity-log-stored folder string ('INBOX' from action-folder processor passing `this.inboxFolder = 'INBOX'`) match exactly. INBOX cannot leak through this filter as a candidate when sourceFolder='INBOX'.
  timestamp: 2026-04-30

## Evidence

- timestamp: 2026-04-30
  checked: src/tracking/proposals.ts (ProposalStore.upsertProposal, getProposals, rowToProposal)
  found: Proposals are uniquely keyed on (sender, envelope_recipient, source_folder). `destination_folder` is the single dominant destination computed from `destination_counts` JSON. `matching_count` is the count for the dominant. Schema at `src/log/migrations.ts:39-58` confirms `destination_folder TEXT NOT NULL`. There is **no validation** that destination ≠ source.
  implication: A proposal for "INBOX→INBOX" would be permitted by the data model; the only thing preventing it is whether any signal ever lands with that pair.

- timestamp: 2026-04-30
  checked: src/tracking/destinations.ts (DestinationResolver.resolveFast, COMMON_FOLDERS)
  found: COMMON_FOLDERS hardcoded list (lines 30-40) does NOT include 'INBOX'. `recentFolders` come from `activityLog.getRecentFolders(10)`. Both lists merged and filtered by `folder !== sourceFolder`. So INBOX can only become a candidate destination via `recentFolders`, and only when `sourceFolder !== 'INBOX'`.
  implication: When MoveTracker scans the **review** folder and detects a disappearance there, INBOX IS in the candidate set if it's been written to the activity log recently — which it has, every time a VIP/undoVip/unblock action processes a message.

- timestamp: 2026-04-30
  checked: src/log/index.ts (ActivityLog.getRecentFolders, line 171-179)
  found: Returns top destinations from `activity.folder` over last 7 days, ordered by frequency. Includes ALL successful `arrival|sweep|batch|action-folder|sentinel` rows — no filter by source.
  implication: VIP/undoVip/unblock action-folder processing (which writes `folder='INBOX'` per `processor.ts:179-180` and `index.ts:140/232/349/258/423` passing `this.inboxFolder='INBOX'`) directly seeds INBOX into the candidate pool for fast-pass resolution.

- timestamp: 2026-04-30
  checked: src/action-folders/processor.ts:179-180, registry.ts:18-21
  found: Three of four action types (`vip`, `undoVip`, `unblock`) have `destination: 'inbox'`, which `resolveDestination` maps to `this.inboxFolder = 'INBOX'`. Each successful action logs activity with `folder='INBOX'` (line 192-200, then logged at lines 165, 173).
  implication: Any VIP/Block-folder usage on Soma populates `activity.folder='INBOX'` rows, which makes INBOX appear in `getRecentFolders()`.

- timestamp: 2026-04-30
  checked: src/tracking/index.ts (MoveTracker.scanFolder, fetchFolderState, confirmDisappearedMessage, lines 130-258)
  found: MoveTracker scans both INBOX and `reviewFolder` every interval. When a message disappears from review folder for two consecutive scans (and is NOT in `isSystemMove` window — last 24h with sources arrival/sweep/batch/action-folder), `confirmDisappearedMessage` calls `resolveFast(messageId, sourceFolder=reviewFolder)`. If the resolver's search of INBOX returns true (message present there by Message-ID), INBOX is logged as the destination of a "user move".
  implication: A signal with `source_folder=<reviewFolder>, destination_folder='INBOX'` is created. After 108 such events for the same sender+recipient+source, `proposed_rules.matching_count=108` and `destination_folder='INBOX'` — exactly what the user sees.

- timestamp: 2026-04-30
  checked: src/log/index.ts:186-193 (ActivityLog.isSystemMove)
  found: Returns true if any successful activity row exists for the messageId in last 24h with source IN (arrival, sweep, batch, action-folder). Sentinel source NOT included. After 24h, returns false even if the move was system-driven.
  implication: A sweep that moves a Boyner email from review folder to archive after >24h can leave its Message-ID without a system-move marker, so MoveTracker treats the disappearance as user-initiated. The resolver then searches INBOX (a recent folder), and if any Message-ID match exists there, returns INBOX as the destination.

- timestamp: 2026-04-30
  checked: Whether `info@e.boynerewards.com` would plausibly produce duplicate Message-IDs in INBOX
  found: Marketing/loyalty senders (Boyner Rewards) are known to send daily/weekly campaigns. UNLESS a duplicate Message-ID exists in INBOX, `searchFolderForMessage` returns false (it requires exact envelope.messageId match). Most likely scenario: real user moves of Boyner messages from review folder to INBOX over time — i.e., the user pulled Boyner mails back to INBOX and the system genuinely captured 108 such moves.
  implication: 108 is most likely real. Either user really does pull Boyner mails to INBOX (legit pattern), or there's a Message-ID collision case we haven't identified.

- timestamp: 2026-04-30
  checked: src/web/routes/proposed-rules.ts and src/web/frontend/app.ts (rendering)
  found: Backend serves `sourceFolder` and `destinationFolder` separately. UI renders sourceFolder in a small header span (`proposal-source` class) and destinationFolder in the main route arrow span. The user reported "INBOX is the source folder, you don't propose moving INBOX → INBOX" — this strongly suggests they read the destination only and ASSUMED source=INBOX, which would be true for nearly all their other proposals (their local DB shows all 11 proposals have source_folder='INBOX').
  implication: For THIS specific proposal, `source_folder` is almost certainly the **review folder**, not INBOX. The user's "wait this is INBOX→INBOX" reaction is plausibly a misread of UI.

- timestamp: 2026-04-30
  checked: Local DB at /Users/mike/git/mail-mgr/data/db.sqlite3
  found: 11 proposals total, all source='INBOX', all matching_count=1, no Boyner-related rows. move_signals show only INBOX→<dest> patterns, no INBOX→INBOX. Recent activity dominated by '2_Mailing Lists' (15759 rows). INBOX only seen as destination when configured by VIP/etc actions.
  implication: Bug is not reproducible on local instance. Soma has different config / different rule set / different action-folder usage history. The bug is **data-conditional** (depends on Soma's specific activity history and rule set), not a pure code defect.

## Resolution

root_cause: |
  PRIMARY ROOT CAUSE (high confidence): The proposal "108 moves to INBOX from info@e.boynerewards.com" is most likely a real signal pattern with `source_folder = <review folder>` (NOT 'INBOX'). The user is reading the proposal card, sees the destination "INBOX", and assumes the source is INBOX (as it is for nearly all other proposals). The 108 count is real — it represents 108 actual user moves of Boyner messages from the review folder to INBOX (or 108 system-driven disappearances from review folder that the resolver mistakenly attributed to INBOX via fast-pass search).

  SECONDARY ROOT CAUSE (high confidence): The destination resolver pipeline has no guard preventing INBOX from being a proposed destination, even though "move messages to INBOX" is semantically meaningless for an inbound rule (you can't route incoming mail to a folder that's already where it lands). INBOX legitimately enters the fast-pass candidate set via `getRecentFolders()` whenever any VIP/undoVip/unblock action-folder operation has occurred in the last 7 days, because `ActionFolderProcessor.processMessage` writes activity rows with `folder='INBOX'` (src/action-folders/processor.ts:179-180, registry.ts:18-21). Once INBOX is in the candidate set and the source is the review folder, a Message-ID search hit in INBOX produces a `destination_folder='INBOX'` signal.

  TERTIARY (lower confidence, can't verify without Soma's DB): If the user honestly DID see source_folder='INBOX' AND destination_folder='INBOX' in the same row, that requires `resolveFast(messageId, 'INBOX')` to return 'INBOX' — which the current code prevents via the `folder !== sourceFolder` filter at destinations.ts:66/71. This is only possible if the activity log holds an INBOX-but-not-string-equal value (whitespace, case mismatch, or alternate path like '[Gmail]/INBOX'). Given Fastmail backend and hardcoded 'INBOX' constants throughout the codebase, this is unlikely.

  ANSWERS TO ENVIRONMENT QUESTIONS:
  1. Why "INBOX" appears as destination: It's in the resolver's recentFolders pool because action-folder VIP/undoVip/unblock actions all write activity rows with folder='INBOX' (registry.ts:18,20,21 + processor.ts:179-180). When MoveTracker scans the **review folder** (not INBOX) and a message disappears, INBOX is included in fast-pass candidates and `searchFolderForMessage` returns true if the Message-ID matches anything in INBOX. Result: destination_folder='INBOX' in move_signals.
  2. Is "108" legitimate: Yes — `matching_count` is incremented +1 per signal with no aggregation tricks (proposals.ts:55, 68-69). 108 means 108 distinct signals. Whether each signal is a TRUE user move vs. a resolver-misattribution is the underlying question.
  3. Soma-only or reproducible locally: Soma-only at the moment because it depends on (a) the user having used VIP/Block action folders enough to seed INBOX into recentFolders, AND (b) having a Boyner review-routing rule, AND (c) Boyner messages disappearing from review folder over time and falsely matching in INBOX. Reproducing locally would require seeding the activity table and running the tracker against a contrived IMAP state.

fix: |
  NOT IMPLEMENTING (diagnose-only mode). Suggested directions, in increasing order of invasiveness:

  STRATEGY A — Disallow INBOX as a destination (recommended, simplest, highest-impact):
  - In `DestinationResolver.resolveFast` (src/tracking/destinations.ts:60-84), exclude 'INBOX' from the candidate set unconditionally:
    ```ts
    const isInbox = (f: string) => f.toUpperCase() === 'INBOX';
    if (!isInbox(folder) && folder !== sourceFolder) candidates.add(folder);
    ```
  - Same exclusion in `runDeepScan` (lines 99-143) when iterating `allFolders`.
  - Rationale: A "move to INBOX" rule has no useful semantic — INBOX is the entrance, not a routing target. Even when the user genuinely moves a message back to INBOX, that's a one-off "rescue" action that should not be promoted to a rule.

  STRATEGY B — Filter at the proposal layer:
  - In `ProposalStore.upsertProposal` (src/tracking/proposals.ts:23), short-circuit when `destination.toUpperCase() === 'INBOX'`. Don't aggregate INBOX-destinated signals into proposed rules at all.
  - Rationale: Keeps signals as historical truth (move_signals still records what happened) but prevents them from becoming proposals.

  STRATEGY C — Filter at the rendering / API layer:
  - In `getProposals()` (proposals.ts:137-145) or the route at src/web/routes/proposed-rules.ts:42-49, drop proposals where `destination_folder.toUpperCase() === 'INBOX'`.
  - Less ideal: accumulates noise in the table forever; doesn't fix the underlying signal pollution.

  STRATEGY D — Tighten `getRecentFolders` to exclude INBOX:
  - In src/log/index.ts:171-179, add `AND folder != 'INBOX'`.
  - Less ideal alone: only addresses the resolver candidate seed, not the deep-scan path or hypothetical sentinel/etc. paths.

  CLEANUP (optional, regardless of fix strategy):
  - One-time SQL on Soma's db.sqlite3:
    ```sql
    DELETE FROM move_signals WHERE destination_folder = 'INBOX';
    DELETE FROM proposed_rules WHERE destination_folder = 'INBOX';
    ```
    or scope tighter (e.g., where status='active' and destination_folder='INBOX').

  RECOMMENDED COMBINATION: Strategy A + B together. A prevents future signal pollution from the resolver; B is belt-and-suspenders against any other call path that might create an INBOX-destinated signal. Plus the cleanup SQL.

verification: (not applicable — diagnose-only)
files_changed: []
