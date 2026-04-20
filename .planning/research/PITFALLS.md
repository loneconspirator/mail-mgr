# Domain Pitfalls: Action Folders for Mail Manager v0.6

**Domain:** Adding action folder / mail-client-driven rule management to an existing IMAP email management system
**Researched:** 2026-04-20

## Critical Pitfalls

Mistakes that cause data loss, duplicate rules, or broken monitoring.

### Pitfall 1: MoveTracker Interprets Action Folder Moves as User-Initiated Moves

**What goes wrong:** The MoveTracker polls INBOX and Review for disappeared UIDs, cross-references the activity log to exclude system moves, and logs signals for anything it considers user-initiated. When the action folder processor moves a message from an action folder to its destination (e.g., Trash, default archive, INBOX), MoveTracker could see the message appear in those folders and, on subsequent scans, track it. Worse: if a user drags a message from INBOX to `Actions/Block Sender`, MoveTracker sees a disappearance from INBOX. It won't find a system move in the activity log (the action folder hasn't processed yet), so it logs a false move signal. The PatternDetector then proposes rules based on garbage data.

**Why it happens:** MoveTracker's `isSystemMove()` checks for source values `arrival`, `sweep`, `batch`. The new `action-folder` source doesn't exist yet. Even after adding it, there's a timing window: the user moves a message to an action folder, MoveTracker scans before the action folder processor runs, and sees a disappeared message with no system move logged.

**Consequences:** False move signals pollute the signal store. PatternDetector proposes bogus rules. Users see phantom proposed rules they didn't cause.

**Prevention:**
1. Add `'action-folder'` to the `isSystemMove()` source list in `ActivityLog` immediately.
2. Log action folder activity BEFORE moving the message to its destination, so MoveTracker's cross-reference catches it.
3. For the INBOX disappearance timing gap: action folder paths must be excluded from MoveTracker's destination resolution. If a message disappears from INBOX and lands in `Actions/*`, that's not a user move to track — it's an action folder operation in progress.
4. Consider adding action folder paths to a "known system folders" exclusion list in MoveTracker.

**Detection:** Spurious proposed rules appearing after action folder usage. Move signals with `destinationFolder` pointing to action folder paths.

**Phase:** Must be addressed in the first implementation phase, before any action folder processing code runs alongside MoveTracker.

---

### Pitfall 2: Crash Between Rule Creation and Message Move (Split-Brain State)

**What goes wrong:** The action folder processor creates a rule (persisted to config YAML via `ConfigRepository.addRule()`), then attempts to move the message to its destination. If the process crashes, the IMAP connection drops, or the move fails, the rule exists but the message is still sitting in the action folder. On restart, the system re-processes the action folder and finds the message again. Without proper duplicate detection, it creates a second identical rule.

**Why it happens:** Rule creation (sync write to YAML) and IMAP message move (async network operation) are not atomic. They cannot be made atomic — they span different systems (filesystem vs. IMAP server).

**Consequences:** Duplicate rules in the rule list. The `first-match-wins` evaluator means the duplicate is harmless for routing, but it clutters the UI and confuses the user. The disposition views show duplicate entries.

**Prevention:**
1. Order of operations: create/find rule FIRST, move message SECOND. This is the PRD's prescribed order (AF-07).
2. Before creating any rule, query existing rules for a sender-only rule with the same sender glob AND same action type. The `isSenderOnly()` predicate from `dispositions.ts` plus an action type filter gives this check.
3. Log the activity entry after rule creation but before the move attempt. This way, even if the move fails, the activity log records what happened.
4. On startup recovery: scan action folders, check for existing matching rules, skip creation if found, then move the message.

**Detection:** Duplicate sender entries in disposition views. Two rules with identical `match.sender` and `action.type`.

**Phase:** Core processing logic phase — this is the heart of idempotent processing (AF-07).

---

### Pitfall 3: IMAP Folder Creation Fails Silently or Creates Wrong Hierarchy

**What goes wrong:** `mailboxCreate('Actions/VIP Sender')` behaves differently depending on the server's hierarchy separator. On a server using `.` as separator, this might create a literal folder named `Actions/VIP Sender` instead of a nested `Actions` > `VIP Sender` hierarchy. Or the server might reject the creation because `/` is not the separator character. Or it creates the folders but the mail client displays them unexpectedly.

