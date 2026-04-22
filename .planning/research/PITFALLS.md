# Pitfalls Research: IMAP Sentinel Message System

**Domain:** Adding sentinel/beacon messages to an existing IMAP mail management system
**Researched:** 2026-04-21
**Confidence:** HIGH (IMAP protocol behavior well-documented; integration risks identified from codebase analysis)

## Critical Pitfalls

### Pitfall 1: Action Folder Processor Picks Up Sentinel Messages

**What goes wrong:**
The action folder poller uses `fetchAllMessages(path)` then processes every message through `ActionFolderProcessor.processMessage()`. If a sentinel is planted in an action folder (e.g., `Actions/VIP Sender`), the processor extracts the sender, creates a rule for the sentinel's From address, and moves the sentinel to INBOX or Trash. The sentinel is destroyed and a garbage rule is created.

**Why it happens:**
The action folder processor has no concept of "skip this message" -- it processes every message in the folder. The always-empty invariant (FOLD-02) means it actively tries to drain every message. Sentinel messages planted for folder tracking look like regular messages to the processor.

**How to avoid:**
Sentinel messages MUST use a recognizable marker that the action folder processor checks before processing. Two options:
1. Use a custom header (e.g., `X-Mail-Mgr-Sentinel: true`) and add a guard at the top of `ActionFolderProcessor.processMessage()` that skips messages with this header. Requires fetching headers during action folder poll, which currently only fetches envelope data.
2. Use a specific \Flagged or custom keyword flag. Simpler check but custom keywords may not survive all IMAP servers.

Option 1 (custom header check) is safer because headers are immutable after message creation. The sentinel scan already needs to fetch headers to find sentinels, so the fetch infrastructure exists.

**Warning signs:**
- Rules appearing for addresses like `sentinel@mail-mgr.local` or whatever the sentinel From address is
- Sentinel messages disappearing from action folders shortly after planting
- Action folder activity log showing sentinel processing

**Phase to address:**
Phase 1 (Sentinel Core) must define the sentinel format including the skip-guard header. Phase 2 (Integration) must wire the guard into the action folder processor.

---

### Pitfall 2: Monitor Rule Engine Routes Sentinel Messages

**What goes wrong:**
When a sentinel is planted in INBOX (to track INBOX itself or during initial creation before moving), the Monitor's `processNewMessages()` picks it up, evaluates it against rules, and potentially moves it to a different folder. If the sentinel's subject or From address matches a rule pattern (e.g., a wildcard rule), the sentinel gets routed away from its intended folder.

**Why it happens:**
The Monitor processes ALL new messages in INBOX via UID-based tracking (`fetchNewMessages(sinceUid)`). There's no exclusion mechanism. Any message that arrives in INBOX -- including ones the app itself planted -- gets rule evaluation.

**How to avoid:**
Add a sentinel check in `Monitor.processMessage()` before rule evaluation. Check for the sentinel header and skip processing. This is the same guard pattern as the action folder fix but applied in the monitor pipeline. The monitor already fetches envelope + headers, so adding a header check is low-cost.

Alternative: Plant sentinels directly in their target folders (never in INBOX) using ImapFlow's APPEND command. This avoids the monitor entirely for non-INBOX folders. For INBOX sentinel specifically, the guard is still needed.

**Warning signs:**
- Sentinel messages appearing in unexpected folders
- Activity log showing sentinel messages being processed by rules
- INBOX sentinel going missing

**Phase to address:**
Phase 1 (Sentinel Core) -- APPEND directly to target folder avoids most of this. Phase 2 (Integration) -- add guard for INBOX sentinel case.

---

### Pitfall 3: UIDVALIDITY Changes Invalidate Stored Sentinel UIDs

**What goes wrong:**
If you store the sentinel's UID to quickly locate it later (for deletion/re-planting), a UIDVALIDITY change makes that UID meaningless. The sentinel appears "missing" even though it still exists in the folder. The system then re-plants a duplicate sentinel, creating ghost sentinels that accumulate over time.

**Why it happens:**
UIDVALIDITY changes when a folder is deleted and recreated with the same name, when the server is migrated, or on some misconfigured servers randomly. Per RFC 3501, when UIDVALIDITY changes, all previously stored UIDs are invalid.

**How to avoid:**
Do NOT rely on UIDs for sentinel identification. Use Message-ID header search exclusively. The sentinel's Message-ID is the stable identifier across UIDVALIDITY changes. The scan procedure should be: open folder, SEARCH for header `Message-ID` matching the stored value. If found, sentinel is present. If not found, sentinel is missing.

