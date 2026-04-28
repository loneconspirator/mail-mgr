---
id: UC-004
title: User retroactively files an existing folder via dry-run preview and bulk execute
acceptance-test: test/acceptance/uc_004_batch_retroactive_filing_of_existing_folder.test.ts
starting-states: []
integrations: [IX-002, IX-009, IX-010]
---

## Actors

- **User** — the mailbox owner, interacting with the mail-mgr web UI to apply current rules to messages already in a folder.
- **Mail-mgr** — the background system (WebServer, BatchEngine, RuleEvaluator, ActionExecutor, ImapClient, ActivityLog).
- **Mail server** — the upstream IMAP server.

## Preconditions

- Mail-mgr is running and connected to the IMAP server.
- The user has a folder of accumulated messages — for example, INBOX with 130 messages — that pre-date the current rule set.
- At least one rule exists that matches some of those messages. For this scenario:
    - Rule A: `match: { sender: "*@notify.example.com" }`, `action: { type: "move", folder: "Notifications" }`.
    - Rule B: `match: { sender: "boss@company.com" }`, `action: { type: "skip" }`.
- The trash folder, review folder, and review config are configured (used for `delete`/`review` actions during execute).
- BatchEngine is in `idle` state (no other batch run in progress).

## Main Flow

### Phase 1: User initiates dry-run from web UI

1. The user opens the web UI, picks INBOX as the source folder, and clicks "Preview".
2. The browser sends `POST /api/batch/dry-run` with `{ sourceFolder: "INBOX" }`.
3. WebServer validates the body and calls `BatchEngine.dryRun("INBOX")` (IX-009).
4. BatchEngine guards against concurrent runs (`running` flag), sets `state.status = 'dry-running'`, and fetches all messages from INBOX via ImapClient.
5. For each non-sentinel message, BatchEngine evaluates the current rule set. INBOX uses the inbox processing mode: matched messages produce a destination from the rule's action; unmatched messages produce a `no-match` group.
6. Results are grouped by `{action, destination}`. Each group lists count and example messages (uid, from, subject, date, ruleName).
7. BatchEngine sets `state.status = 'previewing'`, stores the groups in `state.dryRunResults`, and returns them in the HTTP response.

### Phase 2: User reviews the preview and approves execution

8. The web UI renders the dry-run groups, e.g.:
    - "Move to Notifications (Rule A)" — 47 messages
    - "Skip (Rule B)" — 3 messages
    - "No match" — 80 messages
9. The user reviews and clicks "Execute".
10. The browser sends `POST /api/batch/execute` with `{ sourceFolder: "INBOX" }`.
11. WebServer validates the body, calls `BatchEngine.execute("INBOX")` *without awaiting* (fire-and-forget; the route immediately returns `{ status: "started" }`), and BatchEngine begins the run (IX-010).

### Phase 3: BatchEngine executes in chunks

12. BatchEngine resets state to `executing`, fetches all messages again, and iterates the message list in chunks of 25.
13. Between chunks BatchEngine yields with `setImmediate` so the event loop can service status polls and cancel requests.
14. For each non-sentinel message in inbox mode:
    - RuleEvaluator returns the matched rule (or null).
    - On match, ActionExecutor performs the action (move / move-to-review / skip / move-to-trash for delete) per IX-002.
    - On no match, the message is counted as `skipped` and left in INBOX.
    - ActivityLog records the result with source `batch`, including the rule, destination, and success/error status.
15. Counters update: `processed`, `moved`, `skipped`, `errors`.

### Phase 4: User polls progress and the run completes

16. While Phase 3 runs, the web UI polls `GET /api/batch/status`. Each response returns the live `BatchState` (status, processed/total, moved, skipped, errors).
17. After the last chunk, BatchEngine sets `state.status = 'completed'`, records `state.completedAt`, and returns a `BatchResult` from `execute()` (consumed by the fire-and-forget catch block; the user observes completion via the next status poll).
18. The UI shows the final counts: 47 moved, 3 skipped (rule), 80 skipped (no match), 0 errors.

## Expected Outcome

- 47 INBOX messages have been moved to "Notifications".
- 3 messages from `boss@company.com` remain in INBOX (skip rule honored).
- 80 unmatched messages remain in INBOX.
- ActivityLog contains 47 success entries with `source: batch` and the Rule A reference. Skipped messages are also logged with `action: skip`.
- `BatchEngine.getState()` returns `status: 'completed'`, `processed: 130`, `moved: 47`, `skipped: 83`, `errors: 0`.
- `BatchEngine` is idle and ready for another run.

## Variants

### UC-004.a: Cancel mid-execute

After Phase 3 step 13 completes the second chunk (50 messages processed), the user clicks "Cancel". The browser sends `POST /api/batch/cancel`, which calls `BatchEngine.cancel()` to set `cancelRequested = true`. The current chunk completes; before the next chunk starts, BatchEngine observes the flag, sets `state.status = 'cancelled'` and `state.cancelled = true`, breaks the loop, and finalizes. The final state reports the partial counts (e.g., `processed: 50`, `moved: 18`, `skipped: 32`); the remaining 80 messages stay in INBOX untouched.

### UC-004.b: Concurrent dry-run is rejected

The user clicks "Preview" twice in quick succession. The first request enters `dry-running`; the second arrives while `running === true`. BatchEngine throws `"Batch already running"`. WebServer maps this to HTTP 409 Conflict. The UI surfaces the conflict and the first run continues.

### UC-004.c: Source folder is the Review folder

The user picks the Review folder as the source. BatchEngine detects review mode (`sourceFolder === reviewFolder`) and uses sweep semantics instead of arrival semantics: each message is checked against `isEligibleForSweep`, ineligible messages are counted as `skipped` (with destination "Not yet eligible" in dry-run), and eligible messages flow through `processSweepMessage` (re-evaluation against the sweep-filtered rule set, defaulting to `defaultArchiveFolder`). Activity entries are logged with `source: batch` (not `sweep`).

### UC-004.d: Source folder is neither INBOX nor Review

The user picks an arbitrary folder (e.g., a personal "Triage" folder). BatchEngine uses generic mode: rules evaluate normally, but `review` actions without a folder are reported as "Skip" (no fallback to the configured Review folder), and `executeAction` is not invoked — the engine performs the move directly via `ImapClient.moveMessage`. This mode exists to apply rules retroactively to folders that aren't part of the live arrival pipeline.

### UC-004.e: Per-message error during execute does not abort the run

During Phase 3, one message fails to move (e.g., the destination folder was deleted server-side after dry-run). BatchEngine catches the error, increments `state.errors`, logs the failure to ActivityLog with `success: false` and the error string, and continues with the next message. The run completes normally; the final state reports `errors > 0` and the user can inspect the activity log to identify the failed UIDs.

### UC-004.f: Sentinel messages are skipped silently

Any message in the source folder that bears the `X-Mail-Mgr-Sentinel` header is skipped at the top of both the dry-run and execute loops. It is not counted in any group, not logged to activity, and not included in the totals — sentinels are invisible to the user.

### UC-004.g: Rule changes between dry-run and execute

The user runs dry-run, then edits a rule (UC-005) before clicking Execute. The execute pass fetches messages and re-evaluates against the *current* rule set, not the snapshot the dry-run preview reflected. The reported counts may differ from the preview. This is intentional: the engine treats rules as live state, not as part of the batch transaction.