**Why it happens:** IMAP hierarchy separators are server-specific (`.` on Cyrus/Dovecot-dot-mode, `/` on most others). ImapFlow's `mailboxCreate` accepts either a string path or an array of path components. When given a string with `/`, ImapFlow handles separator translation — but this behavior must be verified. When given an array like `['Actions', 'VIP Sender']`, ImapFlow explicitly builds the hierarchy using the server's actual separator.

**Consequences:** Action folders don't exist where expected. The monitor can't find them. Messages moved by the user go to non-existent or wrong folders. The mail client shows mangled folder names.

**Prevention:**
1. Use `mailboxCreate(['Actions', 'VIP Sender'])` (array form) instead of string form. This lets ImapFlow handle separator translation correctly.
2. After creation, verify the folders exist by listing mailboxes and checking paths.
3. Discover the server's hierarchy separator from the folder tree (already available via `listFolders()` — the `delimiter` field on `FolderNode`) and use it when constructing paths for monitoring.
4. Store the actual created paths (as returned by the server) rather than assuming the configured names map 1:1 to IMAP paths.
5. Test with Fastmail (the primary test server) but document the separator assumption.

**Detection:** Startup logs showing folder creation errors. Action folders not appearing in the mail client. `listFolders()` not returning expected paths.

**Phase:** Folder creation/lifecycle phase — must be the first phase since everything else depends on folders existing.

---

### Pitfall 4: IDLE Only Monitors One Folder — Action Folders Go Unnoticed

**What goes wrong:** IMAP IDLE (RFC 2177) only works on the currently selected mailbox. The existing `ImapClient` opens INBOX and IDLEs on it. When a user moves a message to `Actions/VIP Sender`, no IDLE notification fires because IDLE is watching INBOX, not the action folder. The action folder message sits unprocessed until... something else triggers a check.

**Why it happens:** This is a fundamental IMAP protocol limitation. One connection = one IDLE = one folder. The NOTIFY extension (RFC 5465) could monitor multiple folders on one connection, but support is sparse and the PRD explicitly puts it out of scope.

**Consequences:** Poor responsiveness. The user moves a message to an action folder expecting near-instant feedback (the PRD calls this out: "the user expects near-immediate feedback"). Instead, nothing happens until a poll cycle runs.

**Prevention:**
1. Poll-based monitoring for action folders on a short interval (e.g., 5-10 seconds). This is separate from MoveTracker's 30-second scan cycle.
2. Do NOT try to open a second IMAP connection for IDLE on action folders — this doubles connection count and most servers limit concurrent connections (Fastmail allows 10-20).
3. Piggyback action folder checks onto existing poll/IDLE cycles: when the IDLE timer fires NOOP to cycle IDLE (every `idleTimeout` ms, default 5 min), also check action folders. But 5 minutes is too slow — so add a dedicated shorter-interval poller.
4. The dedicated poller should use `withMailboxLock` (not `withMailboxSwitch`) to avoid disrupting the INBOX IDLE. Actually — `withMailboxLock` also switches the selected mailbox. This needs careful design.

**Detection:** Messages sitting in action folders for minutes instead of seconds. User complaints about lag.

**Phase:** Monitoring integration phase. This is an architectural decision that shapes the entire action folder processing pipeline.

---

### Pitfall 5: withMailboxLock/withMailboxSwitch Disrupts INBOX IDLE

**What goes wrong:** The current `ImapClient` has two methods for operating on non-INBOX folders: `withMailboxLock(folder, fn)` and `withMailboxSwitch(folder, fn)`. Both acquire a lock on the target folder, which means the IMAP connection switches away from INBOX. While the lock is held, IDLE on INBOX is suspended. If the action folder poller frequently checks 4 action folders, it repeatedly disrupts INBOX monitoring, creating windows where new INBOX arrivals go unnoticed.

**Why it happens:** Single IMAP connection architecture. `withMailboxSwitch` stops IDLE, switches mailbox, does work, switches back, restarts IDLE. `withMailboxLock` is similar but doesn't explicitly restart IDLE. Each action folder check requires a mailbox switch.