Store only the Message-ID in the sentinel registry, never the UID. UIDs can be used as a short-lived optimization within a single session but must never be persisted.

**Warning signs:**
- Multiple sentinel messages accumulating in the same folder
- Sentinel scan reporting "missing" sentinels that are actually present
- Log messages about UIDVALIDITY changes

**Phase to address:**
Phase 1 (Sentinel Core) -- design the storage schema around Message-ID only, not UID.

---

### Pitfall 4: SEARCH by Header Not Supported on All Servers

**What goes wrong:**
The sentinel scan relies on `SEARCH HEADER Message-ID <value>` to locate sentinels. Some IMAP servers (notably older Dovecot configurations) have header search disabled or return zero results even when the header exists. The sentinel system silently fails -- it thinks all sentinels are missing and re-plants duplicates everywhere.

**Why it happens:**
IMAP SEARCH by header is part of the base RFC 3501 spec, but server implementations vary. Some servers disable header indexing for performance. The ImapFlow maintainer explicitly notes: "IMAP search is heavily dependent on what the server actually supports."

**How to avoid:**
1. On first startup, run a self-test: plant a test sentinel, then immediately SEARCH for it. If SEARCH fails, log a clear error and refuse to start the sentinel system.
2. Use a distinctive, searchable Subject line as a fallback. SEARCH by Subject is more universally supported than SEARCH by arbitrary header.
3. For Fastmail specifically (the primary target), header SEARCH works reliably. But the self-test ensures we detect problems on other servers immediately rather than silently corrupting state.

**Warning signs:**
- Sentinel scan always reports zero sentinels found
- Duplicate sentinels accumulating in folders
- SEARCH commands returning empty results in IMAP debug logs

**Phase to address:**
Phase 1 (Sentinel Core) -- implement self-test during sentinel system initialization.

---

### Pitfall 5: Sentinel Scan Across Many Folders Creates Excessive IMAP Traffic

**What goes wrong:**
Each folder scan requires: SELECT folder, SEARCH for header, then SELECT next folder. For a mailbox with 50+ folders, each poll cycle generates 100+ IMAP commands. This is slow (each SELECT has network latency), may trigger rate limits, and disrupts the INBOX idle/poll loop because the existing `withMailboxSwitch` stops idle, switches folders, then restores INBOX.

**Why it happens:**
IMAP requires a folder to be SELECTed before any SEARCH can run. There's no cross-folder search in standard IMAP. The existing `ImapClient.withMailboxSwitch()` method stops idle monitoring during the switch, creating a window where new INBOX messages are missed.

**How to avoid:**
1. Scan folders in batches with configurable interval (e.g., scan 5 folders per cycle, full scan every 5 minutes rather than every poll cycle).
2. Only scan folders that have sentinels registered -- don't scan ALL folders, just the ones the app cares about. The sentinel registry knows exactly which folders have sentinels.
3. Run the full scan less frequently than the main poll interval (e.g., every 5-10 minutes instead of every 15-60 seconds).
4. Use a dedicated IMAP connection for sentinel scanning so the primary connection's IDLE isn't disrupted. The Fastmail 500-logins-per-10-minutes limit is generous enough for a second connection.

**Warning signs:**
- Increased latency in INBOX message processing during sentinel scans
- IMAP connection timeouts during large scans
- Rate limit errors from the server
- Gaps in new message detection (missed during folder switches)

**Phase to address:**
Phase 3 (Rename Detection) -- this is where periodic scanning is implemented. Design the scan scheduler in Phase 1 but implement the throttled scanning in Phase 3.

---

### Pitfall 6: Race Condition Between Sentinel Scan and User Folder Operations

**What goes wrong:**
User renames folder A to B in their mail client. The sentinel scan starts, SELECTs folder A (which no longer exists), gets an error, concludes the sentinel is lost. Before the next scan discovers the sentinel in folder B, the system fires a "folder missing" notification or tries to update config references. Meanwhile, the sentinel is perfectly fine in its renamed folder.

**Why it happens:**
Folder renames are atomic from the IMAP server's perspective but the sentinel scan takes time to traverse all folders. Between detecting "folder A missing" and "sentinel found in folder B," there's a window where the system has incorrect state.

**How to avoid:**
Implement a two-phase detection pattern:
1. Phase 1: Detect "sentinel missing from expected folder" -- mark as PENDING, do NOT act.
2. Phase 2: Scan remaining folders looking for the sentinel. If found elsewhere, it's a rename. If not found anywhere, it's a deletion.
3. Only after completing the full scan, act on the results.

Never fire "folder missing" notifications based on a single folder check. Always complete the full scan first.

**Warning signs:**
- Spurious "folder missing" notifications followed by immediate "folder found" corrections
- Config references flickering between old and new folder paths
- Activity log showing rapid remove/restore cycles

**Phase to address:**
Phase 3 (Rename Detection) -- the two-phase detection pattern must be the core design of the rename detection algorithm.

---

### Pitfall 7: Sentinel Messages Visible to Users in Mail Clients

**What goes wrong:**
Sentinels appear as regular messages in the user's mail client (Mac Mail, Thunderbird, etc.). They show up in unread counts, search results, and folder message lists. Users see confusing messages with subjects like "Mail Manager Sentinel" and wonder what they are. Worse, users might delete them, breaking folder tracking.

**Why it happens:**
IMAP has no concept of "hidden" messages. Every message in a folder is visible to all clients. There's no flag or attribute that hides messages from mail clients.

**How to avoid:**
Minimize visibility impact:
1. Mark sentinels as \Seen immediately on creation so they don't inflate unread counts.
2. Use a clear, non-alarming Subject (e.g., "Mail Manager - Folder Tracker (do not delete)").
3. Keep the message body minimal with a brief explanation of what it is and why it shouldn't be deleted.
4. Use a Date header in the past (e.g., year 2000) so sentinels sort to the bottom of chronological folder views.
5. Consider using \Flagged to make them visually distinct but be aware this may draw MORE attention in some clients.

Accept that sentinels will be visible. Design for graceful re-planting when users inevitably delete them.

**Warning signs:**
- User reports of mysterious messages appearing in folders
- Sentinels contributing to unread badge counts
- Users deleting sentinels

**Phase to address:**
Phase 1 (Sentinel Core) -- message format design. Phase 4 (Failure Detection) -- re-planting when sentinels are deleted.

---

### Pitfall 8: Message-ID Collisions in Sentinel Generation

**What goes wrong:**
If the sentinel Message-ID generation uses a predictable or insufficiently unique scheme, two sentinels could share a Message-ID. The SEARCH then returns the wrong sentinel, and the system believes a folder has been renamed when it hasn't (or vice versa).

**Why it happens:**
Message-IDs are supposed to be globally unique per RFC 2822, but the uniqueness is only as good as the generation algorithm. If using a simple scheme like `<sentinel-{folderpath}@mail-mgr>`, renaming a folder and creating a new one with the old name would create a collision.

**How to avoid:**
Use UUID-based Message-IDs: `<sentinel-{uuid}@mail-mgr.local>`. The UUID is generated once when the sentinel is planted and stored in the registry. Never derive the Message-ID from the folder path or any mutable attribute.

**Warning signs:**
- SEARCH returning sentinels from wrong folders
- Rename detection reporting false positives
- Multiple folders mapping to the same sentinel Message-ID

**Phase to address:**
Phase 1 (Sentinel Core) -- Message-ID format definition.

---

### Pitfall 9: APPEND Command Fails Silently or Behaves Differently Across Servers

**What goes wrong:**
Planting a sentinel uses IMAP APPEND to inject a message directly into a folder. Some servers modify the message during APPEND (stripping headers, rewriting Message-ID, adding headers). If the Message-ID is modified, the sentinel becomes unfindable by SEARCH.

**Why it happens:**
IMAP servers may run spam filters, virus scanners, or content filters on APPENDed messages. Some servers normalize Message-ID format. RFC 3501 says the server SHOULD preserve the message but doesn't mandate it.

**How to avoid:**
1. After APPEND, immediately SEARCH for the sentinel to verify it was stored correctly.
2. If SEARCH fails, fetch the most recent message in the folder and check if the Message-ID was rewritten.
3. Store the actual Message-ID found on the server, not the one we intended to set.
4. Include the self-test (Pitfall 4) as the first operation -- if the self-test sentinel can't be found by its Message-ID after APPEND, the system knows it can't work on this server.

**Warning signs:**
- Sentinel planted successfully (APPEND returns OK) but SEARCH immediately fails
- Message-ID in fetched sentinel differs from what was APPENDed
- Extra headers added to sentinel messages

**Phase to address:**
Phase 1 (Sentinel Core) -- verify-after-plant pattern in the APPEND implementation.

---

### Pitfall 10: Config Reference Update Creates Inconsistent State