**Consequences:** Missed or delayed INBOX arrival processing. The more action folders checked and the more frequently they're polled, the longer IDLE gaps become. At 4 folders checked every 5 seconds, that's potentially 4 mailbox switches every 5 seconds, each breaking IDLE for the duration of the fetch.

**Prevention:**
1. Batch all action folder checks into a single mailbox-switch session. Don't switch 4 times — switch once per folder but sequentially within one "action folder scan" window, then return to INBOX.
2. Use a `status()` call (IMAP STATUS command) to check message count without switching mailboxes. STATUS can query a folder's message count without selecting it, preserving the current IDLE. Only switch to the action folder if STATUS shows messages > 0.
3. Keep the action folder poll interval reasonable (10-15 seconds, not sub-second). The user can tolerate a 10-second delay.
4. After the action folder scan completes, explicitly reopen INBOX and restart IDLE/polling.

**Detection:** Monitor logs showing gaps in INBOX processing. `newMail` events not firing during action folder scans.

**Phase:** Monitoring integration phase — must be designed together with the polling architecture.

---

## Moderate Pitfalls

### Pitfall 6: Action Folder Processing Races with Arrival Routing

**What goes wrong:** A message arrives in INBOX. The Monitor evaluates rules and decides to move it to Review. Simultaneously, the user manually moves the same message from INBOX to `Actions/VIP Sender`. The Monitor's move and the user's move race — whoever wins, the loser gets an IMAP error (message not found at expected UID). If the Monitor wins, the message lands in Review and the action folder processor never sees it. If the user wins, the Monitor fails to move it (UID gone from INBOX) but the action folder processor creates the VIP rule.

**Why it happens:** The user can interact with their mailbox at any time. There's no lock between the user's mail client and the monitor's processing loop.

**Prevention:**
1. The Monitor already handles per-message errors gracefully (try/catch around each message in `processNewMessages`). A failed move for a disappeared message should log and continue, not crash the loop. Verify this works.
2. The action folder processor should handle the case where a message it's trying to process has already been moved by the Monitor — if the action folder is empty when it gets there, that's fine.
3. Accept that this is a rare edge case. The timing window is small (seconds). The correct behavior is: whoever processes first wins, the other gracefully handles the miss.

**Phase:** Core processing logic — ensure error handling is robust.

### Pitfall 7: Config YAML Write Conflicts Under Concurrent Operations

**What goes wrong:** The action folder processor calls `configRepo.addRule()` to create a rule. At the same time, the user creates a rule via the web UI, which also calls `configRepo.addRule()`. Both read the current config, both append a rule, and the second write clobbers the first — one rule is lost.

**Why it happens:** `ConfigRepository` reads from and writes to a YAML file. It holds an in-memory copy (`this.config`) that it mutates and then persists. Node.js is single-threaded, so truly simultaneous writes can't happen — but if the action folder processor yields (await) between reading and writing, a web UI request could interleave.

**Consequences:** Lost rules. The user creates a rule via the UI but it vanishes because the action folder processor's write overwrites it.

**Prevention:**
1. Verify that `ConfigRepository.addRule()` is synchronous after the initial read — looking at the code, `addRule` is synchronous: it pushes to the array and calls `persist()` (which calls `saveConfig`, a sync write). So interleaving within `addRule` is not possible.
2. The real risk is if action folder processing happens inside an async context that yields between reading config state and calling `addRule()`. Keep the "check for duplicate" and "add rule" steps as close together as possible, with no awaits between them.
3. The `configRepo` is a singleton — all mutations go through the same in-memory object. This is actually safe in Node.js's single-threaded model as long as there are no awaits between the read-check and the write.

**Phase:** Core processing logic — verify during implementation that no async gaps exist in the check-then-create flow.

### Pitfall 8: Undo Operations Delete the Wrong Rule

**What goes wrong:** The user has two rules for `alice@example.com`: one `skip` (VIP) rule created via the UI with additional match criteria (e.g., subject filter), and one `skip` rule created as a pure sender-only rule. The user moves a message from Alice to `Actions/Undo VIP`. The action folder processor searches for a sender-only `skip` rule matching `alice@example.com` and deletes... which one? If it deletes the UI-created rule (which isn't sender-only), the user loses a carefully crafted rule. If it correctly filters to sender-only rules, it deletes the right one. But what if there are TWO sender-only skip rules for the same sender (shouldn't happen, but could via config editing)?