**What goes wrong:**
When a sentinel is found in a different folder (rename detected), the system updates folder references in config. But folder paths appear in multiple places: rule `action.folder` fields, `review.folder`, `review.defaultArchiveFolder`, `review.trashFolder`, action folder prefix, and action folder names. If the update misses one reference or crashes mid-update, the config has some references pointing to the old path and some to the new path.

**Why it happens:**
The existing codebase stores folder paths as strings in multiple config locations. There's no single "folder registry" -- each subsystem stores its own folder reference. The `ConfigRepository` persists to disk after each change, but if the process crashes between updating two references, the config file has partial updates.

**How to avoid:**
1. Build a `findAllFolderReferences(oldPath): Reference[]` function that scans ALL config locations for a folder path. This prevents missing a reference.
2. Apply all reference updates in a single `ConfigRepository` transaction -- update all references, then persist once.
3. Log every reference update for audit trail.
4. On startup, run a consistency check: for every folder referenced in config, verify a sentinel exists (or the folder is a well-known path like INBOX).

**Warning signs:**
- Rules still pointing to old folder path after rename detection
- Review config pointing to renamed folder while action folders updated correctly
- "Folder not found" errors for one subsystem but not others after a rename

**Phase to address:**
Phase 3 (Rename Detection) -- the reference update logic. Must enumerate ALL reference locations from the schema analysis.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store sentinel UID alongside Message-ID for fast lookup | Avoids SEARCH on every scan | UID invalidation on UIDVALIDITY change, stale UID bugs | Never -- Message-ID search is the only reliable method |
| Skip the APPEND verification step | Faster sentinel planting | Silent failures when server modifies Message-ID | Only during development/testing, never in production |
| Single IMAP connection for scanning + monitoring | Simpler connection management | IDLE disruption during scans, missed messages | Acceptable for MVP if scan interval is long enough (>5 min) |
| Scan all folders instead of only registered ones | Simpler scan logic, discovers sentinels in unexpected places | O(n) IMAP commands where n = total folders, slow on large mailboxes | Acceptable for initial implementation if user has <50 folders |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Action Folder Processor | Not checking for sentinel header before processing | Add sentinel header guard as first check in `processMessage()` |
| Monitor Rule Engine | Sentinel in INBOX gets evaluated against rules | Add sentinel header guard in `Monitor.processMessage()` before rule evaluation |
| Sweep System | Sentinel in Review folder gets swept/archived after age threshold | Sentinel check in sweep evaluation, or exclude sentinels from age-based sweeps |
| Batch Filing Engine | Batch apply includes sentinel messages in results | Filter sentinels from batch filing message lists |
| Move Tracking | Sentinel moves detected as user moves, triggering pattern proposals | Exclude sentinel moves from move tracking signal logging |
| Folder Discovery Cache | Sentinel scan triggers folder list refresh, invalidating cache timing | Coordinate cache invalidation between sentinel scan and folder discovery |
| Config File Writes | Multiple folder reference updates cause multiple file writes | Batch all reference updates into single persist() call |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-folder scan on every poll cycle | Slow INBOX response, missed messages during scan | Separate scan interval (5+ min), scan only registered folders | >20 registered folders, <30s poll interval |
| SEARCH on large folders | Scan takes 10+ seconds per folder | Use narrow SEARCH criteria (header + date range), avoid body search | Folders with >10,000 messages |
| Opening/closing folders rapidly | Server rate limits, connection drops | Batch folder operations, add small delay between SELECTs | >50 folders scanned in rapid succession |
| Re-planting sentinels too eagerly | Duplicate sentinels accumulate, SEARCH returns multiple results | Confirm sentinel truly missing (full scan complete), debounce re-plant with cooldown | Network glitches causing transient SEARCH failures |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sentinel subject is cryptic or alarming | User panics, deletes sentinel, reports bug | Clear subject: "Mail Manager - Folder Tracker (do not delete)" |
| Sentinel appears as unread | Inflates unread count in mail client | Plant with \Seen flag set |
| Sentinel sorts to top of folder | User sees it every time they open folder | Use old Date header so it sorts to bottom |
| No explanation in message body | User has no idea what the message is | Brief body: "This message helps Mail Manager track this folder. If deleted, it will be recreated automatically." |
| "Folder missing" notification for transient issues | False alarm notifications in INBOX | Two-phase detection with debounce before notifying |

## "Looks Done But Isn't" Checklist

- [ ] **Sentinel Planting:** Often missing the \Seen flag -- verify sentinels don't inflate unread counts
- [ ] **SEARCH Verification:** Often missing the post-APPEND verification -- verify sentinel is findable after planting
- [ ] **Guard Coverage:** Often missing one processing pipeline -- verify ALL pipelines (monitor, action folders, sweep, batch, move tracking) have sentinel guards
- [ ] **Reference Enumeration:** Often missing a config location -- verify ALL folder reference sites are covered (rules, review config, action folder config, sweep targets)
- [ ] **Self-Test:** Often missing server compatibility check -- verify sentinel system validates SEARCH works on startup
- [ ] **Race Protection:** Often missing the two-phase scan -- verify rename detection completes full scan before acting
- [ ] **Duplicate Prevention:** Often missing re-plant debounce -- verify transient failures don't create duplicate sentinels
- [ ] **INBOX Sentinel:** Often treated same as other folders -- verify INBOX sentinel has special handling for the monitor pipeline

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Sentinel processed as regular mail | LOW | Re-plant sentinel; delete garbage rule if created; add missing guard |
| Duplicate sentinels in folder | LOW | SEARCH returns multiple UIDs, delete all but first, update registry |
| Config references partially updated | MEDIUM | Run consistency check, manually fix remaining references, add atomic update |
| SEARCH not working on server | HIGH | Cannot use sentinel system on this server; fall back to manual folder management |
| UIDVALIDITY caused phantom missing sentinels | LOW | Full scan by Message-ID across all folders will find them; clean up duplicates |
| User deleted sentinel | LOW | Next scan detects missing, re-plants automatically; explain in INBOX notification |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Action folder processes sentinel | Phase 2 (Integration) | Test: plant sentinel in action folder, verify it's not processed |
| Monitor routes sentinel | Phase 2 (Integration) | Test: sentinel in INBOX is skipped by rule evaluation |
| UIDVALIDITY invalidates UIDs | Phase 1 (Sentinel Core) | Schema stores Message-ID only, no UID persistence |
| SEARCH not supported | Phase 1 (Sentinel Core) | Self-test on startup, clear error if SEARCH fails |
| Excessive IMAP traffic | Phase 3 (Rename Detection) | Scan only registered folders, configurable interval |
| Race condition on rename | Phase 3 (Rename Detection) | Two-phase detection, no action until full scan complete |
| Visible to mail clients | Phase 1 (Sentinel Core) | \Seen flag, past date, clear subject/body |
| Message-ID collision | Phase 1 (Sentinel Core) | UUID-based generation, never derived from folder path |
| APPEND modifies message | Phase 1 (Sentinel Core) | Verify-after-plant, store actual server Message-ID |
| Partial config update | Phase 3 (Rename Detection) | Atomic multi-reference update, consistency check on startup |
| Sweep processes sentinel | Phase 2 (Integration) | Test: sentinel in Review folder survives sweep cycle |
| Move tracking logs sentinel | Phase 2 (Integration) | Test: sentinel move not recorded as user move signal |
| Batch filing includes sentinel | Phase 2 (Integration) | Test: batch filing skips sentinel messages |

## Sources

- [ImapFlow SEARCH header issue](https://github.com/postalsys/imapflow/issues/77) -- server dependency of header search
- [ImapFlow searching guide](https://imapflow.com/docs/guides/searching/) -- search criteria and limitations
- [Fastmail account limits](https://www.fastmail.help/hc/en-us/articles/1500000277382-Account-limits) -- 500 logins per 10 minutes
- [UIDVALIDITY in IMAP](https://www.limilabs.com/blog/unique-id-in-imap-protocol) -- UID/UIDVALIDITY semantics
- [Thunderbird UIDVALIDITY resync bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1584983) -- real-world UIDVALIDITY change impact
- [RFC 3501 IMAP4rev1](https://tools.ietf.org/html/rfc3501) -- SEARCH, APPEND, UIDVALIDITY specifications
- [RFC 2822 Message-ID](https://github.com/franzinc/imap/blob/master/rfc2822.txt) -- uniqueness guarantees
- [Google IMAP SEARCH % bug](https://issuetracker.google.com/issues/183677218) -- Message-ID special character issues
- Codebase analysis: `src/action-folders/processor.ts`, `src/monitor/index.ts`, `src/action-folders/poller.ts`, `src/imap/client.ts`

---
*Pitfalls research for: IMAP Sentinel Message System (mail-mgr v0.7)*
*Researched: 2026-04-21*