**Why it happens:** The undo operation needs to find "the" matching rule, but there might be zero, one, or multiple candidates.

**Prevention:**
1. Undo operations MUST filter using `isSenderOnly()` — never delete a rule that has additional match criteria beyond sender.
2. If multiple sender-only rules match, delete the LAST one created (highest order value) — this is most likely the one the user wants to undo.
3. Log which rule was deleted (rule ID, rule name) in the activity entry for auditability.
4. If no matching rule is found, still move the message to its destination (PRD AF-01 specifies this: "This is not an error").

**Phase:** Core processing logic — rule lookup and deletion.

### Pitfall 9: Action Folder Messages Without Valid From Headers

**What goes wrong:** A message in an action folder has a malformed, missing, or multi-address From header. The processor extracts `undefined` or an empty string as the sender, then creates a rule with `match.sender: ""` or `match.sender: undefined`. This rule either fails Zod validation (good) or passes and matches everything (catastrophic — every email gets blocked/VIP'd).

**Why it happens:** Email From headers are notoriously messy. Bounces have `<>` as From. Some spam has no From. Some messages have multiple From addresses (rare but RFC-legal).

**Consequences:** A rule with an empty or wildcard sender glob could match ALL incoming email and route everything to Trash (if it was a Block operation) or mark everything as VIP.

**Prevention:**
1. Extract and validate the sender address BEFORE any rule creation. If empty, null, or not a valid email pattern, abort processing for that message.
2. Move the problematic message to INBOX (not Trash, not lost) with an error log entry. The PRD specifies this (AF-03).
3. Test with edge cases: `<>`, no From header, multiple From addresses, display-name-only (no address part), internationalized addresses.
4. The Zod schema's `z.string().min(1)` on `emailMatchSchema.sender` provides a safety net, but don't rely on it — validate before reaching the schema.

**Phase:** Sender extraction utility — early phase.

### Pitfall 10: Folder Cache Serves Stale Data After Action Folder Creation

**What goes wrong:** The `FolderCache` caches the folder tree with a 5-minute TTL. On startup, the system creates action folders, but the folder cache was populated before creation. Any component querying the folder cache (folder picker, batch engine folder validation) doesn't see the action folders. The tree picker in the UI shows stale data.

**Why it happens:** `FolderCache` has a time-based TTL and no invalidation hook for folder creation events.

**Prevention:**
1. Invalidate the folder cache after action folder creation on startup.
2. Add a `FolderCache.invalidate()` method if one doesn't exist.
3. This is a minor UX issue — the action folders shouldn't appear in the tree picker anyway (they're system infrastructure, not filing destinations). But the folder list API should reflect them for debugging/status purposes.

**Phase:** Folder creation/lifecycle phase.

## Minor Pitfalls

### Pitfall 11: Action Folder Names with Special Characters Cause IMAP Encoding Issues

**What goes wrong:** Folder names like "VIP Sender" contain spaces. Some IMAP servers or clients may encode these differently (modified UTF-7 per RFC 3501). If the configured folder name and the IMAP-encoded name don't match, the system creates the folder but can't find it when monitoring.

**Prevention:**
1. Use ImapFlow's path handling throughout — it handles modified UTF-7 encoding automatically.
2. Don't string-compare folder paths directly. Use the paths as returned by `listMailboxes()` after creation.
3. Avoid special characters in default folder names. "VIP Sender" with a space is fine for ImapFlow but test it.

**Phase:** Folder creation phase — verify with Fastmail.

### Pitfall 12: Action Folder Config Changes Require Folder Rename/Recreation

**What goes wrong:** The user changes `actionFolders.prefix` from "Actions" to "MailMgr" in config. The old `Actions/*` folders still exist on the IMAP server with messages in them. The new `MailMgr/*` folders get created on restart. Now there are two sets of action folders. Messages in the old folders are orphaned.

**Prevention:**
1. On config change, check old folders for remaining messages and process them before switching.
2. Or: don't support renaming in v0.6. Document that changing action folder names requires manual cleanup.
3. Log a warning on startup if the old folder paths exist and contain messages.

**Phase:** Configuration phase — document the limitation, don't over-engineer rename support for v0.6.

### Pitfall 13: Rule Order Collisions When Multiple Messages Processed Simultaneously

**What goes wrong:** Two messages arrive in action folders at the same time. Both call `configRepo.nextOrder()` to get the next order value. Both get the same value. Both create rules with the same `order`. First-match-wins evaluation becomes unpredictable for these two rules.

**Prevention:**
1. Node.js is single-threaded — if messages are processed sequentially (which they should be, like the Monitor's serial loop), this can't happen.
2. Ensure the action folder processor processes messages one at a time, not in parallel.
3. Even if order collisions occur, sender-only rules for different senders won't conflict. Same order is cosmetically ugly but not functionally broken.

**Phase:** Core processing logic — ensure sequential processing.

### Pitfall 14: Notification Fatigue from `onRulesChange` Callbacks

**What goes wrong:** Processing 10 action folder messages triggers 10 `addRule()` calls, each firing `notifyRulesChange()`, which calls `monitor.updateRules()`, `sweeper.updateRules()`, and `batchEngine.updateRules()`. This is 10 redundant rule reloads, potentially causing the Monitor to re-evaluate in-progress messages with a slightly different rule set each time.

**Prevention:**
1. Batch action folder processing: collect all rule changes, make them, then the final `persist()` triggers one notification.
2. Or accept the overhead — `updateRules()` just replaces the rule array reference. It's cheap. The Monitor's in-progress message already captured its matched rule before the update.
3. Don't over-optimize in v0.6. If it becomes a problem with many simultaneous action folder messages, add batching later.

**Phase:** Not critical for any specific phase — monitor during testing.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Folder creation/lifecycle | P3 (hierarchy separators), P10 (stale cache), P11 (encoding) | Use array-form `mailboxCreate`, invalidate cache after creation, verify paths from server |
| Monitoring integration | P4 (IDLE single-folder), P5 (mailbox switch disrupts IDLE) | STATUS pre-check before switching, batched folder scans, dedicated short-interval poller |
| Core processing logic | P2 (crash idempotency), P6 (arrival race), P7 (config write conflicts), P8 (wrong rule deletion), P13 (order collisions) | Check-before-create, sequential processing, `isSenderOnly()` filter for undo |
| MoveTracker integration | P1 (false move signals) | Add `action-folder` to system sources, exclude action folder paths from tracking |
| Sender extraction | P9 (malformed From headers) | Validate before rule creation, fallback to INBOX move |
| Configuration | P12 (folder rename orphans) | Don't support rename in v0.6, document limitation |
| Activity logging | P4 (source type) | Add `'action-folder'` source to type union, update `isSystemMove()` |

## Historical Context: The v0.4 Phase 7 Clobber Incident

This project has a history of worktree merges destroying existing features. The MEMORY.md warns: "verify worktree branch point before merge, check for deletions after." For v0.6:

- Action folder code touches the Monitor, ImapClient, ConfigRepository, ActivityLog, and config schema — all core modules.
- Each phase should verify that existing functionality (INBOX monitoring, Review sweeps, MoveTracker, batch filing, disposition views) still works after changes.
- Integration tests that exercise the full pipeline (arrival -> rule evaluation -> move -> activity log -> MoveTracker scan) should run after each phase.
- Do NOT use worktrees for parallel development of action folder phases.

## Sources

- ImapFlow documentation: https://imapflow.com/module-imapflow-ImapFlow.html
- IMAP IDLE limitations (RFC 2177): https://en.wikipedia.org/wiki/IMAP_IDLE
- IMAP hierarchy separator issues: https://www.chilkatsoft.com/p/p_262.asp
- IMAP NOTIFY extension (RFC 5465): https://mailarchive.ietf.org/arch/msg/imapext/Qn4f3QrmijuwLsjxB4dFIM2TpL8/
- Mozilla Bugzilla IMAP hierarchy delimiter: https://bugzilla.mozilla.org/show_bug.cgi?id=773579
- Codebase analysis: `src/monitor/index.ts`, `src/tracking/index.ts`, `src/imap/client.ts`, `src/config/repository.ts`, `src/actions/index.ts`, `src/log/index.ts`, `src/web/routes/dispositions.ts`, `src/config/schema.ts`
